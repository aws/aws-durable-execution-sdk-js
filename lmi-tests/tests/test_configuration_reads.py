# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
from types import SimpleNamespace
from unittest.mock import Mock

import cloud
import deploy
import pytest
from botocore.exceptions import ClientError


def service_error(code):
    return ClientError({"Error": {"Code": code, "Message": "test"}}, "GetFunctionConfiguration")


def test_configuration_throttling_recovers_with_bounded_backoff(monkeypatch):
    sleep = Mock()
    monkeypatch.setattr(deploy.time, "sleep", sleep)
    read = Mock(side_effect=[service_error("TooManyRequestsException"), {"State": "Active"}])
    assert deploy.read_configuration(read, FunctionName="qualified:1") == {"State": "Active"}
    assert read.call_count == 2
    assert all(call.kwargs == {"FunctionName": "qualified:1"} for call in read.call_args_list)
    sleep.assert_called_once_with(0.25)


def test_configuration_retry_exhaustion_is_reported_without_restarting_writes(monkeypatch):
    sleep = Mock()
    monkeypatch.setattr(deploy.time, "sleep", sleep)
    error = service_error("TooManyRequestsException")
    read = Mock(side_effect=error)
    with pytest.raises(ClientError) as raised:
        deploy.read_configuration(read, FunctionName="qualified:1")
    assert raised.value is error
    assert read.call_count == 5
    assert [call.args[0] for call in sleep.call_args_list] == [0.25, 0.5, 1, 2]


@pytest.mark.parametrize("code", ["AccessDeniedException", "ResourceNotFoundException"])
def test_configuration_permanent_errors_are_not_retried(code, monkeypatch):
    sleep = Mock()
    monkeypatch.setattr(deploy.time, "sleep", sleep)
    read = Mock(side_effect=service_error(code))
    with pytest.raises(ClientError):
        deploy.read_configuration(read, FunctionName="qualified:1")
    read.assert_called_once()
    sleep.assert_not_called()


def test_runtime_configuration_validation_still_fails_after_throttle_recovery(monkeypatch):
    monkeypatch.setattr(deploy.time, "sleep", lambda _: None)
    instance = cloud.Cloud.__new__(cloud.Cloud)
    instance.manifest = {"functions": {"shared": "qualified:1"}}
    instance.lam = SimpleNamespace(
        get_function_configuration=Mock(
            side_effect=[service_error("TooManyRequestsException"), {"State": "Active"}]
        ),
        get_function_scaling_config=Mock(return_value={}),
    )
    validate = Mock(side_effect=ValueError("wrong deployed artifact"))
    monkeypatch.setattr(cloud, "verify", validate)
    with pytest.raises(ValueError, match="wrong deployed artifact"):
        instance.verify()
    validate.assert_called_once_with({"State": "Active"}, {}, instance.manifest, "shared")


def test_invoke_uses_one_attempt_while_configuration_clients_keep_their_policy(monkeypatch):
    clients = []

    def sdk_client(service, **kwargs):
        result = SimpleNamespace(
            service=service, attempts=kwargs["config"].retries["total_max_attempts"]
        )
        clients.append(result)
        return result

    monkeypatch.setenv("AWS_REGION", "us-west-2")
    monkeypatch.setattr(deploy.boto3, "client", sdk_client)
    instance = cloud.Cloud({})
    assert instance.invoker is not instance.lam
    assert instance.invoker.attempts == 1
    assert instance.lam.attempts == 2
    assert len(clients) == 4
