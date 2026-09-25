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
    monkeypatch.setattr(driver, "client", lambda service: services[service])
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
