# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Assertions use worker event time, never S3/CloudWatch observation latency."""


class ProvisioningError(RuntimeError):
    pass


class CollectionError(RuntimeError):
    pass


class PlacementError(CollectionError):
    pass


def select(events, phase):
    return [e for e in events if e["phase"] == phase]


def require(events, phase):
    found = select(events, phase)
    if not found:
        raise CollectionError(f"Missing {phase} evidence")
    return found


def overlap(events, markers):
    blocked = [e for e in events if e["phase"] == "BLOCKED" and e["marker"] in markers]
    if {e["marker"] for e in blocked} != set(markers):
        raise PlacementError("Every invocation must enter held work")
    identities = {(e["environment"], e["worker"], e["pid"], e["threadId"]) for e in blocked}
    if len(identities) != 1 or len({e["request"] for e in blocked}) != len(markers):
        raise PlacementError("Invocations did not share one environment and Node worker")
    latest = max(e["time"] for e in blocked)
    for event in blocked:
        alive = [
            e
            for e in events
            if e["phase"] == "ALIVE" and e["request"] == event["request"] and e["time"] >= latest
        ]
        if not alive:
            raise PlacementError("Entry records alone do not establish live overlap")
        if any(
            e["phase"] == "RELEASED" and e["request"] == event["request"] and e["time"] <= latest
            for e in events
        ):
            raise PlacementError("Work was released before overlap")
    return next(iter(identities))


def no_late_work(events, boundary):
    assert not select(events, "ESCAPE"), "Fixture escape cannot satisfy a lifecycle assertion"
    request = boundary["request"]
    late = [e for e in events if e["request"] == request and e["time"] > boundary["time"]]
    assert not [e for e in late if e["phase"] in {"CHECKPOINT", "POLL", "SEND"}], (
        "#927: closed invocation sent an SDK request"
    )
    assert not [
        e
        for e in late
        if e["phase"] == "BODY" and e["operation"] in {"late-operation", "after-deadline"}
    ], "#927: closed invocation started a new durable step"
    # loser-effect represents already-running, non-cooperative I/O. Record it,
    # but do not claim JS can cancel arbitrary Promises or promise exactly-once.


def tokens(events):
    owners = {}
    for event in events:
        if event["phase"] not in {"CHECKPOINT", "POLL"}:
            continue
        assert event["target"] == event["execution"], "Cross-execution checkpoint target"
        owner = owners.setdefault(event["token"], event["request"])
        assert owner == event["request"], "Concurrent requests shared a checkpoint token"


def resources(events):
    observations = require(events, "OBSERVED")
    closed = require(events, "RETURN")
    assert {e["request"] for e in observations} >= {e["request"] for e in closed}, (
        "Missing post-return resource observation"
    )
    for event in observations:
        assert event["resources"] == {"timers": 0, "lateCallbacks": 0}, (
            "#927: SDK timer/immediate survived disposal"
        )


def replay(events, history):
    entries = require(events, "ENTER")
    assert len({e["request"] for e in entries}) >= 2, "No real resume/replay occurred"
    for operation in ("success", "stored-failure", "after-wait"):
        assert len([e for e in select(events, "BODY") if e["operation"] == operation]) == 1, (
            f"Replayed user body: {operation}"
        )
    failures = require(events, "STORED_FAILURE")
    assert len(failures) >= 2 and len({e["message"] for e in failures}) == 1, (
        "Stored failure changed on replay"
    )
    assert not select(events, "COMPENSATION"), "Suspension triggered business compensation"
    pending = [e for e in require(events, "RETURN") if e["status"] == "PENDING"]
    assert pending, "Wait did not suspend"
    # JS intentionally leaves the suspended stack pending. Java's root-finally
    # ordering contract cannot be copied: reject artificial rejection/unwinding.
    assert not [
        e for e in select(events, "WAIT_FINALLY") if e["request"] in {p["request"] for p in pending}
    ], "Suspension unwound the user stack"
    assert any(e.get("EventType") == "WaitSucceeded" for e in history), "No service wait completion"
    assert any(e.get("EventType") == "StepFailed" for e in history), "No checkpointed failure"


def timeout_record(history, request):
    import json

    for event in history:
        details = event.get("InvocationCompletedDetails", {})
        error = json.dumps(details.get("Error", {})).lower().replace(" ", "")
        if details.get("RequestId") == request and any(
            label in error for label in ("timeout", "timedout")
        ):
            return event
    return None
