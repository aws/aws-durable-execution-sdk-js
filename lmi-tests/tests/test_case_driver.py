# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Deterministic worker timelines exercise cloud-case orchestration without AWS."""

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
        probe_entry=34.8,
        retry_progress=True,
        retry_status="SUCCEEDED",
    ):
        self.clock = clock
        self.manifest = {"cleanupGrace": 5}
        self.deadline = deadline
        self.probe_entry = probe_entry
        self.retry_progress = retry_progress
        self.retry_status = retry_status
        self.timeline = []
        self.released = {}
        self.items = {}

    def emit(self, item, phase, at, **fields):
        self.timeline.append(
            dict(
                marker=item["marker"],
                execution=item["marker"],
                request=item["marker"] + "-request",
                environment="env",
                worker="worker",
                pid=1,
                threadId=1,
                phase=phase,
                time=at,
                **fields,
            )
        )

    def prepare(self, _scenario):
        item = {"marker": "probe", "timing": {"prepareEnd": {"wall": self.clock.now}}}
        self.items["probe"] = item
        return item

    def start(self, scenario):
        marker = "peer" if scenario == "barrier" else "victim"
        item = {"marker": marker, "arn": marker, "scenario": scenario}
        self.items[marker] = item
        self.emit(item, "ENTER", self.clock.now)
        if marker == "peer":
            self.emit(item, "BLOCKED", self.clock.now, gate="peer", deadline=self.clock.now + 60)
        else:
            self.emit(item, "BLOCKED", self.clock.now, gate="loser", deadline=30)
            if self.deadline:
                self.emit(item, "BODY", 0.1, operation="success")
                retry = dict(self.timeline[-1], phase="ENTER", time=36, request="victim-retry")
                self.timeline.append(retry)
            else:
                # Overlap is possible at the loser gate before the winner enters.
                self.emit(item, "BLOCKED", 2, gate="winner")
        return item

    def invoke_at(self, item, target):
        self.wait_until(target)
        item["arn"] = item["marker"]
        item["timing"].update(
            scheduledFor=target,
            invokeBegin={"wall": target},
            invokeEnd={"wall": target + 0.1},
        )
        self.emit(item, "ENTER", self.probe_entry)
        # Handler admission meets the deadline, but the gate/heartbeat is slower.
        self.emit(item, "BLOCKED", 36, gate="peer")
        return item

    def refresh(self):
        events = [event for event in self.timeline if event["time"] <= self.clock.now]
        for event in list(events):
            if event["phase"] != "BLOCKED":
                continue
            release = self.released.get((event["marker"], event["gate"]), float("inf"))
            tick = event["time"] + 0.5
            while tick <= self.clock.now and tick < release:
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
        assert held, "Fixture gate was not held"
        self.clock.sleep(0.01)  # The control write follows already-observed evidence.
        self.released[item["marker"], gate] = self.clock.now
        self.emit(item, "RELEASED", self.clock.now, gate=gate)
        if gate == "winner":
            self.emit(item, "RETURN", self.clock.now + 0.1, status="SUCCEEDED")
        if gate == "loser":
            self.emit(item, "OBSERVED", self.clock.now + 0.1)
            if item["scenario"] == "deadline-checkpoint":
                self.emit(item, "CHECKPOINT_SETTLED", self.clock.now)
                self.emit(item, "BLOCKED", self.clock.now, gate="transport", deadline=30)

    def finish(self, item, _status="SUCCEEDED"):
        if self.deadline and item["marker"] == "victim":
            if self.retry_progress:
                self.timeline.append(
                    dict(
                        self.timeline[0],
                        phase="BODY",
                        operation="after-deadline",
                        request="victim-retry",
                        time=self.clock.now,
                    )
                )
            return {"Status": self.retry_status, "Result": '"victim"'}
        self.emit(item, "BODY", self.clock.now, operation="peer-after")
        self.emit(item, "RETURN", self.clock.now, status="SUCCEEDED")
        self.emit(item, "OBSERVED", self.clock.now)
        return {"Status": "SUCCEEDED", "Result": '"' + item["marker"] + '"'}

    def history(self, item):
        if item["marker"] == "probe":
            return [
                {
                    "EventType": "ExecutionStarted",
                    "EventTimestamp": datetime.fromtimestamp(29, timezone.utc),
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
def test_timely_probe_with_delayed_gate_keeps_live_peer_overlap(timeline, scenario):
    cloud = TimelineCloud(timeline, deadline=True)
    cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, scenario)
    gate = "transport" if scenario == "deadline-checkpoint" else "loser"
    assert cloud.released["victim", gate] == pytest.approx(35.51)
    assert cloud.released["peer", "peer"] >= 36.5
    assert cloud.released["probe", "peer"] >= 36.5


def test_waiting_for_gate_overlap_does_not_extend_handler_entry_deadline(timeline):
    cloud = TimelineCloud(timeline, deadline=True, probe_entry=35.2)
    with pytest.raises(AssertionError, match="exceeded the recovery window"):
        cases.test_platform_deadline_old_work_and_original_worker_recovery(cloud, "deadline-step")


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
