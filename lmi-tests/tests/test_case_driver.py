# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Deterministic worker timelines exercise cloud-case orchestration without AWS."""

import json
from datetime import datetime, timezone

import cloud as driver
import evidence as ev
import pytest
import test_cloud as cases


class Clock:
    now = 0.0

    def time(self):
        return self.now

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class TimelineCloud(driver.Cloud):
    def __init__(
        self,
        clock,
        *,
        deadline=False,
        probe_entry=64.8,
        probe_held=66,
        peer_entry=None,
        peer_response_delay=0,
        probe_response_delay=0,
        peer_release_delay=0.01,
        retry_progress=True,
        retry_status="SUCCEEDED",
    ):
        self.clock = clock
        self.manifest = {"cleanupGrace": 5, "invocationTimeout": 60}
        self.deadline = deadline
        self.probe_entry = probe_entry
        self.probe_held = probe_held
        self.peer_entry = peer_entry
        self.peer_response_delay = peer_response_delay
        self.probe_response_delay = probe_response_delay
        self.peer_release_delay = peer_release_delay
        self.retry_progress = retry_progress
        self.retry_status = retry_status
        self.timeline = []
        self.released = {}
        self.items = {}

    def emit(self, item, phase, at, **fields):
        event = dict(
            marker=item["marker"],
            execution=item["marker"],
            request=item["marker"] + "-request",
            environment="env",
            worker="worker",
            pid=1,
            threadId=1,
            phase=phase,
            time=at,
            deadline=item["deadline"],
        )
        event.update(fields)
        self.timeline.append(event)

    def prepare(self, scenario):
        marker = (
            ("probe" if "peer" in self.items else "peer") if scenario == "barrier" else "victim"
        )
        item = {
            "marker": marker,
            "scenario": scenario,
            "timing": {"prepareEnd": {"wall": self.clock.now}, "releases": []},
        }
        self.items[marker] = item
        return item

    def start(self, scenario):
        return self.invoke(self.prepare(scenario))

    def invoke(self, item):
        marker = item["marker"]
        item["arn"] = marker
        item["timing"]["invokeBegin"] = {"wall": self.clock.now}
        entered = self.clock.now
        if marker == "probe":
            entered = self.probe_entry
        elif marker == "peer" and self.peer_entry is not None:
            entered = self.peer_entry
        # All invocations use the deployed function's same sixty-second budget.
        item["deadline"] = entered + self.manifest["invocationTimeout"]
        self.emit(item, "ENTER", entered)
        if marker in {"peer", "probe"}:
            held = self.probe_held if marker == "probe" else entered
            self.emit(item, "BLOCKED", held, gate="peer")
        else:
            self.emit(item, "BLOCKED", entered, gate="loser")
            if self.deadline:
                self.emit(item, "BODY", entered + 0.1, operation="success")
                self.emit(
                    item,
                    "ENTER",
                    item["deadline"] + 6,
                    request="victim-retry",
                    deadline=item["deadline"] + 66,
                )
            else:
                # Overlap is possible at the loser gate before the winner enters.
                self.emit(item, "BLOCKED", 2, gate="winner")
        if marker == "peer":
            self.clock.sleep(self.peer_response_delay)
        elif marker == "probe":
            self.clock.sleep(self.probe_response_delay)
        item["timing"]["invokeEnd"] = {"wall": self.clock.now}
        return item

    def refresh(self):
        events = [event for event in self.timeline if event["time"] <= self.clock.now]
        for event in list(events):
            if event["phase"] != "BLOCKED":
                continue
            release = self.released.get((event["marker"], event["gate"]), float("inf"))
            tick = event["time"] + 0.5
            while tick <= self.clock.now and tick < min(release, event["deadline"]):
                events.append(dict(event, phase="ALIVE", time=tick))
                tick += 0.5
        return events

    def events(self, item):
        return [event for event in self.refresh() if event["marker"] == item["marker"]]

    def release(self, item, gate):
        held = [
            event
            for event in self.events(item)
            if event["phase"] == "BLOCKED" and event.get("gate") == gate
        ]
        begin = self.clock.now
        self.clock.sleep(self.peer_release_delay if item["marker"] == "peer" else 0.01)
        item["timing"]["releases"].append(
            {"gate": gate, "begin": {"wall": begin}, "end": {"wall": self.clock.now}}
        )
        self.released[item["marker"], gate] = self.clock.now
        if gate != "peer" or (held and self.clock.now < item["deadline"]):
            self.emit(item, "RELEASED", self.clock.now, gate=gate)
        if gate == "peer" and held:
            for phase, delay, fields in (
                ("BODY", 0.1, {"operation": "peer-after"}),
                ("RETURN", 0.2, {"status": "SUCCEEDED"}),
                ("OBSERVED", 1.2, {}),
            ):
                # An expired original cannot invent progress or successful return.
                if self.clock.now + delay < item["deadline"]:
                    self.emit(item, phase, self.clock.now + delay, **fields)
        if gate == "winner":
            self.emit(item, "RETURN", self.clock.now + 0.1, status="SUCCEEDED")
        if gate == "loser":
            self.emit(item, "OBSERVED", self.clock.now + 0.1)
            if item["scenario"] == "deadline-checkpoint":
                self.emit(item, "CHECKPOINT_SETTLED", self.clock.now)
                self.emit(item, "BLOCKED", self.clock.now, gate="transport")

    def finish(self, item, _status="SUCCEEDED"):
        if self.deadline and item["marker"] == "victim":
            if self.retry_progress:
                self.timeline.append(
                    dict(
                        next(e for e in self.timeline if e["request"] == "victim-retry"),
                        phase="BODY",
                        operation="after-deadline",
                        request="victim-retry",
                        time=self.clock.now,
                    )
                )
            return {"Status": self.retry_status, "Result": '"victim"'}
        returns = [
            e for e in self.timeline if e["marker"] == item["marker"] and e["phase"] == "RETURN"
        ]
        if returns:
            self.clock.sleep(max(0, returns[-1]["time"] - self.clock.now))
        return {
            "Status": "SUCCEEDED" if returns else "FAILED",
            "Result": '"' + item["marker"] + '"',
        }

    def history(self, item):
        if item["marker"] == "probe":
            return [
                {
                    "EventType": "ExecutionStarted",
                    "EventTimestamp": datetime.fromtimestamp(59, timezone.utc),
                }
            ]
        return [
            {
                "InvocationCompletedDetails": {
                    "RequestId": "victim-request",
                    "Error": {"ErrorMessage": "Invocation timed out"},
                }
            }
        ]


@pytest.fixture
def timeline(monkeypatch, tmp_path):
    clock = Clock()
    monkeypatch.setattr(driver, "time", clock)
    monkeypatch.setattr(cases, "time", clock)
    monkeypatch.setattr(cases, "ARTIFACTS", tmp_path)
    return clock


def test_early_return_waits_for_delayed_winner_gate(timeline):
    cloud = TimelineCloud(timeline)
    cases.test_early_return_rejects_late_work_and_preserves_peer(cloud, "race")
    assert cloud.released["victim", "winner"] >= 2


@pytest.mark.parametrize("scenario", ["deadline-step", "deadline-checkpoint"])
@pytest.mark.parametrize("held", [66, 89])
def test_timely_probe_with_delayed_gate_keeps_live_peer_overlap(timeline, scenario, held):
    cloud = TimelineCloud(timeline, deadline=True, probe_held=held)
    cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, scenario)
    gate = "transport" if scenario == "deadline-checkpoint" else "loser"
    assert cloud.released["victim", gate] == pytest.approx(65.51)
    assert cloud.released["peer", "peer"] >= held + 0.5
    assert cloud.released["probe", "peer"] >= held + 0.5
    assert cloud.items["peer"]["timing"]["invokeBegin"]["wall"] == 40
    assert cloud.items["probe"]["timing"]["invokeBegin"]["wall"] == 59
    assert cloud.released["peer", "peer"] < cloud.items["peer"]["deadline"] - 10


def test_waiting_for_gate_overlap_does_not_extend_handler_entry_deadline(timeline):
    cloud = TimelineCloud(timeline, deadline=True, probe_entry=65.2)
    with pytest.raises(AssertionError, match="exceeded the recovery window"):
        cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, "deadline-step")


def deadline_outcomes(tmp_path):
    return json.loads((tmp_path / "deadlines/victim.json").read_text())["outcomes"]


@pytest.mark.parametrize("scenario", ["deadline-step", "deadline-checkpoint"])
@pytest.mark.parametrize(
    "phases,message",
    [
        ({"BODY"}, "peer-after.*outside the original healthy peer"),
        ({"RETURN", "OBSERVED"}, "original healthy peer did not return"),
    ],
)
def test_deadline_rejects_peer_retry_completion(timeline, scenario, phases, message):
    cloud = TimelineCloud(timeline, deadline=True)
    original_events = cloud.events

    def events(item):
        return [
            dict(e, request="peer-retry")
            if item["marker"] == "peer" and e["phase"] in phases
            else e
            for e in original_events(item)
        ]

    cloud.events = events
    with pytest.raises(AssertionError, match=message):
        cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, scenario)


def test_probe_gate_collection_uses_one_original_peer_budget(timeline, tmp_path):
    cloud = TimelineCloud(timeline, deadline=True, probe_held=90.5)
    with pytest.raises(ev.CollectionError, match="exhausted its release budget"):
        cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, "deadline-step")
    # Do not add another thirty-second overlap wait after the gate wait expires.
    assert cloud.released["peer", "peer"] < 91
    outcomes = deadline_outcomes(tmp_path)
    assert outcomes["probe-held"]["status"] == "collection-error"
    assert outcomes["old-request-writes"]["status"] == "passed"
    assert outcomes["retry-replay"]["status"] == "passed"


def test_blocking_evidence_read_cannot_accept_expired_peer_budget(timeline, tmp_path):
    cloud = TimelineCloud(timeline, deadline=True)
    original_events = cloud.events
    delayed = False

    def events(item):
        nonlocal delayed
        if item["marker"] == "peer" and not delayed:
            delayed = True
            timeline.sleep(40)
            cloud.emit(cloud.items["victim"], "CHECKPOINT", 61, token="late", target="victim")
        return original_events(item)

    cloud.events = events
    with pytest.raises(ev.CollectionError, match="exhausted its release budget"):
        cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, "deadline-step")
    assert cloud.released["peer", "peer"] > cloud.items["peer"]["deadline"]
    outcomes = deadline_outcomes(tmp_path)
    assert outcomes["peer-entry"]["status"] == "collection-error"
    assert outcomes["peer-release"]["status"] == "collection-error"
    assert outcomes["old-request-writes"]["status"] == "assertion-failed"
    assert outcomes["worker-recovery"]["status"] == "passed"
    assert outcomes["retry-replay"]["status"] == "passed"


def test_control_write_and_completion_can_consume_the_reserved_budget(timeline):
    cloud = TimelineCloud(timeline, deadline=True, peer_release_delay=30)
    cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, "deadline-step")
    release = cloud.items["peer"]["timing"]["releases"][-1]
    assert release["begin"]["wall"] < 90 < release["end"]["wall"] < 100


def test_control_write_past_native_deadline_is_a_collection_failure(timeline, tmp_path):
    cloud = TimelineCloud(timeline, deadline=True, peer_release_delay=40)
    with pytest.raises(ev.CollectionError, match="outside its release budget"):
        cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, "deadline-step")
    release = cloud.items["peer"]["timing"]["releases"][-1]
    assert release["begin"]["wall"] < 90 < 100 < release["end"]["wall"]
    assert deadline_outcomes(tmp_path)["peer-release"]["status"] == "collection-error"


def test_peer_must_enter_before_the_victim_native_deadline(timeline, tmp_path):
    cloud = TimelineCloud(timeline, deadline=True, peer_entry=61)
    with pytest.raises(ev.CollectionError, match="entered before the victim deadline"):
        cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, "deadline-step")
    outcomes = deadline_outcomes(tmp_path)
    assert outcomes["peer-setup"]["status"] == "collection-error"
    assert outcomes["old-request-writes"]["status"] == "passed"
    assert outcomes["retry-replay"]["status"] == "passed"


def test_original_peer_entry_without_live_pre_deadline_overlap_is_invalid(timeline, tmp_path):
    cloud = TimelineCloud(timeline, deadline=True, peer_entry=59.8)
    with pytest.raises(ev.CollectionError, match="live held interval"):
        cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, "deadline-step")
    assert deadline_outcomes(tmp_path)["peer-setup"]["status"] == "collection-error"


def test_actual_peer_submission_must_precede_the_victim_deadline(timeline, tmp_path):
    cloud = TimelineCloud(timeline, deadline=True)
    original_invoke = cloud.invoke

    def invoke(item):
        if item["marker"] == "peer":
            timeline.sleep(21)  # Preparation/intent persistence delayed the actual API call.
        return original_invoke(item)

    cloud.invoke = invoke
    with pytest.raises(ev.CollectionError, match="invoked and entered before the victim deadline"):
        cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, "deadline-step")
    assert cloud.items["peer"]["timing"]["invokeBegin"]["wall"] == 61
    assert deadline_outcomes(tmp_path)["peer-setup"]["status"] == "collection-error"


@pytest.mark.parametrize("response_delay", [18.5, 20.5])
def test_peer_admission_uses_actual_entry_even_with_late_invoke_response(
    timeline, tmp_path, response_delay
):
    cloud = TimelineCloud(timeline, deadline=True, peer_response_delay=response_delay)
    if response_delay > 20:
        with pytest.raises(ev.CollectionError, match="pre-deadline window"):
            cases.test_platform_deadline_old_work_and_original_worker_recovery(
                cloud, "deadline-step"
            )
    else:
        cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, "deadline-step")
    outcomes = deadline_outcomes(tmp_path)
    assert outcomes["peer-setup"]["status"] == "passed"
    assert outcomes["probe-scheduling"]["status"] == (
        "collection-error" if response_delay > 20 else "passed"
    )


@pytest.mark.parametrize("scenario", ["deadline-step", "deadline-checkpoint"])
def test_retry_entry_without_after_deadline_progress_fails(timeline, scenario):
    cloud = TimelineCloud(timeline, deadline=True, retry_progress=False)
    with pytest.raises(AssertionError, match="did not execute after-deadline work"):
        cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, scenario)


@pytest.mark.parametrize("status", ["FAILED", "RUNNING"])
def test_retry_must_complete_successfully(timeline, status):
    cloud = TimelineCloud(timeline, deadline=True, retry_status=status)
    with pytest.raises(AssertionError, match="did not complete successfully"):
        cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, "deadline-step")


def test_healthy_companion_keeps_its_original_request_after_the_victim_boundary(timeline):
    cloud = TimelineCloud(timeline)
    peer = cloud.start("barrier")
    original = cloud.phase(peer, "BLOCKED", "peer")[0]
    timeline.sleep(2)
    cases.healthy_after(cloud, peer, original, {"time": 1})


@pytest.mark.parametrize(
    "phases,exception,message",
    [
        (
            {"ALIVE", "BODY", "RETURN", "OBSERVED"},
            ev.CollectionError,
            "heartbeat.*original healthy peer",
        ),
        ({"BODY"}, AssertionError, "peer-after.*outside the original healthy peer"),
        ({"RETURN", "OBSERVED"}, AssertionError, "original healthy peer did not return"),
    ],
)
def test_early_return_rejects_peer_retry_substitution(timeline, phases, exception, message):
    cloud = TimelineCloud(timeline)
    original_events = cloud.events

    def observed(item):
        boundaries = [
            event["time"]
            for event in cloud.timeline
            if event["marker"] == "victim" and event["phase"] == "RETURN"
        ]
        boundary = min(boundaries, default=float("inf"))
        return [
            dict(event, request="peer-retry")
            if event["marker"] == "peer" and event["phase"] in phases and event["time"] > boundary
            else event
            for event in original_events(item)
        ]

    cloud.events = observed
    with pytest.raises(exception, match=message):
        cases.test_early_return_rejects_late_work_and_preserves_peer(cloud, "race")


def test_late_peer_release_is_a_harness_timing_failure(timeline):
    cloud = TimelineCloud(timeline)
    peer = cloud.start("barrier")
    original = cloud.phase(peer, "BLOCKED", "peer")[0]
    timeline.sleep(61)
    with pytest.raises(ev.CollectionError, match="Harness held.*past its deadline"):
        cases.healthy_after(cloud, peer, original, {"time": 1})
    assert (peer["marker"], "peer") not in cloud.released


@pytest.mark.parametrize("entered", [64.8, 65.2])
def test_probe_entry_bound_is_unchanged_when_invoke_response_arrives_late(
    timeline, tmp_path, entered
):
    cloud = TimelineCloud(timeline, deadline=True, probe_entry=entered, probe_response_delay=20)
    if entered > 65:
        with pytest.raises(AssertionError, match="exceeded the recovery window"):
            cases.test_platform_deadline_old_work_and_original_worker_recovery(
                cloud, "deadline-step"
            )
    else:
        cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, "deadline-step")
    timing = cloud.items["probe"]["timing"]
    assert timing["invokeBegin"]["wall"] == 59
    assert timing["invokeEnd"]["wall"] == 79
    outcomes = deadline_outcomes(tmp_path)
    assert outcomes["probe-scheduling"]["status"] == "passed"
    assert outcomes["worker-recovery"]["status"] == (
        "assertion-failed" if entered > 65 else "passed"
    )
