# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
from types import SimpleNamespace
from unittest.mock import Mock

import cloud as driver
import pytest
from botocore.exceptions import ClientError
from evidence import CollectionError


@pytest.fixture
def execution_reader(monkeypatch, tmp_path):
    clock = {"time": 0.0}

    def sleep(seconds):
        clock["time"] += seconds

    monkeypatch.setattr(
        driver,
        "time",
        SimpleNamespace(time=lambda: clock["time"], monotonic=lambda: clock["time"], sleep=sleep),
    )
    monkeypatch.setattr(driver, "ARTIFACTS", tmp_path)
    monkeypatch.setattr(driver, "client", lambda _service, **_kwargs: object())
    cloud = driver.Cloud({"run": "run", "functions": {}})
    cloud.invoker = SimpleNamespace(invoke=Mock(side_effect=AssertionError("Do not retry Invoke")))
    return cloud, clock, tmp_path


def service_error(code):
    return ClientError({"Error": {"Code": code, "Message": "test"}}, "GetDurableExecution")


def test_finish_observes_accepted_execution_without_reinvoking(execution_reader):
    cloud, clock, output = execution_reader
    result = {"Status": "SUCCEEDED", "Result": '"ready"'}
    read = Mock(
        side_effect=[
            service_error("ResourceNotFoundException"),
            service_error("TooManyRequestsException"),
            {"Status": "RUNNING"},
            result,
        ]
    )
    cloud.lam = SimpleNamespace(get_durable_execution=read)
    item = {"arn": "accepted-arn", "marker": "diagnostic"}
    assert cloud.finish(item, seconds=2) == result
    assert clock["time"] == 1.5
    assert read.call_count == 4
    assert all(
        call.kwargs == {"DurableExecutionArn": "accepted-arn"} for call in read.call_args_list
    )
    cloud.invoker.invoke.assert_not_called()
    assert (output / "executions/diagnostic.json").exists()


@pytest.mark.parametrize("code", ["ResourceNotFoundException", "TooManyRequestsException"])
def test_finish_retains_original_deadline_when_read_never_succeeds(execution_reader, code):
    cloud, clock, output = execution_reader
    read = Mock(side_effect=service_error(code))
    cloud.lam = SimpleNamespace(get_durable_execution=read)
    with pytest.raises(CollectionError, match="Evidence deadline exceeded"):
        cloud.finish({"arn": "accepted-arn", "marker": "diagnostic"}, seconds=1)
    assert clock["time"] == 1
    assert read.call_count == 2
    cloud.invoker.invoke.assert_not_called()
    assert not (output / "executions/diagnostic.json").exists()


def test_finish_propagates_permanent_read_errors(execution_reader):
    cloud, clock, _ = execution_reader
    failure = service_error("AccessDeniedException")
    read = Mock(side_effect=failure)
    cloud.lam = SimpleNamespace(get_durable_execution=read)
    with pytest.raises(ClientError) as error:
        cloud.finish({"arn": "accepted-arn", "marker": "diagnostic"}, seconds=30)
    assert error.value is failure
    assert clock["time"] == 0
    assert read.call_count == 1
    cloud.invoker.invoke.assert_not_called()


def test_finish_does_not_turn_unexpected_terminal_failure_into_success(execution_reader):
    cloud, clock, _ = execution_reader
    cloud.lam = SimpleNamespace(
        get_durable_execution=Mock(
            side_effect=[
                service_error("ResourceNotFoundException"),
                {"Status": "FAILED", "Error": {"ErrorMessage": "business failure"}},
            ]
        )
    )
    with pytest.raises(AssertionError):
        cloud.finish({"arn": "accepted-arn", "marker": "diagnostic"}, seconds=30)
    assert clock["time"] == 0.5
    cloud.invoker.invoke.assert_not_called()


@pytest.fixture(params=["case", "run"])
def cleanup_reader(execution_reader, request):
    cloud, clock, output = execution_reader
    cloud.manifest.update(bucket="bucket", commit="commit", quietSeconds=1, drainTimeout=10)
    item = {
        "arn": "accepted-arn",
        "marker": "owned-case",
        "gates": {"loser": "owned-gate"},
        "invoked": True,
    }
    cloud.save_item(item)
    cloud.items = [] if request.param == "run" else [item]
    cloud.gates = set() if request.param == "run" else {"owned-gate"}
    cloud.control = Mock()
    cloud.running = lambda: []  # Only the saved ARN is known; lists/events lag too.
    cloud.worker_snapshot = lambda: {"requests": []}
    cloud.s3 = SimpleNamespace(
        get_paginator=lambda _name: SimpleNamespace(paginate=lambda **_kwargs: [{}])
    )
    cloud.history = Mock(return_value=[])
    cleanup = cloud.settle_run if request.param == "run" else cloud.close_case
    return cloud, clock, output, cleanup


@pytest.mark.parametrize("code", ["ResourceNotFoundException", "TooManyRequestsException"])
@pytest.mark.parametrize("status", ["RUNNING", "SUCCEEDED"])
def test_cleanup_retries_known_arn_visibility_within_shared_drain_budget(
    cleanup_reader, code, status
):
    cloud, clock, output, cleanup = cleanup_reader
    pending = []

    def read(**kwargs):
        assert kwargs == {"DurableExecutionArn": "accepted-arn"}
        if clock["time"] < 2:
            pending.append(cloud.unresolved_markers())
            raise service_error(code)
        return {"Status": status}

    stop = Mock()
    cloud.lam = SimpleNamespace(
        get_durable_execution=Mock(side_effect=read), stop_durable_execution=stop
    )
    cleanup()
    assert pending and all(markers == {"owned-case"} for markers in pending)
    assert 2 <= clock["time"] <= 10
    cloud.control.assert_called_once_with("owned-gate", "release")
    assert stop.call_count == (1 if status == "RUNNING" else 0)
    assert cloud.cleaned_executions == {"accepted-arn"}
    assert cloud.unresolved_markers() == set()
    assert cloud.items[0]["settled"] is True
    assert (output / "executions/owned-case.json").exists()
    cloud.invoker.invoke.assert_not_called()


@pytest.mark.parametrize("code", ["ResourceNotFoundException", "TooManyRequestsException"])
def test_cleanup_keeps_invisible_known_arn_pending_until_drain_budget_expires(cleanup_reader, code):
    cloud, clock, output, cleanup = cleanup_reader
    cloud.manifest["drainTimeout"] = 4
    stop = Mock()
    cloud.lam = SimpleNamespace(
        get_durable_execution=Mock(side_effect=service_error(code)), stop_durable_execution=stop
    )
    with pytest.raises(CollectionError, match="did not become quiescent"):
        cleanup()
    assert clock["time"] == 4
    assert cloud.unresolved_markers() == {"owned-case"}
    assert cloud.cleaned_executions == set()
    assert not cloud.items[0].get("settled")
    assert not (output / "executions/owned-case.json").exists()
    stop.assert_not_called()
    cloud.invoker.invoke.assert_not_called()


def test_cleanup_surfaces_permanent_known_arn_read_errors_immediately(cleanup_reader):
    cloud, clock, _output, cleanup = cleanup_reader
    read = Mock(side_effect=service_error("AccessDeniedException"))
    stop = Mock()
    cloud.lam = SimpleNamespace(get_durable_execution=read, stop_durable_execution=stop)
    with pytest.raises(CollectionError, match="AccessDeniedException"):
        cleanup()
    assert clock["time"] == 0
    assert read.call_count == 1
    assert cloud.cleaned_executions == set()
    stop.assert_not_called()
    cloud.invoker.invoke.assert_not_called()


def test_cleanup_retries_visibility_after_stop_conflict_before_claiming_completion(cleanup_reader):
    cloud, _clock, _output, cleanup = cleanup_reader
    read = Mock(
        side_effect=[
            {"Status": "RUNNING"},
            service_error("ResourceNotFoundException"),
            {"Status": "SUCCEEDED"},
        ]
    )
    stop = Mock(
        side_effect=ClientError(
            {"Error": {"Code": "ResourceConflictException", "Message": "terminal transition"}},
            "StopDurableExecution",
        )
    )
    cloud.lam = SimpleNamespace(get_durable_execution=read, stop_durable_execution=stop)
    cleanup()
    assert read.call_count == 3
    stop.assert_called_once_with(DurableExecutionArn="accepted-arn")
    assert cloud.cleaned_executions == {"accepted-arn"}
    cloud.invoker.invoke.assert_not_called()
