# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import copy

import pytest
from deploy import QUALIFIER, SCALING, template, verify
from evidence import ProvisioningError


@pytest.fixture
def manifest():
    return dict(
        bucket="test-bucket",
        stack="test-stack",
        role="test-role",
        runtime="nodejs24.x",
        codeKey="code/digest.zip",
        codeSha256="digest",
        concurrency=2,
        provider="provider",
        commit="commit",
        run="run",
        invocationTimeout=180,
        deadlineTimeout=60,
        executionTimeout=300,
    )


def test_template_deploys_lmi_at_two_concurrent_invocations_with_one_environment(
    manifest,
):
    resources = template(manifest)["Resources"]
    functions = [
        r["Properties"] for r in resources.values() if r["Type"] == "AWS::Lambda::Function"
    ]
    assert len(functions) == 3
    for function in functions:
        assert function["Runtime"] == "nodejs24.x"
        assert function["Environment"]["Variables"]["AWS_LAMBDA_NODEJS_WORKER_COUNT"] == "1"
        assert function["Handler"] == "index.handler"
        assert function["FunctionScalingConfig"] == SCALING
        assert (
            function["CapacityProviderConfig"]["LambdaManagedInstancesCapacityProviderConfig"][
                "PerExecutionEnvironmentMaxConcurrency"
            ]
            == 2
        )
    assert {f["Timeout"] for f in functions} == {60, 180}


def configuration(manifest):
    return dict(
        CapacityProviderConfig={
            "LambdaManagedInstancesCapacityProviderConfig": {
                "CapacityProviderArn": "provider",
                "PerExecutionEnvironmentMaxConcurrency": 2,
            }
        },
        Runtime="nodejs24.x",
        Architectures=["arm64"],
        Version=QUALIFIER,
        CodeSha256="digest",
        MemorySize=2048,
        State="Active",
        DurableConfig={"ExecutionTimeout": 300},
        Timeout=180,
        Environment={
            "Variables": {
                "LMI_COMMIT": "commit",
                "LMI_RUN_ID": "run",
                "AWS_LAMBDA_NODEJS_WORKER_COUNT": "1",
            }
        },
    )


def test_readback_accepts_exact_artifact_and_configuration(manifest):
    verify(
        configuration(manifest),
        {"AppliedFunctionScalingConfig": SCALING},
        manifest,
        "normal",
    )


@pytest.mark.parametrize(
    "key,value",
    [
        ("CodeSha256", "wrong"),
        ("Version", "$LATEST"),
        ("Runtime", "nodejs22.x"),
        ("Timeout", 10),
        ("CapacityProviderConfig", {}),
    ],
)
def test_readback_rejects_wrong_artifact_runtime_and_capacity(manifest, key, value):
    config = configuration(manifest)
    config[key] = value
    with pytest.raises(ProvisioningError):
        verify(config, {"AppliedFunctionScalingConfig": SCALING}, manifest, "normal")


def test_readback_rejects_extra_execution_environments(manifest):
    scaling = copy.deepcopy(SCALING)
    scaling["MaxExecutionEnvironments"] = 2
    with pytest.raises(ProvisioningError):
        verify(
            configuration(manifest),
            {"AppliedFunctionScalingConfig": scaling},
            manifest,
            "normal",
        )


@pytest.mark.parametrize("workers", [None, "2", "8"])
def test_readback_rejects_missing_or_multiple_workers(manifest, workers):
    config = configuration(manifest)
    variables = config["Environment"]["Variables"]
    if workers is None:
        del variables["AWS_LAMBDA_NODEJS_WORKER_COUNT"]
    else:
        variables["AWS_LAMBDA_NODEJS_WORKER_COUNT"] = workers
    with pytest.raises(ProvisioningError):
        verify(config, {"AppliedFunctionScalingConfig": SCALING}, manifest, "normal")
