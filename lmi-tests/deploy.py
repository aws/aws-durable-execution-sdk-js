# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Build, update, verify, and settle the persistent shared LMI fixture."""

import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import time
import zipfile
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from evidence import ProvisioningError

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "lmi-tests/artifacts"
OWNER = "js-sdk-lmi-e2e"
DEFAULT_STACK = "js-lmi-e2e"
SCALING = {"MinExecutionEnvironments": 1, "MaxExecutionEnvironments": 1}
QUALIFIER = "$LATEST.PUBLISHED"


def client(service, region=None):
    return boto3.client(
        service,
        region_name=region or os.environ["AWS_REGION"],
        config=Config(connect_timeout=3, read_timeout=10, retries={"total_max_attempts": 2}),
    )


def scrub(value):
    if isinstance(value, dict):
        return {
            k: "<redacted>" if k in {"CheckpointToken", "CallbackId"} else scrub(v)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (ValueError, TypeError):
            return value
        if isinstance(decoded, (dict, list)):
            return json.dumps(scrub(decoded))
    return value


def save(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(scrub(data), indent=2, default=str) + "\n")


def build():
    subprocess.run(["node", "lmi-tests/build.mjs"], cwd=ROOT, check=True)
    artifact = ROOT / "lmi-tests/build/function.zip"
    with zipfile.ZipFile(artifact, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(ROOT / "lmi-tests/build/index.cjs", "index.cjs")
    save(
        ARTIFACTS / "build.json",
        {
            "commit": subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
            ).strip(),
            "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
        },
    )


def template(manifest, functions=True):
    bucket = manifest["bucket"]
    resources = {
        "Bucket": {
            "Type": "AWS::S3::Bucket",
            "Properties": {
                "BucketName": bucket,
                "PublicAccessBlockConfiguration": {
                    "BlockPublicAcls": True,
                    "IgnorePublicAcls": True,
                    "BlockPublicPolicy": True,
                    "RestrictPublicBuckets": True,
                },
                "BucketEncryption": {
                    "ServerSideEncryptionConfiguration": [
                        {"ServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}
                    ]
                },
                "LifecycleConfiguration": {
                    "Rules": [
                        {
                            "Id": "control-expiry",
                            "Prefix": "control/",
                            "Status": "Enabled",
                            "ExpirationInDays": 2,
                            "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1},
                        },
                        {
                            "Id": "event-expiry",
                            "Prefix": "events/",
                            "Status": "Enabled",
                            "ExpirationInDays": 7,
                        },
                    ]
                },
            },
        },
        "BucketPolicy": {
            "Type": "AWS::S3::BucketPolicy",
            "Properties": {
                "Bucket": {"Ref": "Bucket"},
                "PolicyDocument": {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Effect": "Allow",
                            "Principal": {"AWS": manifest["role"]},
                            "Action": ["s3:GetObject", "s3:PutObject"],
                            "Resource": [
                                f"arn:aws:s3:::{bucket}/events/*",
                                f"arn:aws:s3:::{bucket}/control/*",
                            ],
                        },
                        {
                            "Effect": "Deny",
                            "Principal": "*",
                            "Action": "s3:*",
                            "Resource": [
                                f"arn:aws:s3:::{bucket}",
                                f"arn:aws:s3:::{bucket}/*",
                            ],
                            "Condition": {"Bool": {"aws:SecureTransport": "false"}},
                        },
                    ],
                },
            },
        },
    }
    outputs = {}
    if functions:
        for key, timeout in (("shared", manifest["invocationTimeout"]),):
            name = manifest["stack"] + "-" + key
            resources[key + "Logs"] = {
                "Type": "AWS::Logs::LogGroup",
                "Properties": {
                    "LogGroupName": "/aws/lambda/" + name,
                    "RetentionInDays": 1,
                },
            }
            resources[key + "Function"] = {
                "Type": "AWS::Lambda::Function",
                "DependsOn": "BucketPolicy",
                "Properties": {
                    "FunctionName": name,
                    "Runtime": manifest["runtime"],
                    "Architectures": ["arm64"],
                    "Handler": "index.handler",
                    "Role": manifest["role"],
                    "MemorySize": 2048,
                    "Timeout": timeout,
                    "Code": {"S3Bucket": bucket, "S3Key": manifest["codeKey"]},
                    "FunctionScalingConfig": SCALING,
                    "DurableConfig": {
                        "ExecutionTimeout": manifest["executionTimeout"],
                        "RetentionPeriodInDays": 1,
                    },
                    "CapacityProviderConfig": {
                        "LambdaManagedInstancesCapacityProviderConfig": {
                            "CapacityProviderArn": manifest["provider"],
                            "PerExecutionEnvironmentMaxConcurrency": manifest["concurrency"],
                            "ExecutionEnvironmentMemoryGiBPerVCpu": 2,
                        }
                    },
                    "Environment": {
                        "Variables": {
                            "LMI_BUCKET": bucket,
                            "LMI_COMMIT": manifest["commit"],
                            "LMI_RUN_ID": manifest["run"],
                            "AWS_LAMBDA_NODEJS_WORKER_COUNT": "1",
                            "AWS_RETRY_MODE": "standard",
                        }
                    },
                    "LoggingConfig": {
                        "LogFormat": "JSON",
                        "ApplicationLogLevel": "INFO",
                        "SystemLogLevel": "INFO",
                        "LogGroup": {"Ref": key + "Logs"},
                    },
                },
            }
            if manifest.get("runtimeVersion"):
                resources[key + "Function"]["Properties"]["RuntimeManagementConfig"] = {
                    "UpdateRuntimeOn": "Manual",
                    "RuntimeVersionArn": manifest["runtimeVersion"],
                }
            # LMI publishes this qualified version automatically, including its
            # scaling settings. An extra numbered version would allocate more capacity.
            outputs[key] = {
                "Value": {
                    "Fn::Join": [
                        "",
                        [{"Fn::GetAtt": [key + "Function", "Arn"]}, ":" + QUALIFIER],
                    ]
                }
            }
    for resource in resources.values():
        if resource["Type"] in {"AWS::Lambda::Function", "AWS::S3::Bucket", "AWS::Logs::LogGroup"}:
            resource["DeletionPolicy"] = "Retain"
            resource["UpdateReplacePolicy"] = "Retain"
    return {
        "AWSTemplateFormatVersion": "2010-09-09",
        "Resources": resources,
        "Outputs": outputs,
    }


def wait_stack(cfn, name, expected, seconds=1500):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            result = cfn.describe_stacks(StackName=name)["Stacks"][0]
        except ClientError as error:
            if expected == "DELETE_COMPLETE" and "does not exist" in str(error):
                return None
            raise
        status = result["StackStatus"]
        if status == expected:
            return result
        if "FAILED" in status or "ROLLBACK" in status:
            save(
                ARTIFACTS / "stack-events.json",
                cfn.describe_stack_events(StackName=name),
            )
            raise ProvisioningError(f"{name}: {status}; no fallback to standard Lambda")
        time.sleep(3)
    raise ProvisioningError(f"{name}: provisioning/retirement deadline exceeded")


def verify(config, scaling, manifest, key):
    actual = config.get("CapacityProviderConfig", {}).get(
        "LambdaManagedInstancesCapacityProviderConfig", {}
    )
    checks = [
        actual.get("CapacityProviderArn") == manifest["provider"],
        actual.get("PerExecutionEnvironmentMaxConcurrency") == manifest["concurrency"],
        config.get("Environment", {}).get("Variables", {}).get("AWS_LAMBDA_NODEJS_WORKER_COUNT")
        == "1",
        config.get("Runtime") == manifest["runtime"],
        config.get("Architectures") == ["arm64"],
        config.get("Version") == QUALIFIER,
        config.get("CodeSha256") == manifest["codeSha256"],
        not manifest.get("runtimeVersion")
        or config.get("RuntimeVersionConfig", {}).get("RuntimeVersionArn")
        == manifest["runtimeVersion"],
        config.get("MemorySize") == 2048,
        config.get("State") == "Active",
        config.get("DurableConfig", {}).get("ExecutionTimeout") == manifest["executionTimeout"],
        config.get("Timeout") == manifest["invocationTimeout"],
        scaling.get("AppliedFunctionScalingConfig") == SCALING,
        config.get("Environment", {}).get("Variables", {}).get("LMI_COMMIT") == manifest["commit"],
        config.get("Environment", {}).get("Variables", {}).get("LMI_RUN_ID") == manifest["run"],
    ]
    if not all(checks):
        raise ProvisioningError(f"{key}: LMI configuration/artifact/scaling readback mismatch")


def existing_stack(cfn, name):
    try:
        return cfn.describe_stacks(StackName=name)["Stacks"][0]
    except ClientError as error:
        if error.response["Error"]["Code"] == "ValidationError" and "does not exist" in str(error):
            return None
        raise


def require_owned_stack(stack, name):
    tags = {t["Key"]: t["Value"] for t in stack.get("Tags", [])}
    if tags.get("Suite") != OWNER or tags.get("Persistent") != "true" or tags.get("Stack") != name:
        raise ProvisioningError("Persistent stack is not owned by this suite")
    if stack["StackStatus"] not in {
        "CREATE_COMPLETE",
        "UPDATE_COMPLETE",
        "UPDATE_ROLLBACK_COMPLETE",
    }:
        raise ProvisioningError(
            f"Persistent stack requires recovery from {stack['StackStatus']}; resources retained"
        )


def update_persistent_stack(cfn, manifest, stack, tags):
    require_owned_stack(stack, manifest["stack"])
    try:
        cfn.update_stack(
            StackName=manifest["stack"], TemplateBody=json.dumps(template(manifest)), Tags=tags
        )
    except ClientError as error:
        if "No updates are to be performed" not in str(error):
            raise
        return stack
    return wait_stack(cfn, manifest["stack"], "UPDATE_COMPLETE")


def settle_previous(stack, bucket):
    """Release and drain the previous deployment before publishing new code."""
    if not stack.get("Outputs"):
        return
    arn = next(o["OutputValue"] for o in stack["Outputs"] if o["OutputKey"] == "shared")
    config = client("lambda").get_function_configuration(FunctionName=arn)
    previous_run = config["Environment"]["Variables"]["LMI_RUN_ID"]
    response = client("s3").get_object(
        Bucket=bucket, Key=f"deployments/{previous_run}/manifest.json"
    )
    with response["Body"] as body:
        previous = json.loads(body.read())
    from cloud import Cloud

    cloud = Cloud(previous)
    cloud.verify()
    cloud.settle_run()


def deploy(args):
    if not args.run_id or not re.fullmatch(r"[a-z0-9-]{1,24}", args.run_id):
        raise ProvisioningError("run-id must be 1-24 lowercase letters, digits or hyphens")
    provider = os.environ["CAPACITY_PROVIDER_ARN"]
    account = client("sts").get_caller_identity()["Account"]
    if account != os.environ["TEST_ACCOUNT_ID"] or provider.split(":")[3:5] != [
        os.environ["AWS_REGION"],
        account,
    ]:
        raise ProvisioningError(
            "Authenticated account/region must match the test account and capacity provider"
        )
    capacity = client("lambda").get_capacity_provider(
        CapacityProviderName=provider.rsplit(":", 1)[-1].split("/")[-1]
    )
    save(ARTIFACTS / "capacity-provider.json", capacity)
    provider_config = capacity["CapacityProvider"]
    if (
        not 2
        <= provider_config.get("CapacityProviderScalingConfig", {}).get("MaxVCpuCount", 0)
        <= 128
    ):
        raise ProvisioningError("Use a bounded, test-owned capacity provider (2-128 maximum vCPUs)")
    data = (ROOT / "lmi-tests/build/function.zip").read_bytes()
    digest = hashlib.sha256(data).digest()
    built = json.loads((ARTIFACTS / "build.json").read_text())
    if built["sha256"] != digest.hex():
        raise ProvisioningError("Artifact changed since build")
    name = args.stack_name
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,37}", name):
        raise ProvisioningError("stack-name must be 1-38 lowercase letters, digits or hyphens")
    bucket = f"{name}-{account}-{hashlib.sha256(os.environ['AWS_REGION'].encode()).hexdigest()[:8]}"
    manifest = {
        "run": args.run_id,
        "stack": name,
        "persistent": True,
        "bucket": bucket,
        "account": account,
        "region": os.environ["AWS_REGION"],
        "provider": provider,
        "role": os.environ["TEST_LAMBDA_EXECUTION_ROLE_ARN"],
        "runtime": args.runtime,
        "runtimeVersion": os.environ.get("LMI_RUNTIME_VERSION_ARN", ""),
        "concurrency": args.concurrency,
        "workerCount": 1,
        "commit": built["commit"],
        "codeKey": "code/" + digest.hex() + ".zip",
        "codeSha256": base64.b64encode(digest).decode(),
        "invocationTimeout": 60,
        "executionTimeout": 300,
        "driverTimeout": 150,
        "cleanupGrace": 5,
        "quietSeconds": 5,
        "drainTimeout": 150,
        "created": time.time(),
        "functions": {
            "shared": f"arn:aws:lambda:{os.environ['AWS_REGION']}:{account}:function:{name}-shared:{QUALIFIER}"
        },
    }
    cfn, s3 = client("cloudformation"), client("s3")
    tags = [
        {"Key": "Suite", "Value": OWNER},
        {"Key": "Stack", "Value": name},
        {"Key": "Persistent", "Value": "true"},
    ]
    stack = existing_stack(cfn, name)
    if stack is None:
        cfn.create_stack(
            StackName=name, TemplateBody=json.dumps(template(manifest, False)), Tags=tags
        )
        stack = wait_stack(cfn, name, "CREATE_COMPLETE", 180)
    else:
        require_owned_stack(stack, name)
        settle_previous(stack, bucket)
    # Do not expire code objects: the active deployment and CloudFormation rollback
    # may still reference them. Only run-scoped controls/events have TTLs.
    s3.put_object(Bucket=bucket, Key=manifest["codeKey"], Body=data)
    s3.put_object(Bucket=bucket, Key=f"control/{args.run_id}/release-all", Body=b"hold")
    s3.put_object(
        Bucket=bucket,
        Key=f"deployments/{args.run_id}/manifest.json",
        Body=json.dumps(manifest).encode(),
        IfNoneMatch="*",
    )
    save(ARTIFACTS / "manifest.json", manifest)
    save(ARTIFACTS / "template.json", template(manifest))
    stack = update_persistent_stack(cfn, manifest, stack, tags)
    outputs = {o["OutputKey"]: o["OutputValue"] for o in stack["Outputs"]}
    if outputs != manifest["functions"]:
        raise ProvisioningError("Persistent stack did not expose the one expected shared function")
    for key, arn in manifest["functions"].items():
        config = client("lambda").get_function_configuration(FunctionName=arn)
        scaling = client("lambda").get_function_scaling_config(
            FunctionName=arn.rsplit(":", 1)[0], Qualifier=QUALIFIER
        )
        save(ARTIFACTS / f"configuration/{key}.json", {"function": config, "scaling": scaling})
        verify(config, scaling, manifest, key)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["build", "deploy", "collect", "settle", "settle-case"])
    parser.add_argument("--run-id")
    parser.add_argument("--stack-name", default=DEFAULT_STACK)
    parser.add_argument("--runtime", choices=["nodejs24.x"], default="nodejs24.x")
    parser.add_argument("--concurrency", type=int, choices=[2], default=2)
    parser.add_argument("--markers", default="")
    args = parser.parse_args()
    try:
        if args.command == "build":
            build()
        elif args.command == "deploy":
            deploy(args)
        else:
            from cloud import Cloud

            manifest = json.loads((ARTIFACTS / "manifest.json").read_text())
            cloud = Cloud(manifest)
            cloud.verify()
            if args.command == "collect":
                cloud.collect()
            elif args.command == "settle":
                cloud.settle_run()
            else:
                cloud.load_markers([m for m in args.markers.split(",") if m])
                cloud.close_case()
    except Exception as error:
        save(
            ARTIFACTS / f"{args.command}-error.json",
            {"type": type(error).__name__, "message": str(error)},
        )
        if args.command in {"settle", "settle-case"}:
            save(ARTIFACTS / "quarantine.json", {"error": str(error)})
        raise


if __name__ == "__main__":
    main()
