# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import time

import evidence as ev
import pytest
from deploy import ARTIFACTS, save


def overlap(cloud, *items, gates=None, requests=None):
    markers = {i["marker"] for i in items}

    def observed():
        try:
            return ev.overlap(cloud.refresh(), markers, gates=gates, requests=requests)
        except ev.PlacementError:
            return None

    return cloud.poll(
        observed,
        seconds=30,
        error=ev.PlacementError,
        message="No live overlap in the same Node.js worker",
    )


def healthy_after(cloud, peer, original, boundary):
    # These companions run the barrier workflow without a durable suspension.
    # Holding their gate past the platform deadline is a driver timing failure,
    # not evidence that the victim interrupted an otherwise healthy invocation.
    def remaining_budget():
        remaining = original["deadline"] - time.time()
        if remaining <= 0:
            raise ev.CollectionError("Harness held the original healthy peer past its deadline")
        return remaining

    cloud.poll(
        lambda: [
            e
            for e in cloud.events(peer)
            if e["phase"] == "ALIVE"
            and e.get("gate") == "peer"
            and e["request"] == original["request"]
            and e["time"] > boundary["time"]
        ],
        seconds=remaining_budget(),
        message="No post-boundary heartbeat from the original healthy peer",
    )
    remaining_budget()
    cloud.release(peer, "peer")
    result = cloud.finish(peer)
    events = cloud.events(peer)
    ev.healthy_peer_completion(events, original, boundary, result, peer["marker"])

    def observed():
        events = cloud.events(peer)
        returns = {e["request"] for e in ev.select(events, "RETURN")}
        return returns and returns <= {e["request"] for e in ev.select(events, "OBSERVED")}

    cloud.poll(observed)
    ev.tokens(cloud.refresh())


def test_shared_decorated_handler_and_nested_progress(cloud):
    first, second = cloud.start("barrier"), cloud.start("barrier")
    identity = overlap(cloud, first, second)
    for item in (first, second):
        cloud.release(item, "peer")
        cloud.finish(item)
    # A second pair starts nested map/parallel through the same decorated handler.
    results = [cloud.start("nested-progress") for _ in range(2)]
    assert overlap(cloud, *results) == identity
    for item in results:
        cloud.release(item, "peer")
    for item in results:
        result = cloud.finish(item)
        assert result["Result"] == "[[1,10],[2,20]]"
        entries = cloud.phase(item, "ENTER")
        assert all(
            (e["environment"], e["worker"], e["pid"], e["threadId"]) == identity for e in entries
        )
    ev.tokens(cloud.refresh())


@pytest.mark.parametrize(
    "scenario",
    ["race", "any", "map", "parallel", "nested", "return-inflight", "failure-inflight"],
)
def test_early_return_rejects_late_work_and_preserves_peer(cloud, scenario):
    peer = cloud.start("barrier")
    peer_blocked = min(cloud.phase(peer, "BLOCKED", "peer"), key=lambda event: event["time"])
    victim = cloud.start(scenario)
    cloud.phase(victim, "BLOCKED", "loser")
    overlap(cloud, peer, victim)
    cloud.phase(victim, "BLOCKED", "winner")
    cloud.release(victim, "winner")
    boundary = cloud.phase(victim, "RETURN")[0]
    assert boundary["status"] == ("FAILED" if scenario == "failure-inflight" else "SUCCEEDED")
    # Release only AFTER actual SDK wrapper return, not the winner/end plugin hook.
    cloud.release(victim, "loser")
    cloud.phase(victim, "RELEASED", "loser")
    cloud.phase(victim, "OBSERVED")
    # An open observation interval catches callbacks scheduled by a released loser.
    time.sleep(2)
    healthy_after(cloud, peer, peer_blocked, boundary)
    cloud.finish(victim, "FAILED" if scenario == "failure-inflight" else "SUCCEEDED")
    ev.no_late_work(cloud.events(victim), boundary)


def test_real_suspend_and_replay_preserve_success_failure_and_business_stack(cloud):
    item = cloud.start("replay")
    cloud.finish(item)
    history = cloud.history(item)
    ev.replay(cloud.events(item), history)
    for boundary in ev.select(cloud.events(item), "RETURN"):
        ev.no_late_work(cloud.events(item), boundary)


def test_reused_worker_resources_after_repeated_success_failure_suspend(cloud):
    identity = None
    for scenario in ["success", "failure", "replay"] * 3:
        peer = cloud.start("barrier")
        peer_event = min(cloud.phase(peer, "BLOCKED", "peer"), key=lambda event: event["time"])
        current = (peer_event["environment"], peer_event["worker"])
        if identity is None:
            identity = current
        assert current == identity, "Warm cycle replaced the worker"
        item = cloud.start(scenario)
        cloud.finish(item, "FAILED" if scenario == "failure" else "SUCCEEDED")
        events = cloud.events(item)
        assert all((e["environment"], e["worker"]) == identity for e in ev.require(events, "ENTER"))
        cloud.poll(
            lambda item=item: (
                len(ev.select(cloud.events(item), "OBSERVED"))
                >= len(ev.select(cloud.events(item), "RETURN"))
            )
        )
        healthy_after(cloud, peer, peer_event, ev.require(cloud.events(item), "RETURN")[-1])
    # Check after all cycles, so the first leaked timer does not skip later cases.
    ev.resources(cloud.refresh())


@pytest.mark.parametrize("scenario", ["deadline-step", "deadline-checkpoint"])
def test_platform_deadline_old_work_and_original_worker_recovery(cloud, scenario):
    # Both controls exist before the victim starts its real invocation budget.
    peer = cloud.prepare("barrier")
    probe = cloud.prepare("barrier")
    victim = cloud.start(scenario)
    blocked = cloud.phase(victim, "BLOCKED", "loser")[0]
    if scenario == "deadline-checkpoint":
        cloud.release(victim, "loser")
        blocked = cloud.phase(victim, "BLOCKED", "transport")[0]
        assert ev.select(cloud.events(victim), "CHECKPOINT_SETTLED"), (
            "No genuine checkpoint completed before hold"
        )
    gate = "transport" if scenario == "deadline-checkpoint" else "loser"
    identity = ev.worker_identity(blocked)
    deadline, grace = blocked["deadline"], cloud.manifest["cleanupGrace"]
    observations, outcomes = {}, {}

    def observe(name, fn):
        try:
            observations[name] = fn()
        except AssertionError as error:
            outcomes[name] = {"status": "assertion-failed", "message": str(error)}
        except Exception as error:
            # Preserve failed observation attempts without suppressing independent
            # old-request assertions. Their tracebacks remain in the case artifact.
            import traceback

            outcomes[name] = {
                "status": "collection-error",
                "message": str(error),
                "traceback": traceback.format_exc(),
            }

    def recorded(name):
        if name not in observations:
            raise ev.CollectionError(f"Required observation unavailable: {name}")
        return observations[name]

    def peer_deadline():
        original = observations.get("peer-entry")
        if original:
            return original["deadline"]
        # Until native ENTER is collected, conservatively budget from actual
        # Invoke submission. Queueing cannot give the request an earlier start.
        return peer["timing"]["invokeBegin"]["wall"] + cloud.manifest["invocationTimeout"]

    def collection_cutoff():
        return peer_deadline() - 10

    def collect(fn):
        # Every read consumes one shared absolute budget. A blocking read can
        # overrun poll's timeout, so check again before accepting its evidence.
        message = "Healthy peer evidence collection exhausted its release budget"

        def remaining():
            seconds = collection_cutoff() - time.time()
            if seconds <= 0:
                raise ev.CollectionError(message)
            return seconds

        def observed():
            remaining()
            result = fn()
            remaining()
            return result

        return cloud.poll(observed, seconds=remaining(), message=message)

    def collect_phase(item, phase, gate=None, request=None):
        return collect(
            lambda: [
                e
                for e in cloud.events(item)
                if e["phase"] == phase
                and (gate is None or e.get("gate") == gate)
                and (request is None or e["request"] == request)
            ]
        )

    # Starting the companion later gives it time to finish after recovery.
    # No evidence polling lies on the two scheduled Invoke paths. Native event
    # timestamps prove pre-timeout placement retrospectively.
    observe("peer-submit", lambda: cloud.invoke_at(peer, deadline - 20))
    observe("probe-submit", lambda: cloud.invoke_at(probe, deadline - 1))
    # Do not make automatic worker recovery depend on our manual fault release.
    # Keep the healthy peer and fault held for the entire five-second window.
    cloud.wait_until(deadline + grace + 0.5)
    observe("fault-release", lambda: cloud.release(victim, gate))
    # All evidence I/O is now outside the measured admission window. Event times
    # (not arrival times) establish when the probe entered and overlapped the peer.
    # Timely handler entry can precede delayed gate progress. Keep both gates
    # held only within the original peer's budget, reserving ten seconds for
    # release, peer-after and a real successful wrapper return.
    observe("peer-entry", lambda: min(collect_phase(peer, "ENTER"), key=lambda e: e["time"]))
    observe(
        "peer-held",
        lambda: min(
            collect_phase(peer, "BLOCKED", "peer", recorded("peer-entry")["request"]),
            key=lambda e: e["time"],
        ),
    )
    observe("probe-entry", lambda: min(collect_phase(probe, "ENTER"), key=lambda e: e["time"]))
    observe(
        "probe-held",
        lambda: collect_phase(probe, "BLOCKED", "peer", request=recorded("probe-entry")["request"]),
    )

    def probe_overlap():
        try:
            return ev.overlap(
                cloud.refresh(),
                {peer["marker"], probe["marker"]},
                gates={peer["marker"]: "peer", probe["marker"]: "peer"},
                requests={
                    peer["marker"]: recorded("peer-entry")["request"],
                    probe["marker"]: recorded("probe-entry")["request"],
                },
            )
        except ev.PlacementError:
            return None

    observe("probe-overlap", lambda: collect(probe_overlap))

    def release_peer():
        # Release even when collection or a control PUT overran the budget.
        # Retain the actual write interval rather than inferring timely release
        # from a later heartbeat or successful service retry.
        cloud.release(peer, "peer")
        release = [r for r in peer["timing"]["releases"] if r["gate"] == "peer"][-1]
        begin, end = release["begin"]["wall"], release["end"]["wall"]
        if (
            not deadline + grace <= begin <= collection_cutoff()
            or not begin <= end < peer_deadline()
        ):
            raise ev.CollectionError(
                "Harness released the original healthy peer outside its release budget"
            )
        return release

    observe("peer-release", release_peer)
    observe("probe-release", lambda: cloud.release(probe, "peer"))
    if probe.get("arn"):
        observe("probe-result", lambda: cloud.finish(probe))
        observe("probe-history", lambda: cloud.history(probe))
    observe("peer-result", lambda: cloud.finish(peer))

    def platform_timeout():
        history = cloud.history(victim)
        return history if ev.timeout_record(history, blocked["request"]) else None

    observe(
        "platform-timeout",
        lambda: cloud.poll(
            platform_timeout, seconds=90, message="No request-correlated platform timeout evidence"
        ),
    )
    # A retry must have its own request ID within the SAME durable execution.
    observe(
        "retry-entry",
        lambda: cloud.poll(
            lambda: [
                e
                for e in ev.select(cloud.events(victim), "ENTER")
                if e["request"] != blocked["request"]
            ],
            seconds=40,
            message="No service retry of the original execution was observed",
        ),
    )
    observe("victim-result", lambda: cloud.finish(victim))
    time.sleep(2)  # Observe continuations after controlled release, not just responses.
    observe("victim-events", lambda: cloud.events(victim))
    observe("peer-events", lambda: cloud.events(peer))
    observe("probe-events", lambda: cloud.events(probe))

    def old_request():
        recorded("platform-timeout")
        recorded("fault-release")
        ev.no_late_work(
            recorded("victim-events"), {"time": deadline, "request": blocked["request"]}
        )

    def worker_recovery():
        recorded("platform-timeout")
        ev.recovery(
            recorded("probe-events"), probe, identity, deadline, grace, recorded("probe-history")
        )

    def peer_setup():
        events = recorded("peer-events")
        original = min(ev.require(events, "ENTER"), key=lambda e: e["time"])
        begin = peer["timing"].get("invokeBegin", {}).get("wall")
        if begin is None or not deadline - 20 <= begin < deadline or original["time"] >= deadline:
            raise ev.CollectionError(
                "Original healthy peer was not invoked and entered before the victim deadline"
            )
        held = [
            e
            for e in ev.select(events, "BLOCKED")
            if e.get("gate") == "peer" and e["request"] == original["request"]
        ]
        if not held:
            raise ev.CollectionError("No held work from the original healthy peer")
        assert (
            ev.overlap(
                [e for e in events + recorded("victim-events") if e["time"] < deadline],
                {peer["marker"], victim["marker"]},
                gates={peer["marker"]: "peer", victim["marker"]: gate},
                requests={
                    peer["marker"]: original["request"],
                    victim["marker"]: blocked["request"],
                },
            )
            == identity
        )

    def healthy_peer():
        recorded("peer-release")
        original = recorded("peer-entry")
        events = recorded("peer-events")
        assert any(
            e["phase"] == "ALIVE"
            and e["request"] == original["request"]
            and e.get("gate") == "peer"
            and deadline <= e["time"] < original["deadline"]
            for e in events
        ), "Healthy peer did not progress after the deadline"
        released = [
            e
            for e in ev.select(events, "RELEASED")
            if e["request"] == original["request"]
            and e.get("gate") == "peer"
            and deadline + grace <= e["time"] < original["deadline"]
        ]
        assert released, "Original healthy peer did not release within its invocation budget"
        ev.healthy_peer_completion(
            events,
            original,
            min(released, key=lambda e: e["time"]),
            recorded("peer-result"),
            peer["marker"],
        )
        assert (
            ev.overlap(
                events + recorded("probe-events"),
                {peer["marker"], probe["marker"]},
                gates={peer["marker"]: "peer", probe["marker"]: "peer"},
                requests={
                    peer["marker"]: original["request"],
                    probe["marker"]: recorded("probe-entry")["request"],
                },
            )
            == identity
        )
        ev.tokens(events + recorded("probe-events") + recorded("victim-events"))

    outcomes.update(
        ev.check_all(
            {
                "probe-scheduling": lambda: ev.timely_probe(probe["timing"], deadline),
                "peer-setup": peer_setup,
                "old-request-writes": old_request,
                "worker-recovery": worker_recovery,
                "healthy-peer": healthy_peer,
                "retry-replay": lambda: ev.timeout_retry(
                    recorded("victim-events"),
                    blocked["request"],
                    recorded("victim-result"),
                    victim["marker"],
                ),
            }
        )
    )
    probe_history = observations.get("probe-history", [])
    save(
        ARTIFACTS / f"deadlines/{victim['marker']}.json",
        {
            "deadline": deadline,
            "grace": grace,
            "originalRequest": blocked["request"],
            "identity": identity,
            "probe": probe,
            "peer": peer,
            "peerEntry": observations.get("peer-entry"),
            "peerHeld": observations.get("peer-held"),
            "peerRelease": observations.get("peer-release"),
            "victim": victim,
            "observedAt": cloud.timestamp(),
            "outcomes": outcomes,
            "probeServiceStart": next(
                (e for e in probe_history if e.get("EventType") == "ExecutionStarted"), None
            ),
            "probeEntry": ev.select(observations.get("probe-events", []), "ENTER"),
            "probeHeld": observations.get("probe-held"),
            "victimRequests": ev.select(observations.get("victim-events", []), "ENTER"),
            "victimResult": observations.get("victim-result"),
        },
    )
    ev.require_checks(outcomes)
