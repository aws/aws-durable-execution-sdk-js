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
