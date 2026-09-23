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


def healthy_after(cloud, peer, boundary):
    cloud.poll(
        lambda: [
            e for e in cloud.events(peer) if e["phase"] == "ALIVE" and e["time"] > boundary["time"]
        ]
    )
    cloud.release(peer, "peer")
    result = cloud.finish(peer)
    assert result["Result"] == '"' + peer["marker"] + '"'
    assert len([e for e in cloud.events(peer) if e.get("operation") == "peer-after"]) == 1

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
    cloud.phase(peer, "BLOCKED", "peer")
    victim = cloud.start(scenario)
    cloud.phase(victim, "BLOCKED", "loser")
    overlap(cloud, peer, victim)
    cloud.release(victim, "winner")
    boundary = cloud.phase(victim, "RETURN")[0]
    assert boundary["status"] == ("FAILED" if scenario == "failure-inflight" else "SUCCEEDED")
    # Release only AFTER actual SDK wrapper return, not the winner/end plugin hook.
    cloud.release(victim, "loser")
    cloud.phase(victim, "RELEASED", "loser")
    cloud.phase(victim, "OBSERVED")
    # An open observation interval catches callbacks scheduled by a released loser.
    time.sleep(2)
    healthy_after(cloud, peer, boundary)
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
        peer_event = cloud.phase(peer, "BLOCKED", "peer")[0]
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
        healthy_after(cloud, peer, ev.require(cloud.events(item), "RETURN")[-1])
    # Check after all cycles, so the first leaked timer does not skip later cases.
    ev.resources(cloud.refresh())


@pytest.mark.parametrize("scenario", ["deadline-step", "deadline-checkpoint"])
def test_platform_deadline_old_work_and_original_worker_recovery(cloud, scenario):
    victim = cloud.start(scenario)
    blocked = cloud.phase(victim, "BLOCKED", "loser")[0]
    if scenario == "deadline-checkpoint":
        cloud.release(victim, "loser")
        blocked = cloud.phase(victim, "BLOCKED", "transport")[0]
        assert ev.select(cloud.events(victim), "CHECKPOINT_SETTLED"), (
            "No genuine checkpoint completed before hold"
        )
    # Prepare the probe well before the deadline. Submission below performs no
    # S3 writes or polling and therefore measures admission instead of setup.
    probe = cloud.prepare("barrier")
    time.sleep(10)
    peer = cloud.start("barrier")
    peer_blocked = cloud.phase(peer, "BLOCKED", "peer")[0]
    gate = "transport" if scenario == "deadline-checkpoint" else "loser"
    identity = overlap(
        cloud,
        victim,
        peer,
        gates={victim["marker"]: gate, peer["marker"]: "peer"},
        requests={victim["marker"]: blocked["request"], peer["marker"]: peer_blocked["request"]},
    )
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

    observe("probe-submit", lambda: cloud.invoke_at(probe, deadline - 1))
    # Do not make automatic worker recovery depend on our manual fault release.
    # Keep the healthy peer and fault held for the entire five-second window.
    cloud.wait_until(deadline + grace + 0.5)
    observe("fault-release", lambda: cloud.release(victim, gate))
    observe("peer-release", lambda: cloud.release(peer, "peer"))
    # All evidence I/O is now outside the measured admission window. Event times
    # (not arrival times) establish when the probe entered and overlapped the peer.
    observe("probe-held", lambda: cloud.phase(probe, "BLOCKED", "peer", seconds=30))
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

    def healthy_peer():
        events = recorded("peer-events")
        assert any(
            e["phase"] == "ALIVE"
            and e["request"] == peer_blocked["request"]
            and e.get("gate") == "peer"
            and e["time"] >= deadline
            for e in events
        ), "Healthy peer did not progress after the deadline"
        assert any(
            e["phase"] == "RELEASED"
            and e["request"] == peer_blocked["request"]
            and e.get("gate") == "peer"
            and e["time"] >= deadline + grace
            for e in events
        ), "Healthy peer was released before the recovery window ended"
        result = recorded("peer-result")
        assert result["Result"] == '"' + peer["marker"] + '"'
        assert (
            ev.overlap(
                events + recorded("probe-events"),
                {peer["marker"], probe["marker"]},
                gates={peer["marker"]: "peer", probe["marker"]: "peer"},
                requests={peer["marker"]: peer_blocked["request"]},
            )
            == identity
        )
        ev.tokens(events + recorded("probe-events") + recorded("victim-events"))

    outcomes.update(
        ev.check_all(
            {
                "probe-scheduling": lambda: ev.timely_probe(probe["timing"], deadline),
                "old-request-writes": old_request,
                "worker-recovery": worker_recovery,
                "healthy-peer": healthy_peer,
                "retry-replay": lambda: ev.timeout_retry(
                    recorded("victim-events"), blocked["request"]
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
            "victim": victim,
            "observedAt": cloud.timestamp(),
            "outcomes": outcomes,
            "probeServiceStart": next(
                (e for e in probe_history if e.get("EventType") == "ExecutionStarted"), None
            ),
            "probeEntry": ev.select(observations.get("probe-events", []), "ENTER"),
            "probeHeld": observations.get("probe-held"),
            "victimRequests": ev.select(observations.get("victim-events", []), "ENTER"),
        },
    )
    ev.require_checks(outcomes)
