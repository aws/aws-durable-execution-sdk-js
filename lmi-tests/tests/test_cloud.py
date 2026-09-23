# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import time

import evidence as ev
import pytest


def overlap(cloud, *items):
    markers = {i["marker"] for i in items}

    def observed():
        try:
            return ev.overlap(cloud.refresh(), markers)
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


@pytest.mark.parametrize(
    "scenario,fixture",
    [("deadline-step", "deadline"), ("deadline-checkpoint", "transport")],
)
def test_platform_deadline_old_work_and_original_worker_recovery(cloud, scenario, fixture):
    victim = cloud.start(scenario, fixture)
    blocked = cloud.phase(victim, "BLOCKED", "loser")[0]
    if scenario == "deadline-checkpoint":
        cloud.release(victim, "loser")
        blocked = cloud.phase(victim, "BLOCKED", "transport")[0]
        assert ev.select(cloud.events(victim), "CHECKPOINT_SETTLED"), (
            "No genuine checkpoint completed before hold"
        )
    # Start the companion later so its real platform deadline extends past the
    # victim's cleanup/recovery window. Driver latency never extends that window.
    time.sleep(10)
    peer = cloud.start("barrier", fixture)
    identity = overlap(cloud, victim, peer)
    deadline = blocked["deadline"]
    time.sleep(max(0, deadline + 1 - time.time()))
    gate = "transport" if scenario == "deadline-checkpoint" else "loser"
    cloud.release(victim, gate)
    cloud.phase(victim, "RELEASED", gate)
    # Put demand on the victim's vacated slot while the original peer stays held.
    probe = cloud.start("barrier", fixture)
    recovered = cloud.phase(probe, "BLOCKED", "peer")
    first_probe = recovered[0]
    cloud.release(probe, "peer")
    cloud.finish(probe)
    healthy_after(cloud, peer, {"time": deadline})
    # Service history, not getRemainingTimeInMillis stubbing or a client timeout.
    cloud.poll(
        lambda: ev.timeout_record(cloud.history(victim), blocked["request"]),
        seconds=90,
        message="No request-correlated platform timeout evidence",
    )
    assert (
        first_probe["environment"],
        first_probe["worker"],
        first_probe["pid"],
        first_probe["threadId"],
    ) == identity, "Replacement environment is not worker recovery"
    assert first_probe["time"] <= deadline + cloud.manifest["cleanupGrace"], (
        "Worker capacity did not recover within deadline + grace"
    )
    boundary = {"time": deadline, "request": blocked["request"]}
    ev.no_late_work(cloud.events(victim), boundary)
    entries = ev.require(cloud.events(victim), "ENTER")
    # A retry must belong to the same durable execution; it may repeat interrupted
    # work, but never the already-checkpointed successful side effect.
    if len({e["request"] for e in entries}) > 1:
        assert (
            len([e for e in ev.select(cloud.events(victim), "BODY") if e["operation"] == "success"])
            == 1
        )
