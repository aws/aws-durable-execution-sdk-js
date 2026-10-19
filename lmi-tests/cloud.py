# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Real Lambda/S3 transport; no local runner, mocked deadline, or time skipping."""

import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from botocore.exceptions import ClientError
from deploy import ARTIFACTS, QUALIFIER, client, read_configuration, save, verify
from evidence import CollectionError


class Cloud:
    def __init__(self, manifest):
        self.manifest = manifest
        self.lam, self.s3, self.logs = client("lambda"), client("s3"), client("logs")
        # Deadline demand has one measured attempt. Do not hide a retry inside botocore.
        self.invoker = client("lambda", total_max_attempts=1)
        self.items, self.gates, self.cache = [], set(), {}
        self.next_history_read = 0.0
        self.completed_diagnostics = set()
        self.cleaned_executions = set()
        self.released_gates = set()

    def verify(self):
        for key, arn in self.manifest["functions"].items():
            verify(
                read_configuration(self.lam.get_function_configuration, FunctionName=arn),
                read_configuration(
                    self.lam.get_function_scaling_config,
                    FunctionName=arn.rsplit(":", 1)[0],
                    Qualifier=QUALIFIER,
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
        path = ARTIFACTS / f"invocations/{item['marker']}.json"
        temporary = path.with_suffix(".json." + uuid.uuid4().hex + ".tmp")
        try:
            save(
                temporary,
                {**item, "run": self.manifest["run"], "commit": self.manifest.get("commit")},
            )
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)

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
        if item.get("invoked") or "invokeBegin" in item["timing"]:
            raise CollectionError("An Invoke attempt must not be silently repeated")
        payload = {key: item[key] for key in ("marker", "gates")}
        payload["scenario"] = item["scenario"]
        payload["run"] = self.manifest["run"]
        # Persist ambiguous invocation ownership before submission. Disk latency
        # belongs to preparation, never to the recorded Lambda Invoke timestamp.
        item["invoked"] = True
        item["timing"]["invokeIntent"] = self.timestamp()
        self.save_item(item)
        # No control PUTs or evidence collection between this timestamp and Invoke.
        item["timing"]["invokeBegin"] = self.timestamp()
        try:
            result = self.invoker.invoke(
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

    def read_execution(self, item):
        """Read once; an accepted ARN may still be invisible or throttled."""
        try:
            return self.lam.get_durable_execution(DurableExecutionArn=item["arn"])
        except ClientError as error:
            if error.response["Error"]["Code"] not in {
                "ResourceNotFoundException",
                "TooManyRequestsException",
            }:
                raise
            # The caller owns the deadline. Do not repeat Invoke, infer
            # completion, or start a new per-execution polling budget here.
            return None

    def finish(self, item, status="SUCCEEDED", seconds=150):
        def terminal():
            response = self.read_execution(item)
            return response if response is not None and response["Status"] != "RUNNING" else None

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
                config = read_configuration(self.lam.get_function_configuration, FunctionName=arn)
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

    def invoked_markers(self):
        return {
            item["marker"]
            for item in self.items
            if item.get("arn") or item.get("invoked") or "invokeBegin" in item.get("timing", {})
        }

    def unresolved_markers(self):
        return self.invoked_markers() - {
            item["marker"] for item in self.items if item.get("arn") in self.cleaned_executions
        }

    def restore_invocations(self, markers=None):
        """Recover this run's invocation intent after a driver/child process exits."""
        quarantine = ARTIFACTS / "quarantine.json"
        pending = json.loads(quarantine.read_text()) if quarantine.exists() else {}
        pending_markers = (
            set(pending.get("markers", [])) if pending.get("run") == self.manifest["run"] else set()
        )
        if markers is not None:
            markers = set(markers)
            pending_markers &= markers
        known = {item["marker"]: item for item in self.items}
        for path in (ARTIFACTS / "invocations").glob("*.json"):
            item = json.loads(path.read_text())
            if item.get("run") != self.manifest["run"] or item.get("commit") != self.manifest.get(
                "commit"
            ):
                continue
            if markers is not None and item["marker"] not in markers:
                continue
            if item.get("settled") and item["marker"] not in pending_markers and markers is None:
                continue
            if item.get("arn") or item.get("invoked") or "invokeBegin" in item.get("timing", {}):
                known.setdefault(item["marker"], item)
                self.gates.update(item.get("gates", {}).values())
        for marker in pending_markers:
            known.setdefault(marker, {"marker": marker, "gates": {}, "invoked": True})
        self.items = list(known.values())

    def load_markers(self, markers, *, running=None):
        """Restore invoked case markers, retaining attempts not yet observable."""
        markers = set(markers)
        previous = {item["marker"]: item for item in self.items}

        def record(marker, arn=None):
            item = {
                **previous.get(marker, {"marker": marker, "gates": {}}),
                "invoked": True,
                "settled": False,
            }
            if arn:
                item["arn"] = arn
            return item

        # The settle-case CLI may be the only surviving owner of these markers.
        # Persist them before any discovery I/O can fail or the child can time out.
        self.items = [record(marker) for marker in sorted(markers)]
        for item in self.items:
            self.save_item(item)
        items = {item["arn"]: item for item in self.items if item.get("arn")}
        for event in self.refresh(markers=markers):
            if event["marker"] in markers:
                items[event["execution"]] = record(event["marker"], event["execution"])
        for item in self.running() if running is None else running:
            if item.get("DurableExecutionName") in markers:
                items[item["DurableExecutionArn"]] = record(
                    item["DurableExecutionName"], item["DurableExecutionArn"]
                )
        resolved = {item["marker"] for item in items.values()}
        self.items = list(items.values()) + [
            record(marker) for marker in sorted(markers - resolved)
        ]
        for item in self.items:
            self.save_item(item)

    def mark_settled(self):
        for item in self.items:
            item["settled"] = True
            self.save_item(item)

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
            item["settled"] = True
            self.save_item(item)
            return snapshot
        finally:
            # Diagnostic invocations are not business test cases. Their own
            # lifecycle is excluded by the worker snapshot, not by clearing work.
            self.items.remove(item)

    def quiesce(self, label, on_activity=None):
        deadline = time.monotonic() + self.manifest.get("drainTimeout", 150)
        quiet = self.manifest.get("quietSeconds", 5)
        quiet_since, samples, previous_activity = None, [], None
        while time.monotonic() < deadline:
            running = self.running()
            if running and on_activity:
                # Release known held work before asking the same bounded worker
                # pool to admit a diagnostic invocation.
                on_activity({"requests": []}, running)
            probe_start = self.timestamp()
            snapshot = self.worker_snapshot()
            probe_end = self.timestamp()
            samples.append(
                {
                    "time": probe_end,
                    "probeStart": probe_start,
                    "probeEnd": probe_end,
                    "worker": snapshot,
                    "running": running,
                }
            )
            save(
                ARTIFACTS / f"quiescence/{label}.json", {"quietSeconds": quiet, "samples": samples}
            )
            if probe_end["monotonic"] >= deadline:
                break
            activity = (
                snapshot.get("environment"),
                snapshot.get("worker"),
                snapshot.get("activityVersion", 0),
            )
            if not snapshot["requests"] and not running and not self.unresolved_markers():
                if activity != previous_activity:
                    quiet_since = None
                # Acquisition happened somewhere inside each probe interval.
                # Exclude both boundary probes' delivery latency: even the
                # latest possible first acquisition and earliest possible last
                # acquisition must be at least quietSeconds apart.
                quiet_since = probe_end["monotonic"] if quiet_since is None else quiet_since
                if probe_start["monotonic"] - quiet_since >= quiet:
                    return
            else:
                quiet_since = None
                if on_activity:
                    on_activity(snapshot, running)
            previous_activity = activity
            time.sleep(2)
        raise CollectionError(
            "Shared LMI worker did not become quiescent; subsequent cases must not run"
        )

    def release_and_stop(self, *, discover=True):
        failures = []
        for gate in self.gates - self.released_gates:
            try:
                self.control(gate, "release")
                self.released_gates.add(gate)
            except Exception as error:
                failures.append(str(error))
        invoked = self.invoked_markers()
        unresolved = {
            item["marker"]
            for item in self.items
            if item["marker"] in invoked and not item.get("arn")
        }
        if unresolved and discover:
            # An Invoke timeout does not mean the service rejected it. Discover
            # only this case's invoked markers, including executions whose first
            # worker event has not arrived yet. Prepared-only probes are excluded.
            def discover():
                self.load_markers(invoked)
                return unresolved <= {item["marker"] for item in self.items if item.get("arn")}

            try:
                self.poll(
                    discover,
                    seconds=min(30, self.manifest.get("drainTimeout", 150)),
                    message="Could not resolve invoked executions during teardown: "
                    + ", ".join(sorted(unresolved)),
                )
            except Exception as error:
                failures.append(str(error))
        for item in self.items:
            if not item.get("arn") or item["arn"] in self.cleaned_executions:
                continue
            try:
                result = self.read_execution(item)
                if result is None:
                    continue
                if result["Status"] == "RUNNING":
                    try:
                        self.lam.stop_durable_execution(DurableExecutionArn=item["arn"])
                    except ClientError as error:
                        if error.response["Error"]["Code"] != "ResourceConflictException":
                            raise
                        confirmed = self.read_execution(item)
                        if confirmed is None:
                            continue
                        if confirmed["Status"] == "RUNNING":
                            raise
                self.history(item)
                save(ARTIFACTS / f"executions/{item['marker']}.json", result)
                self.cleaned_executions.add(item["arn"])
            except Exception as error:
                failures.append(str(error))
        label = self.items[0]["marker"] if self.items else "empty-" + uuid.uuid4().hex[:8]
        if failures:
            save(ARTIFACTS / f"quiescence/{label}-errors.json", failures)
            raise CollectionError("Failed to release/stop this case: " + "; ".join(failures))
        return label

    def remember_worker_requests(self, snapshot, markers=None):
        known = {item["marker"]: item for item in self.items}
        for request in snapshot["requests"]:
            if markers is not None and request["marker"] not in markers:
                continue
            item = known.setdefault(request["marker"], {"marker": request["marker"], "gates": {}})
            if not item.get("arn"):
                item["arn"] = request["execution"]
        self.items = list(known.values())

    def close_case(self):
        markers = self.invoked_markers()
        label = self.release_and_stop()

        def cleanup(snapshot, running):
            self.remember_worker_requests(snapshot, markers)
            self.load_markers(markers, running=running)
            self.release_and_stop(discover=False)

        self.quiesce(label, on_activity=cleanup)
        self.refresh()
        self.mark_settled()

    def settle_run(self):
        self.restore_invocations()
        # Held work can occupy the whole pool before service listings expose
        # its ARN. Release this run's controls before asking it to admit a probe.
        prefix = f"control/{self.manifest['run']}/"
        for page in self.s3.get_paginator("list_objects_v2").paginate(
            Bucket=self.manifest["bucket"], Prefix=prefix
        ):
            for obj in page.get("Contents", []):
                gate = obj["Key"][len(prefix) :]
                if gate != "release-all":
                    self.gates.add(gate)
        self.release_and_stop(discover=False)

        def cleanup(snapshot, running):
            self.remember_worker_requests(snapshot)
            events = self.refresh(full=True)
            markers = {
                event["marker"] for event in events if not event["marker"].startswith("quiescence-")
            }
            markers.update(self.invoked_markers())
            markers.update(item["DurableExecutionName"] for item in running)
            self.load_markers(markers, running=running)
            # The quiet loop owns this run's one drain budget and continues
            # service/worker discovery for unresolved persisted attempts.
            self.release_and_stop(discover=False)

        running = self.running()
        if running or self.invoked_markers():
            cleanup({"requests": []}, running)
        # Keep the cheap idle path, but switch to owned-run cleanup if service
        # visibility or worker evidence appears during the same quiet window.
        # This callback does not restart the drain deadline or another quiet loop.
        self.quiesce("between-runs-" + uuid.uuid4().hex[:8], on_activity=cleanup)
        self.mark_settled()
