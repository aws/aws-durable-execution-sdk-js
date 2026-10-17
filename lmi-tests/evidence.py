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


def worker_identity(event):
    return tuple(event[key] for key in ("environment", "worker", "pid", "threadId"))


def overlap(events, markers, *, gates=None, requests=None):
    """Find overlapping held intervals, scoped to a request AND a gate.

    A completed earlier gate must neither invalidate a current hold nor provide
    a heartbeat for it. Explicit request selection prevents a retry replacing
    the original invocation in a deadline precondition.
    """
    from itertools import product

    gates, requests = gates or {}, requests or {}
    candidates = []
    for marker in sorted(markers):
        intervals = []
        for start in events:
            if start["phase"] != "BLOCKED" or start["marker"] != marker:
                continue
            if marker in gates and start.get("gate") != gates[marker]:
                continue
            if marker in requests and start["request"] != requests[marker]:
                continue
            related = [
                e for e in events if e["marker"] == marker and e["request"] == start["request"]
            ]
            ends = [
                e["time"]
                for e in related
                if e["phase"] in {"RETURN", "RAISE"}
                or (
                    e["time"] >= start["time"]
                    and (
                        (e["phase"] == "RELEASED" and e.get("gate") == start.get("gate"))
                        or (
                            e["phase"] == "BLOCKED"
                            and e.get("gate") == start.get("gate")
                            and e["time"] > start["time"]
                        )
                    )
                )
            ]
            end = min(ends, default=float("inf"))
            alive = [
                e["time"]
                for e in related
                if e["phase"] == "ALIVE"
                and e.get("gate") == start.get("gate")
                and worker_identity(e) == worker_identity(start)
                and start["time"] <= e["time"] < end
            ]
            if alive:
                intervals.append((start, end, max(alive)))
        if not intervals:
            raise PlacementError(f"No live held interval for {marker}")
        candidates.append(intervals)
    if not candidates:
        raise PlacementError("No invocation targets")
    for group in product(*candidates):
        starts = [interval[0] for interval in group]
        if len({e["request"] for e in starts}) != len(markers):
            continue
        identities = {worker_identity(e) for e in starts}
        if len(identities) != 1:
            continue
        cutoff = max(e["time"] for e in starts)
        if all(cutoff < end and last_alive >= cutoff for _, end, last_alive in group):
            return next(iter(identities))
    raise PlacementError("No overlapping live gates in the same Node.js worker")


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


def check_all(checks):
    """Retain independent outcomes so recovery cannot mask old-request writes."""
    outcomes = {}
    for name, check in checks.items():
        try:
            check()
            outcomes[name] = {"status": "passed"}
        except CollectionError as error:
            outcomes[name] = {"status": "collection-error", "message": str(error)}
        except AssertionError as error:
            outcomes[name] = {"status": "assertion-failed", "message": str(error)}
    return outcomes


def require_checks(outcomes):
    failures = [
        f"{name}: {result['status']}: {result.get('message', '')}"
        for name, result in outcomes.items()
        if result["status"] != "passed"
    ]
    if failures:
        message = "\n".join(failures)
        if any(result["status"] == "collection-error" for result in outcomes.values()):
            raise CollectionError(message)
        raise AssertionError(message)


def timely_probe(timing, deadline):
    """Validate driver scheduling independently of the worker's recovery bound."""
    for field in ("prepareEnd", "invokeBegin", "invokeEnd", "scheduledFor"):
        if field not in timing:
            raise CollectionError(f"Missing probe timing: {field}")
    scheduled = timing["scheduledFor"]
    if timing["prepareEnd"]["wall"] > scheduled:
        raise CollectionError("Probe controls were not prepared before scheduled submission")
    # Queue demand one second before the deadline, allowing up to one second of
    # driver scheduling jitter. Never move the SDK deadline + grace cutoff.
    if not scheduled <= timing["invokeBegin"]["wall"] <= deadline:
        raise CollectionError("Recovery probe was submitted outside its pre-deadline window")


def recovery(events, probe, identity, deadline, grace, history):
    from datetime import datetime

    timely_probe(probe["timing"], deadline)
    started = next((e for e in history if e.get("EventType") == "ExecutionStarted"), None)
    if started is None:
        raise CollectionError("Missing service execution start for the recovery probe")
    timestamp = started["EventTimestamp"]
    if isinstance(timestamp, str):
        timestamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if timestamp.timestamp() > deadline + 1:
        raise CollectionError(
            "Service registered recovery demand too late to measure worker recovery"
        )
    entries = require(events, "ENTER")
    first = min(entries, key=lambda e: e["time"])
    assert worker_identity(first) == identity, "Replacement environment is not worker recovery"
    assert deadline - 1 <= first["time"] <= deadline + grace, (
        f"Worker admission at deadline {first['time'] - deadline:+.3f}s exceeded the recovery window"
    )
    held = [
        e
        for e in require(events, "BLOCKED")
        if e.get("gate") == "peer" and e["request"] == first["request"]
    ]
    assert held, "Admitted probe did not progress to held work"


def timeout_retry(events, original_request):
    retries = [e for e in require(events, "ENTER") if e["request"] != original_request]
    if not retries:
        raise CollectionError("No service retry of the same durable execution was observed")
    assert len({e["execution"] for e in events}) == 1, (
        "A new execution cannot substitute for replay"
    )
    assert len([e for e in select(events, "BODY") if e["operation"] == "success"]) == 1, (
        "Completed success body repeated across timeout/retry"
    )
