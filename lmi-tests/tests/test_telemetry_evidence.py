"""Negative controls for the native OTel evidence acceptance gates."""

import copy

import pytest
import telemetry_evidence as otel


HEADER = "Root=1-6955b900-123456789012345678901234;Parent=1234567890123456;Sampled=1"


def records():
    base = {"request": "request", "execution": "execution", "time": 1}
    span = {
        "name": "Invocation",
        "trace_id": "6955b900123456789012345678901234",
        "span_id": "1111111111111111",
        "parent_id": "1234567890123456",
        "sampled": True,
        "start_ns": 1,
        "end_ns": 2,
        "status": "OK",
        "attributes": {"durable.execution.arn": "execution"},
    }
    return [
        {**base, "phase": "OTEL_ENTER", "carrier": HEADER, "carrier_available": True},
        {**base, "phase": "OTEL_FACTORY", "plugin_instance": "instance"},
        {**base, "phase": "OTEL_EXPORT", "outcome": "success", "span": span},
        {
            **base,
            "phase": "OTEL_EXPORT",
            "outcome": "success",
            "span": {**span, "name": "Workflow"},
        },
        {**base, "phase": "OTEL_EXIT", "context_restored": True, "exporter_shutdowns": 0},
    ]


def test_complete_sampled_evidence():
    events = records()
    otel.invocation(events)
    otel.terminal(events)


@pytest.mark.parametrize(
    "field,value",
    [
        ("trace_id", "0" * 32),
        ("parent_id", "0" * 16),
        ("sampled", False),
        ("attributes", {"durable.execution.arn": "different"}),
        ("end_ns", 0),
    ],
)
def test_wrong_attribution_sampling_and_timing_fail(field, value):
    events = records()
    events[2]["span"][field] = value
    with pytest.raises(AssertionError):
        otel.invocation(events)


@pytest.mark.parametrize("index", [0, 1, 2, 4])
def test_missing_evidence_is_not_a_pass(index):
    events = records()
    del events[index]
    with pytest.raises((AssertionError, otel.CollectionError)):
        otel.invocation(events)


def test_unsampled_requires_native_header_and_no_exports():
    events = [event for event in records() if event["phase"] != "OTEL_EXPORT"]
    events[0]["carrier"] = HEADER[:-1] + "0"
    otel.invocation(events)
    events.insert(2, records()[2])
    with pytest.raises(AssertionError, match="Sampled=0"):
        otel.invocation(events)


def test_duplicate_root_and_leaked_context_fail():
    events = records()
    events.append(copy.deepcopy(events[2]))
    with pytest.raises(otel.CollectionError):
        otel.invocation(events)
    events = records()
    events[-1]["context_restored"] = False
    with pytest.raises(AssertionError, match="context leaked"):
        otel.invocation(events)


def test_invalid_native_carrier_cannot_pass_as_fallback():
    events = records()
    events[0]["carrier"] = ""
    with pytest.raises(otel.CollectionError):
        otel.invocation(events)


@pytest.mark.parametrize("fails", [False, True])
def test_native_invoke_uses_isolated_trace_header_and_preserves_intent(fails, monkeypatch):
    import json
    from unittest.mock import Mock
    import cloud as driver

    owner = driver.Cloud.__new__(driver.Cloud)
    owner.manifest = {"run": "run", "functions": {"shared": "function:qualified"}}
    owner.invoker = Mock()
    owner.save_item = Mock()
    isolated = Mock()
    monkeypatch.setattr(driver, "client", lambda *args, **kwargs: isolated)
    item = {
        "marker": "stable-marker",
        "scenario": "success",
        "fixture": "shared",
        "gates": {},
        "timing": {},
        "otelView": "execution",
        "otelExport": "success",
        "traceHeader": HEADER,
    }

    def invoke(**kwargs):
        name, hook = isolated.meta.events.register.call_args.args
        assert name == "before-call.lambda.Invoke"
        params = {"headers": {}}
        hook(params=params)
        assert params["headers"]["X-Amzn-Trace-Id"] == HEADER
        payload = json.loads(kwargs["Payload"])
        assert "traceHeader" not in payload and payload["otelView"] == "execution"
        assert kwargs["DurableExecutionName"] == "stable-marker"
        if fails:
            raise RuntimeError("transport failed")
        return {
            "DurableExecutionArn": "execution",
            "ResponseMetadata": {"RequestId": "api-request"},
        }

    isolated.invoke.side_effect = invoke
    if fails:
        with pytest.raises(RuntimeError, match="transport failed"):
            owner.invoke(item)
    else:
        assert owner.invoke(item)["arn"] == "execution"
    assert item["invoked"] and "invokeEnd" in item["timing"]
    isolated.close.assert_called_once()
    owner.invoker.invoke.assert_not_called()
