# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import copy

import evidence as ev
import pytest


def event(phase, marker="a", **kwargs):
    return dict(
        phase=phase,
        marker=marker,
        request=marker,
        environment="env",
        worker="worker",
        pid=1,
        threadId=1,
        time=10,
        **kwargs,
    )


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
