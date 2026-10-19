# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import cloud as driver
import evidence as ev
import pytest


@pytest.fixture
def setup(monkeypatch, tmp_path):
    class Clock:
        wall = 100.0

        def time(self):
            return self.wall

        def monotonic(self):
            return self.wall - 80

        def sleep(self, seconds):
            self.wall += seconds

    clock, calls = Clock(), []

    def put(**kwargs):
        calls.append(("put", clock.time(), kwargs))
        clock.sleep(0.25)

    def invoke(**kwargs):
        calls.append(("invoke", clock.time(), kwargs))
        clock.sleep(0.2)
        return {
            "DurableExecutionArn": "execution",
            "ResponseMetadata": {"RequestId": "api-request"},
        }

    lam = SimpleNamespace(invoke=invoke)
    services = {"lambda": lam, "s3": SimpleNamespace(put_object=put), "logs": object()}
    monkeypatch.setattr(driver, "client", lambda service, **_kwargs: services[service])
    monkeypatch.setattr(driver, "time", clock)
    monkeypatch.setattr(driver, "ARTIFACTS", tmp_path)
    instance = driver.Cloud({"bucket": "bucket", "run": "run", "functions": {"shared": "function"}})
    return instance, clock, calls, tmp_path


def test_preparation_io_is_outside_scheduled_invoke(setup):
    cloud, clock, calls, output = setup
    probe = cloud.prepare("barrier")
    assert all(call[0] == "put" for call in calls)
    scheduled = clock.time() + 5
    cloud.invoke_at(probe, scheduled)
    assert [call[0] for call in calls] == ["put"] * 4 + ["invoke"]
    assert calls[-1][1] == scheduled
    assert json.loads(calls[-1][2]["Payload"])["scenario"] == "barrier"
    timing = json.loads((output / "invocations" / (probe["marker"] + ".json")).read_text())[
        "timing"
    ]
    assert timing["prepareEnd"]["monotonic"] - timing["prepareBegin"]["monotonic"] == 1
    assert timing["invokeEnd"]["monotonic"] - timing["invokeBegin"]["monotonic"] == pytest.approx(
        0.2
    )
    ev.timely_probe(timing, scheduled + 1)


def test_driver_delay_is_a_collection_error_even_if_worker_is_fast(setup):
    cloud, clock, _calls, _output = setup
    probe = cloud.prepare("barrier")
    scheduled = clock.time() + 1
    clock.sleep(10)
    cloud.invoke_at(probe, scheduled)
    with pytest.raises(ev.CollectionError, match="outside its pre-deadline window"):
        ev.timely_probe(probe["timing"], scheduled + 1)


def test_failed_invoke_keeps_timing_and_cannot_be_implicitly_retried(setup):
    cloud, _clock, _calls, output = setup
    probe = cloud.prepare("barrier")

    def fail(**_kwargs):
        raise TimeoutError("Invoke response unavailable")

    cloud.lam.invoke = fail
    with pytest.raises(TimeoutError):
        cloud.invoke(probe)
    saved = json.loads((output / "invocations" / (probe["marker"] + ".json")).read_text())
    assert "invokeBegin" in saved["timing"] and "invokeEnd" in saved["timing"]
    with pytest.raises(ev.CollectionError, match="must not be silently repeated"):
        cloud.invoke(probe)


def test_prepared_but_uninvoked_probe_is_not_treated_as_execution_during_cleanup(setup):
    cloud, _clock, calls, _output = setup
    cloud.prepare("barrier")
    cloud.refresh = lambda: []
    cloud.quiesce = lambda _label: None
    cloud.close_case()
    assert all(call[0] == "put" for call in calls)
    assert all(call[2]["Body"] == b"release" for call in calls[4:])


def probe_evidence(entered=100.2, held=106):
    timing = {
        "prepareEnd": {"wall": 90},
        "scheduledFor": 99,
        "invokeBegin": {"wall": 99.05},
        "invokeEnd": {"wall": 99.1},
    }
    base = dict(
        marker="probe", request="request", environment="env", worker="worker", pid=1, threadId=1
    )
    events = [
        dict(base, phase="ENTER", time=entered),
        dict(base, phase="BLOCKED", time=held, gate="peer"),
    ]
    history = [
        {
            "EventType": "ExecutionStarted",
            "EventTimestamp": datetime.fromtimestamp(99.08, timezone.utc),
        }
    ]
    return events, {"timing": timing}, history


def test_recovery_budget_measures_handler_entry_not_probe_step_or_observation_delay():
    events, probe, history = probe_evidence()
    # Held evidence may arrive later; worker admission was inside the original budget.
    ev.recovery(events, probe, ("env", "worker", 1, 1), 100, 5, history)


def test_real_late_admission_still_fails_the_five_second_bound():
    events, probe, history = probe_evidence(entered=105.2)
    with pytest.raises(AssertionError, match="exceeded the recovery window"):
        ev.recovery(events, probe, ("env", "worker", 1, 1), 100, 5, history)


def test_service_demand_delay_is_not_mislabeled_worker_recovery():
    events, probe, history = probe_evidence()
    history[0]["EventTimestamp"] = datetime.fromtimestamp(106.69, timezone.utc)
    with pytest.raises(ev.CollectionError, match="registered recovery demand too late"):
        ev.recovery(events, probe, ("env", "worker", 1, 1), 100, 5, history)


def test_replacement_worker_cannot_satisfy_recovery():
    events, probe, history = probe_evidence()
    with pytest.raises(AssertionError, match="Replacement environment"):
        ev.recovery(events, probe, ("env", "replacement", 1, 1), 100, 5, history)


def test_delayed_invoke_response_does_not_override_timely_service_admission():
    events, probe, history = probe_evidence()
    probe["timing"]["invokeEnd"]["wall"] = 110
    # Response delivery is diagnostic; actual timely service acceptance and
    # handler entry remain valid recovery evidence.
    ev.recovery(events, probe, ("env", "worker", 1, 1), 100, 5, history)


@pytest.mark.parametrize("visibility_delay", [0, 1])
def test_close_case_recovers_lost_invoke_response_without_worker_events(setup, visibility_delay):
    cloud, clock, _calls, _output = setup
    lost = cloud.prepare("barrier")
    prepared = cloud.prepare("barrier")

    def lost_response(**_kwargs):
        raise TimeoutError("Invoke was accepted but its response was lost")

    cloud.lam.invoke = lost_response
    with pytest.raises(TimeoutError):
        cloud.invoke(lost)
    assert not lost.get("arn")
    visible_at = clock.time() + visibility_delay
    cloud.s3.put_object = lambda **_kwargs: None
    stopped, histories, discoveries = [], [], []

    def running():
        discoveries.append(clock.time())
        # Other work and a prepared-only marker must not expand this case's
        # cleanup scope, even when the service happens to list matching names.
        executions = [
            {"DurableExecutionArn": "unrelated", "DurableExecutionName": "another-case"},
            {"DurableExecutionArn": "uninvoked", "DurableExecutionName": prepared["marker"]},
        ]
        if clock.time() >= visible_at:
            executions.append(
                {"DurableExecutionArn": "accepted", "DurableExecutionName": lost["marker"]}
            )
        return executions

    cloud.running = running
    cloud.s3.get_paginator = lambda _name: SimpleNamespace(paginate=lambda **_kwargs: [{}])
    cloud.lam.get_durable_execution = lambda **_kwargs: {"Status": "RUNNING"}
    cloud.lam.stop_durable_execution = lambda **kwargs: stopped.append(
        kwargs["DurableExecutionArn"]
    )
    cloud.history = lambda item: histories.append(item["arn"])

    def quiesce(_label):
        assert stopped == ["accepted"], (
            "Drain must not start before stopping the recovered execution"
        )

    cloud.quiesce = quiesce
    cloud.close_case()  # The pytest fixture calls this directly, not settle_run().
    assert stopped == histories == ["accepted"]
    assert discoveries[-1] >= visible_at
    if visibility_delay:
        assert len(discoveries) > 1
    assert cloud.cache == {}


def test_close_case_bounds_ambiguous_discovery_and_still_stops_known_executions(setup):
    cloud, clock, _calls, _output = setup
    cloud.manifest["drainTimeout"] = 2
    known = cloud.start("barrier")
    lost = cloud.prepare("barrier")

    def lost_response(**_kwargs):
        raise TimeoutError("Invoke response unavailable")

    cloud.lam.invoke = lost_response
    with pytest.raises(TimeoutError):
        cloud.invoke(lost)
    cloud.running = lambda: []
    cloud.s3.get_paginator = lambda _name: SimpleNamespace(paginate=lambda **_kwargs: [{}])
    cloud.lam.get_durable_execution = lambda **_kwargs: {"Status": "RUNNING"}
    stopped = []
    cloud.lam.stop_durable_execution = lambda **kwargs: stopped.append(
        kwargs["DurableExecutionArn"]
    )
    cloud.history = lambda _item: []
    cloud.quiesce = lambda _label: None
    cloud.gates.clear()  # Measure only the discovery budget, not control-write latency.
    begin = clock.time()
    with pytest.raises(ev.CollectionError, match="Could not resolve invoked executions"):
        cloud.close_case()
    assert stopped == [known["arn"]]
    assert clock.time() - begin == 2


def test_delayed_intent_persistence_does_not_hide_late_probe_submission(setup):
    cloud, clock, calls, output = setup
    probe = cloud.prepare("barrier")
    scheduled = clock.time() + 1
    original_save = cloud.save_item

    def delayed_save(item):
        original_save(item)
        if item.get("invoked") and "invokeBegin" not in item["timing"]:
            clock.sleep(2)

    cloud.save_item = delayed_save
    cloud.invoke_at(probe, scheduled)
    assert calls[-1][0] == "invoke" and calls[-1][1] == scheduled + 2
    timing = probe["timing"]
    assert timing["invokeIntent"]["wall"] == scheduled
    assert timing["invokeBegin"]["wall"] == scheduled + 2
    persisted = json.loads((output / "invocations" / f"{probe['marker']}.json").read_text())
    assert persisted["run"] == "run" and persisted["invoked"] is True
    with pytest.raises(ev.CollectionError, match="outside its pre-deadline window"):
        ev.timely_probe(timing, scheduled + 1)


def test_invoke_intent_is_already_durable_when_transport_starts(setup):
    cloud, _clock, _calls, output = setup
    item = cloud.prepare("barrier")

    def invoke(**_kwargs):
        persisted = json.loads((output / "invocations" / f"{item['marker']}.json").read_text())
        assert persisted["run"] == "run" and persisted["invoked"] is True
        assert "invokeIntent" in persisted["timing"]
        assert "invokeBegin" not in persisted["timing"]
        return {"DurableExecutionArn": "accepted"}

    cloud.lam.invoke = invoke
    cloud.invoke(item)


def test_interrupted_intent_write_preserves_previous_record_and_never_invokes(setup, monkeypatch):
    cloud, _clock, calls, output = setup
    item = cloud.prepare("barrier")
    path = output / "invocations" / f"{item['marker']}.json"
    previous = path.read_bytes()

    def interrupted_save(temporary, _item):
        temporary.write_text('{"incomplete":')
        raise OSError("record write interrupted")

    monkeypatch.setattr(driver, "save", interrupted_save)
    with pytest.raises(OSError, match="record write interrupted"):
        cloud.invoke(item)
    assert path.read_bytes() == previous
    assert not list(path.parent.glob("*.tmp"))
    assert all(call[0] == "put" for call in calls)
