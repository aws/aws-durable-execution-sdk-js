# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import copy

import evidence as ev
import pytest


def event(phase, marker="a", **kwargs):
    result = dict(
        phase=phase,
        marker=marker,
        request=marker,
        environment="env",
        worker="worker",
        pid=1,
        threadId=1,
        time=10,
    )
    result.update(kwargs)
    return result


def overlap_events():
    return [
        event("BLOCKED", "a"),
        event("BLOCKED", "b"),
        event("ALIVE", "a"),
        event("ALIVE", "b"),
    ]


def test_overlap_requires_live_distinct_requests_in_one_worker():
    assert ev.overlap(overlap_events(), {"a", "b"}) == ("env", "worker", 1, 1)


@pytest.mark.parametrize(
    "field,value",
    [
        ("environment", "different"),
        ("worker", "different"),
        ("pid", 2),
        ("threadId", 2),
        ("request", "a"),
    ],
)
def test_placement_negative_controls(field, value):
    events = overlap_events()
    events[1][field] = value
    with pytest.raises(ev.PlacementError):
        ev.overlap(events, {"a", "b"})


def test_entry_only_is_not_overlap():
    with pytest.raises(ev.PlacementError):
        ev.overlap(overlap_events()[:2], {"a", "b"})


def test_non_overlapping_held_work_is_not_overlap():
    with pytest.raises(ev.PlacementError):
        ev.overlap(overlap_events() + [event("RELEASED")], {"a", "b"})


@pytest.mark.parametrize("phase", ["CHECKPOINT", "POLL", "SEND", "BODY"])
def test_late_work_negative_controls(phase):
    late = event(phase, operation="late-operation")
    late["time"] = 12
    with pytest.raises(AssertionError):
        ev.no_late_work([late], event("RETURN"))


def test_another_invocation_may_continue_after_return():
    late = event("CHECKPOINT", "b")
    late["time"] = 12
    ev.no_late_work([late], event("RETURN"))


def test_noncooperative_side_effect_is_not_mislabeled_exactly_once():
    late = event("BODY", operation="loser-effect")
    late["time"] = 12
    ev.no_late_work([late], event("RETURN"))


def test_escape_never_passes():
    with pytest.raises(AssertionError):
        ev.no_late_work([event("ESCAPE")], event("RETURN"))


@pytest.mark.parametrize(
    "resources", [{"timers": 1, "lateCallbacks": 0}, {"timers": 0, "lateCallbacks": 1}]
)
def test_resource_leaks_fail(resources):
    with pytest.raises(AssertionError):
        ev.resources([event("RETURN"), event("OBSERVED", resources=resources)])


def test_missing_post_return_observation_is_collection_error():
    with pytest.raises(ev.CollectionError):
        ev.resources([event("RETURN")])


def test_all_invocations_need_resource_observation():
    with pytest.raises(AssertionError):
        ev.resources(
            [
                event("RETURN", "a"),
                event("RETURN", "b"),
                event("OBSERVED", resources={"timers": 0, "lateCallbacks": 0}),
            ]
        )


def test_shared_token_and_wrong_target_fail():
    first = event("CHECKPOINT", token="hashed", target="exec-a", execution="exec-a")
    second = event("CHECKPOINT", "b", token="hashed", target="exec-b", execution="exec-b")
    with pytest.raises(AssertionError):
        ev.tokens([first, second])
    first["target"] = "exec-b"
    with pytest.raises(AssertionError):
        ev.tokens([first])


def test_timeout_requires_service_request_identity():
    history = [
        {
            "InvocationCompletedDetails": {
                "RequestId": "a",
                "Error": {"ErrorType": "Sandbox.Timedout"},
            }
        }
    ]
    assert ev.timeout_record(history, "a")
    assert not ev.timeout_record(history, "b")
    assert not ev.timeout_record([{"EventType": "ExecutionTimedOut"}], "a")


def replay_events():
    events = [
        event("ENTER"),
        event("ENTER", "b"),
        event("RETURN", status="PENDING"),
        event("RETURN", "b", status="SUCCEEDED"),
    ]
    events += [
        event("BODY", operation=operation)
        for operation in ("success", "stored-failure", "after-wait")
    ]
    events += [
        event("STORED_FAILURE", message="stored"),
        event("STORED_FAILURE", "b", message="stored"),
    ]
    return events


HISTORY = [{"EventType": "WaitSucceeded"}, {"EventType": "StepFailed"}]


def test_replay_positive_control():
    ev.replay(replay_events(), HISTORY)


@pytest.mark.parametrize(
    "extra",
    [event("BODY", operation="success"), event("COMPENSATION"), event("WAIT_FINALLY")],
)
def test_replay_detects_repeated_body_or_artificial_unwinding(extra):
    with pytest.raises(AssertionError):
        ev.replay(replay_events() + [extra], HISTORY)


def test_replay_requires_real_history_and_stable_failure():
    with pytest.raises(AssertionError):
        ev.replay(replay_events(), [])
    events = copy.deepcopy(replay_events())
    events[-1]["message"] = "different failure"
    with pytest.raises(AssertionError):
        ev.replay(events, HISTORY)


def test_recorded_checkpoint_gate_transition_does_not_end_invocation():
    import json
    from pathlib import Path

    # Reduced from run 35911675108: identifiers normalized, times relative to
    # invocation entry. An earlier loser release must not close transport's hold.
    events = json.loads((Path(__file__).parent / "fixtures/checkpoint-overlap.json").read_text())
    assert ev.overlap(
        events,
        {"victim", "peer"},
        gates={"victim": "transport", "peer": "peer"},
        requests={"victim": "victim-request", "peer": "peer-request"},
    ) == ("environment", "worker", 15, 1)


@pytest.mark.parametrize(
    "heartbeat_gate,heartbeat_time", [("old", 12), ("current", 9), ("current", 14)]
)
def test_other_gate_stale_or_post_release_heartbeat_cannot_establish_overlap(
    heartbeat_gate, heartbeat_time
):
    events = [
        event("BLOCKED", gate="current", time=8),
        event("RELEASED", gate="current", time=13),
        event("ALIVE", gate=heartbeat_gate, time=heartbeat_time),
        event("BLOCKED", "b", gate="peer", time=10),
        event("ALIVE", "b", gate="peer", time=11),
    ]
    with pytest.raises(ev.PlacementError):
        ev.overlap(events, {"a", "b"})


def test_new_hold_of_same_gate_does_not_reuse_an_earlier_release():
    events = [
        event("BLOCKED", gate="gate", time=0),
        event("ALIVE", gate="gate", time=1),
        event("RELEASED", gate="gate", time=2),
        event("BLOCKED", gate="gate", time=3),
        event("ALIVE", gate="gate", time=4),
        event("BLOCKED", "b", time=3.5),
        event("ALIVE", "b", time=4),
    ]
    assert ev.overlap(events, {"a", "b"}) == ("env", "worker", 1, 1)


def test_retry_request_cannot_replace_original_request_in_overlap():
    events = [
        event("BLOCKED", request="original", time=0),
        event("RETURN", request="original", time=1),
        event("BLOCKED", request="retry", time=2),
        event("ALIVE", request="retry", time=4),
        event("BLOCKED", "b", time=3),
        event("ALIVE", "b", time=4),
    ]
    with pytest.raises(ev.PlacementError):
        ev.overlap(events, {"a", "b"}, requests={"a": "original"})


def test_recovery_failure_does_not_mask_independent_late_checkpoint():
    late = event("CHECKPOINT", time=12)

    def unavailable_recovery():
        raise ev.CollectionError("probe submitted too late")

    outcomes = ev.check_all(
        {
            "recovery": unavailable_recovery,
            "old-request": lambda: ev.no_late_work([late], event("RETURN")),
        }
    )
    assert outcomes["recovery"]["status"] == "collection-error"
    assert outcomes["old-request"]["status"] == "assertion-failed"
    with pytest.raises(ev.CollectionError, match="closed invocation sent an SDK request"):
        ev.require_checks(outcomes)


def test_post_return_gate_cannot_count_as_a_live_invocation():
    events = [
        event("RETURN", time=1),
        event("BLOCKED", gate="late", time=2),
        event("ALIVE", gate="late", time=4),
        event("BLOCKED", "b", time=3),
        event("ALIVE", "b", time=4),
    ]
    with pytest.raises(ev.PlacementError):
        ev.overlap(events, {"a", "b"})
