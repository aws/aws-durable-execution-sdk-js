"""OTel acceptance against genuine runtime headers and the shared LMI worker."""

import time
import uuid

import evidence as ev
import pytest
import telemetry_evidence as otel
import test_cloud as lifecycle


@pytest.fixture(params=["invocation", "execution"])
def view(request):
    return request.param


def header(sampled="1"):
    return (
        f"Root=1-{int(time.time()):08x}-{uuid.uuid4().hex[:24]};"
        f"Parent={uuid.uuid4().hex[:16]};Sampled={sampled}"
    )


def finish(cloud, item, status="SUCCEEDED", outcome="success"):
    cloud.finish(item, status)
    cloud.phase(item, "OTEL_EXIT")

    def collected():
        events = cloud.events(item)
        try:
            otel.invocation(events, expected_outcome=outcome)
            otel.terminal(events, failed=status == "FAILED")
        except ev.CollectionError:
            return None
        return events

    events = cloud.poll(collected, seconds=30, message="OTel export evidence remained incomplete")
    entry = min(ev.select(events, "OTEL_ENTER"), key=lambda event: event["time"])
    actual, sent = otel.parse_header(entry["carrier"]), otel.parse_header(item["traceHeader"])
    assert actual["trace_id"] == sent["trace_id"], "Lambda lost the caller X-Ray Root"
    assert actual["sampled"] == sent["sampled"], "Lambda changed explicit sampling"
    return events


@pytest.mark.parametrize("sampled", ["0", "1"])
def test_native_carrier_and_sampling(cloud, view, sampled):
    item = cloud.start("success", otel_view=view, trace_header=header(sampled))
    finish(cloud, item)


def test_native_concurrency_and_peer_cleanup(cloud, view):
    items = [
        cloud.start("barrier", otel_view=view, trace_header=header())
        for _ in range(cloud.manifest["concurrency"])
    ]
    lifecycle.overlap(cloud, *items)
    events = []
    for index, item in enumerate(items):
        cloud.release(item, "peer")
        events.extend(finish(cloud, item))
        for peer in items[index + 1 :]:
            observed = cloud.events(peer)
            assert ev.select(observed, "ALIVE"), "Missing held peer heartbeat"
            assert not ev.select(observed, "OTEL_EXIT"), "Ending A also ended B"
    otel.invocation(events)


def test_warm_success_failure_and_real_resume(cloud, view):
    identities, providers = set(), set()
    for scenario in ["success", "failure", "replay"] * 2:
        item = cloud.start(scenario, otel_view=view, trace_header=header())
        events = finish(cloud, item, "FAILED" if scenario == "failure" else "SUCCEEDED")
        for entry in ev.select(events, "OTEL_ENTER"):
            identities.add((entry["environment"], entry["worker"], entry["pid"], entry["threadId"]))
            providers.add(entry["provider"])
        if scenario == "replay":
            ev.replay(events, cloud.history(item))
    assert len(identities) == 1, "Warm test replaced the observed worker"
    assert len(providers) == 1, "Provider was rebuilt for each invocation"


def test_export_failure_preserves_next_invocation(cloud, view):
    item = cloud.start("success", otel_view=view, trace_header=header(), otel_export="failure")
    finish(cloud, item, outcome="failure")
    healthy = cloud.start("success", otel_view=view, trace_header=header())
    finish(cloud, healthy)


def test_flush_budget_and_late_export_settlement(cloud, view):
    item = cloud.start("success", otel_view=view, trace_header=header(), otel_export="held")
    held = cloud.phase(item, "OTEL_EXPORT_HELD")[0]
    boundary = cloud.phase(item, "RETURN")[0]
    assert boundary["time"] - held["time"] <= 1 + cloud.manifest["cleanupGrace"], (
        "The configured one-second flush budget did not bound invocation finalization"
    )
    # The exporter is still held after the SDK return. Releasing it is cleanup,
    # never evidence that the earlier finalization bound was met.
    assert not ev.select(cloud.events(item), "OTEL_EXPORT")
    cloud.release(item, "export")
    cloud.phase(item, "OTEL_EXPORT")
    cloud.poll(
        lambda: any(
            event["span"]["name"] == "Invocation"
            for event in ev.select(cloud.events(item), "OTEL_EXPORT")
        )
    )
    finish(cloud, item)
    healthy = cloud.start("success", otel_view=view, trace_header=header())
    finish(cloud, healthy)


@pytest.mark.parametrize(
    "scenario",
    [
        "race",
        "any",
        "map",
        "parallel",
        "nested",
        "return-inflight",
        "failure-inflight",
        "deadline-step",
        "deadline-checkpoint",
    ],
)
def test_plugin_lifecycle_boundaries(cloud, view, scenario, monkeypatch):
    assert cloud.manifest["concurrency"] == 2, "Peer lifecycle tests require native concurrency 2"
    original = cloud.prepare

    def prepare(*args, **kwargs):
        return original(*args, **kwargs, otel_view=view, trace_header=header())

    monkeypatch.setattr(cloud, "prepare", prepare)
    if scenario.startswith("deadline"):
        lifecycle.test_platform_deadline_old_work_and_original_worker_recovery(cloud, scenario)
    else:
        lifecycle.test_early_return_rejects_late_work_and_preserves_peer(cloud, scenario)
    for item in cloud.items:
        if item.get("arn"):
            otel.invocation(cloud.events(item))
