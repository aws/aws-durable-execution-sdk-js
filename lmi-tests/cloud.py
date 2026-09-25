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
        self.completed_diagnostics = set()

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
            Bucket=self.manifest["bucket"],
            Key=f"control/{self.manifest['run']}/" + gate,
            Body=value.encode(),
        )

    @staticmethod
    def timestamp():
        return {"wall": time.time(), "monotonic": time.monotonic()}

    def save_item(self, item):
        save(ARTIFACTS / f"invocations/{item['marker']}.json", item)

    def prepare(self, scenario, fixture="shared"):
        marker = scenario + "-" + uuid.uuid4().hex[:12]
        gates = (
            {}
            if scenario == "quiescence"
            else {key: marker + "-" + key for key in ("peer", "loser", "winner", "transport")}
        )
        item = {
            "marker": marker,
            "scenario": scenario,
            "fixture": fixture,
            "gates": gates,
            "timing": {"prepareBegin": self.timestamp(), "controls": [], "releases": []},
        }
        for gate in gates.values():
            begin = self.timestamp()
            self.control(gate, "hold")
            item["timing"]["controls"].append(
                {"gate": gate, "begin": begin, "end": self.timestamp()}
            )
            self.gates.add(gate)
        item["timing"]["prepareEnd"] = self.timestamp()
        self.items.append(item)
        self.save_item(item)
        return item

    def invoke(self, item):
        if "invokeBegin" in item["timing"]:
            raise CollectionError("An Invoke attempt must not be silently repeated")
        payload = {key: item[key] for key in ("marker", "gates")}
        payload["scenario"] = item["scenario"]
        payload["run"] = self.manifest["run"]
        # No control PUTs or evidence collection between this timestamp and Invoke.
        item["timing"]["invokeBegin"] = self.timestamp()
        try:
            result = self.lam.invoke(
                FunctionName=self.manifest["functions"][item["fixture"]],
                InvocationType="Event",
                DurableExecutionName=item["marker"],
                Payload=json.dumps(payload).encode(),
            )
            item["arn"] = result.get("DurableExecutionArn")
            item["invokeRequestId"] = result.get("ResponseMetadata", {}).get("RequestId")
            if not item["arn"]:
                raise CollectionError("Invoke did not return DurableExecutionArn")
            return item
        finally:
            item["timing"]["invokeEnd"] = self.timestamp()
            self.save_item(item)

    @staticmethod
    def wait_until(target):
        # Only scheduling happens here. API polling never consumes this interval.
        time.sleep(max(0, target - time.time()))

    def invoke_at(self, item, target):
        item["timing"]["scheduledFor"] = target
        self.wait_until(target)
        return self.invoke(item)

    def start(self, scenario, fixture="shared"):
        return self.invoke(self.prepare(scenario, fixture))

    def release(self, item, gate):
        begin = self.timestamp()
        try:
            self.control(item["gates"][gate], "release")
        finally:
            item["timing"]["releases"].append(
                {"gate": gate, "begin": begin, "end": self.timestamp()}
            )
            self.save_item(item)

    def refresh(self, full=False, markers=None):
        prefix = f"events/{self.manifest['run']}/"
        selected = markers if markers is not None else [i["marker"] for i in self.items]
        prefixes = [prefix] if full else [prefix + marker + "/" for marker in selected]
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

    def phase(self, item, phase, gate=None, request=None, **kwargs):
        return self.poll(
            lambda: [
                e
                for e in self.events(item)
                if e["phase"] == phase
                and (gate is None or e.get("gate") == gate)
                and (request is None or e["request"] == request)
            ],
            **kwargs,
        )

    def finish(self, item, status="SUCCEEDED", seconds=150):
        def terminal():
            response = self.lam.get_durable_execution(DurableExecutionArn=item["arn"])
            return response if response["Status"] != "RUNNING" else None

        result = self.poll(terminal, seconds=seconds)
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
        items = {
            e["execution"]: {"arn": e["execution"], "marker": e["marker"]}
            for e in events
            if not e["marker"].startswith("quiescence-")
        }
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

    def running(self):
        running = []
        for arn in self.manifest["functions"].values():
            for page in self.lam.get_paginator("list_durable_executions_by_function").paginate(
                FunctionName=arn.rsplit(":", 1)[0], Statuses=["RUNNING"]
            ):
                running.extend(
                    e
                    for e in page.get("DurableExecutions", [])
                    if e["DurableExecutionArn"] not in self.completed_diagnostics
                )
        return running

    def load_markers(self, markers):
        events = self.refresh(markers=markers)
        items = {
            e["execution"]: {"arn": e["execution"], "marker": e["marker"], "gates": {}}
            for e in events
            if e["marker"] in markers
        }
        # Invoke can have been accepted even if a failed test did not receive its
        # response or the handler never entered. Match only this case's names.
        for item in self.running():
            if item.get("DurableExecutionName") in markers:
                items[item["DurableExecutionArn"]] = {
                    "arn": item["DurableExecutionArn"],
                    "marker": item["DurableExecutionName"],
                    "gates": {},
                }
        self.items = list(items.values())

    def worker_snapshot(self):
        item = self.start("quiescence")
        try:
            result = self.finish(item, seconds=30)
            self.completed_diagnostics.add(item["arn"])
            snapshot = json.loads(result["Result"])
            if (
                snapshot.get("schema") != 1
                or snapshot.get("run") != self.manifest["run"]
                or not isinstance(snapshot.get("activityVersion"), int)
                or not isinstance(snapshot.get("environment"), str)
                or not isinstance(snapshot.get("worker"), str)
                or not isinstance(snapshot.get("requests"), list)
            ):
                raise CollectionError("Invalid quiescence snapshot or different deployed run")
            return snapshot
        finally:
            # Diagnostic invocations are not business test cases. Their own
            # lifecycle is excluded by the worker snapshot, not by clearing work.
            self.items.remove(item)

    def quiesce(self, label):
        deadline = time.monotonic() + self.manifest.get("drainTimeout", 150)
        quiet = self.manifest.get("quietSeconds", 5)
        quiet_since, samples, previous_activity = None, [], None
        while time.monotonic() < deadline:
            snapshot = self.worker_snapshot()
            running = self.running()
            samples.append({"time": self.timestamp(), "worker": snapshot, "running": running})
            save(
                ARTIFACTS / f"quiescence/{label}.json", {"quietSeconds": quiet, "samples": samples}
            )
            activity = (
                snapshot.get("environment"),
                snapshot.get("worker"),
                snapshot.get("activityVersion", 0),
            )
            if not snapshot["requests"] and not running:
                if activity != previous_activity:
                    quiet_since = None
                quiet_since = time.monotonic() if quiet_since is None else quiet_since
                if time.monotonic() - quiet_since >= quiet:
                    return
            else:
                quiet_since = None
            previous_activity = activity
            time.sleep(2)
        raise CollectionError(
            "Shared LMI worker did not become quiescent; subsequent cases must not run"
        )

    def close_case(self):
        failures = []
        for gate in self.gates:
            try:
                self.control(gate, "release")
            except Exception as error:
                failures.append(str(error))
        for item in self.items:
            if not item.get("arn"):
                continue
            try:
                result = self.lam.get_durable_execution(DurableExecutionArn=item["arn"])
                if result["Status"] == "RUNNING":
                    try:
                        self.lam.stop_durable_execution(DurableExecutionArn=item["arn"])
                    except ClientError as error:
                        if error.response["Error"]["Code"] != "ResourceConflictException":
                            raise
                        if (
                            self.lam.get_durable_execution(DurableExecutionArn=item["arn"])[
                                "Status"
                            ]
                            == "RUNNING"
                        ):
                            raise
                self.history(item)
                save(ARTIFACTS / f"executions/{item['marker']}.json", result)
            except Exception as error:
                failures.append(str(error))
        label = self.items[0]["marker"] if self.items else "empty-" + uuid.uuid4().hex[:8]
        if failures:
            save(ARTIFACTS / f"quiescence/{label}-errors.json", failures)
            raise CollectionError("Failed to release/stop this case: " + "; ".join(failures))
        self.quiesce(label)
        self.refresh()

    def settle_run(self):
        # Most runs were already drained after their final case. Avoid rereading
        # every old history/control on each deployment when the worker is idle.
        if not self.running() and not self.worker_snapshot()["requests"]:
            self.quiesce("between-runs-" + uuid.uuid4().hex[:8])
            return
        # Release this run's latches without deleting persistent infrastructure.
        prefix = f"control/{self.manifest['run']}/"
        for page in self.s3.get_paginator("list_objects_v2").paginate(
            Bucket=self.manifest["bucket"], Prefix=prefix
        ):
            for obj in page.get("Contents", []):
                gate = obj["Key"][len(prefix) :]
                if gate != "release-all":
                    self.gates.add(gate)
        events = self.refresh(full=True)
        markers = {e["marker"] for e in events if not e["marker"].startswith("quiescence-")}
        self.load_markers(markers)
        self.close_case()
