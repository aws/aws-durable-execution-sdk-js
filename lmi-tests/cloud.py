# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Real Lambda/S3 transport; no local runner, mocked deadline, or time skipping."""

import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from botocore.exceptions import ClientError
from deploy import ARTIFACTS, QUALIFIER, client, save, verify
from evidence import CollectionError


class Cloud:
    def __init__(self, manifest):
        self.manifest = manifest
        self.lam, self.s3, self.logs = client("lambda"), client("s3"), client("logs")
        self.items, self.gates, self.cache = [], set(), {}
        self.next_history_read = 0.0

    def verify(self):
        for key, arn in self.manifest["functions"].items():
            verify(
                self.lam.get_function_configuration(FunctionName=arn),
                self.lam.get_function_scaling_config(
                    FunctionName=arn.rsplit(":", 1)[0], Qualifier=QUALIFIER
                ),
                self.manifest,
                key,
            )

    def control(self, gate, value):
        self.s3.put_object(
            Bucket=self.manifest["bucket"], Key="control/" + gate, Body=value.encode()
        )

    def start(self, scenario, fixture="normal"):
        marker = scenario + "-" + uuid.uuid4().hex[:12]
        gates = {key: marker + "-" + key for key in ("peer", "loser", "winner", "transport")}
        for gate in gates.values():
            self.control(gate, "hold")
            self.gates.add(gate)
        payload = {"marker": marker, "scenario": scenario, "gates": gates}
        result = self.lam.invoke(
            FunctionName=self.manifest["functions"][fixture],
            InvocationType="Event",
            DurableExecutionName=marker,
            Payload=json.dumps(payload).encode(),
        )
        arn = result.get("DurableExecutionArn")
        if not arn:
            raise CollectionError("Invoke did not return DurableExecutionArn")
        item = {"marker": marker, "arn": arn, "fixture": fixture, "gates": gates}
        self.items.append(item)
        save(ARTIFACTS / f"invocations/{marker}.json", item)
        return item

    def release(self, item, gate):
        self.control(item["gates"][gate], "release")

    def refresh(self, full=False):
        prefixes = ["events/"] if full else [f"events/{i['marker']}/" for i in self.items]
        missing = []
        for prefix in prefixes:
            for page in self.s3.get_paginator("list_objects_v2").paginate(
                Bucket=self.manifest["bucket"], Prefix=prefix
            ):
                missing.extend(
                    o["Key"] for o in page.get("Contents", []) if o["Key"] not in self.cache
                )

        def read(key):
            response = self.s3.get_object(Bucket=self.manifest["bucket"], Key=key)
            with response["Body"] as stream:
                event = json.loads(stream.read())
            if event["run"] != self.manifest["run"] or event["commit"] != self.manifest["commit"]:
                raise CollectionError("Evidence belongs to another deployment")
            return key, event

        with ThreadPoolExecutor(max_workers=8) as pool:
            self.cache.update(pool.map(read, missing))
        events = list(self.cache.values())
        save(ARTIFACTS / "events.json", events)
        return events

    def events(self, item):
        events = [e for e in self.refresh() if e["marker"] == item["marker"]]
        if any(e["phase"] == "FIXTURE_ERROR" for e in events):
            raise CollectionError("Fixture/control failure; cannot interpret SDK assertions")
        return events

    def poll(
        self,
        fn,
        seconds=90,
        error=CollectionError,
        message="Evidence deadline exceeded",
    ):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            value = fn()
            if value:
                return value
            time.sleep(0.5)
        raise error(message)

    def phase(self, item, phase, gate=None, **kwargs):
        return self.poll(
            lambda: [
                e
                for e in self.events(item)
                if e["phase"] == phase and (gate is None or e.get("gate") == gate)
            ],
            **kwargs,
        )

    def finish(self, item, status="SUCCEEDED"):
        def terminal():
            response = self.lam.get_durable_execution(DurableExecutionArn=item["arn"])
            return response if response["Status"] != "RUNNING" else None

        result = self.poll(terminal, seconds=150)
        save(ARTIFACTS / f"executions/{item['marker']}.json", result)
        assert result["Status"] == status, result
        if status == "FAILED":
            assert result["Error"]["ErrorMessage"] == "expected:" + item["marker"]
        return result

    def history(self, item):
        events, marker = [], None
        while True:
            # Pace real history reads; bounded throttle retries do not retry writes.
            time.sleep(max(0, self.next_history_read - time.monotonic()))
            request = {"DurableExecutionArn": item["arn"], "IncludeExecutionData": True}
            if marker:
                request["Marker"] = marker
            for attempt in range(5):
                try:
                    page = self.lam.get_durable_execution_history(**request)
                    break
                except ClientError as error:
                    if (
                        error.response["Error"]["Code"] != "TooManyRequestsException"
                        or attempt == 4
                    ):
                        raise
                    time.sleep(2**attempt)
            self.next_history_read = time.monotonic() + 1
            events.extend(page.get("Events", []))
            marker = page.get("NextMarker")
            if not marker:
                break
        save(ARTIFACTS / f"histories/{item['marker']}.json", events)
        return events

    def collect(self):
        events = self.refresh(full=True)
        items = {e["execution"]: {"arn": e["execution"], "marker": e["marker"]} for e in events}
        errors = []
        for item in items.values():
            try:
                self.history(item)
                save(
                    ARTIFACTS / f"executions/{item['marker']}.json",
                    self.lam.get_durable_execution(DurableExecutionArn=item["arn"]),
                )
            except Exception as error:
                errors.append(str(error))
        for key, arn in self.manifest["functions"].items():
            try:
                config = self.lam.get_function_configuration(FunctionName=arn)
                logs = []
                for page in self.logs.get_paginator("filter_log_events").paginate(
                    logGroupName=config["LoggingConfig"]["LogGroup"],
                    startTime=int(self.manifest["created"] * 1000),
                ):
                    logs.extend(page.get("events", []))
                save(ARTIFACTS / f"logs/{key}.json", logs)
            except Exception as error:
                errors.append(str(error))
        if errors:
            save(ARTIFACTS / "collection-errors.json", errors)
            raise CollectionError("; ".join(errors))

    def close_case(self):
        for gate in self.gates:
            self.control(gate, "release")
        # Stop retries after retaining evidence. Logical stop is not evidence that
        # old JS stacks exited; timeout fixtures are isolated from normal/warm cases.
        for item in self.items:
            self.history(item)
            result = self.lam.get_durable_execution(DurableExecutionArn=item["arn"])
            save(ARTIFACTS / f"executions/{item['marker']}.json", result)
            if result["Status"] == "RUNNING":
                self.lam.stop_durable_execution(DurableExecutionArn=item["arn"])
        self.refresh()
