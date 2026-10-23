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
        invocationTimeout=60,
        executionTimeout=300,
    )


def test_template_deploys_lmi_at_two_concurrent_invocations_with_one_environment(
    manifest,
):
    resources = template(manifest)["Resources"]
    functions = [
        r["Properties"] for r in resources.values() if r["Type"] == "AWS::Lambda::Function"
    ]
    assert len(functions) == 1
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
    assert {f["Timeout"] for f in functions} == {60}


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
        Timeout=60,
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
        "shared",
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
        verify(config, {"AppliedFunctionScalingConfig": SCALING}, manifest, "shared")


def test_readback_rejects_extra_execution_environments(manifest):
    scaling = copy.deepcopy(SCALING)
    scaling["MaxExecutionEnvironments"] = 2
    with pytest.raises(ProvisioningError):
        verify(
            configuration(manifest),
            {"AppliedFunctionScalingConfig": scaling},
            manifest,
            "shared",
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
        verify(config, {"AppliedFunctionScalingConfig": SCALING}, manifest, "shared")


def test_persistent_resources_and_active_code_do_not_expire(manifest):
    resources = template(manifest)["Resources"]
    for resource in resources.values():
        if resource["Type"] in {"AWS::Lambda::Function", "AWS::S3::Bucket", "AWS::Logs::LogGroup"}:
            assert resource["DeletionPolicy"] == resource["UpdateReplacePolicy"] == "Retain"
    rules = resources["Bucket"]["Properties"]["LifecycleConfiguration"]["Rules"]
    assert {rule["Prefix"] for rule in rules} == {"control/", "events/"}


def owned_stack(status="UPDATE_COMPLETE"):
    from deploy import OWNER

    return {
        "StackStatus": status,
        "Tags": [
            {"Key": "Suite", "Value": OWNER},
            {"Key": "Persistent", "Value": "true"},
            {"Key": "Stack", "Value": "test-stack"},
        ],
    }


def test_persistent_update_never_recreates_or_deletes_existing_functions(manifest, monkeypatch):
    import deploy
    from types import SimpleNamespace

    calls = []
    cfn = SimpleNamespace(update_stack=lambda **kwargs: calls.append(kwargs))
    stack = owned_stack()
    monkeypatch.setattr(deploy, "wait_stack", lambda *_args: stack)
    assert deploy.update_persistent_stack(cfn, manifest, stack, []) == stack
    assert len(calls) == 1 and calls[0]["StackName"] == "test-stack"


@pytest.mark.parametrize("status", ["CREATE_FAILED", "UPDATE_IN_PROGRESS", "ROLLBACK_COMPLETE"])
def test_unhealthy_stack_is_retained_for_recovery(status):
    from deploy import require_owned_stack

    with pytest.raises(ProvisioningError, match="resources retained"):
        require_owned_stack(owned_stack(status), "test-stack")


def test_unrelated_stack_is_not_updated():
    from deploy import require_owned_stack

    with pytest.raises(ProvisioningError, match="not owned"):
        require_owned_stack(owned_stack(), "different-stack")


def test_no_update_is_accepted_without_recreation(manifest):
    import deploy
    from botocore.exceptions import ClientError
    from types import SimpleNamespace

    def update(**_kwargs):
        raise ClientError(
            {"Error": {"Code": "ValidationError", "Message": "No updates are to be performed."}},
            "UpdateStack",
        )

    stack = owned_stack()
    assert (
        deploy.update_persistent_stack(SimpleNamespace(update_stack=update), manifest, stack, [])
        == stack
    )
