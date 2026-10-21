# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
from types import SimpleNamespace

import cloud as driver
import pytest
from evidence import CollectionError


@pytest.fixture
def quiet_cloud(monkeypatch, tmp_path):
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
    cloud = driver.Cloud({"run": "run", "quietSeconds": 5, "drainTimeout": 20, "functions": {}})
    cloud.running = lambda: []
    return cloud, clock, tmp_path


def test_quiet_window_restarts_if_old_work_reappears(quiet_cloud):
    cloud, clock, output = quiet_cloud
    samples = iter([[], [], [{"request": "old", "active": {"holds": 1}}], [], [], [], []])
    cloud.worker_snapshot = lambda: {"requests": next(samples)}
    cloud.quiesce("case")
    assert clock["time"] == 12
    assert (output / "quiescence/case.json").exists()


def test_busy_worker_prevents_reuse_after_bounded_wait(quiet_cloud):
    cloud, clock, _output = quiet_cloud
    cloud.manifest["drainTimeout"] = 5
    cloud.worker_snapshot = lambda: {"requests": [{"active": {"timers": 1}}]}
    with pytest.raises(CollectionError, match="subsequent cases must not run"):
        cloud.quiesce("busy")
    assert clock["time"] == 6


def test_logically_running_execution_blocks_reuse_even_when_worker_is_idle(quiet_cloud):
    cloud, _clock, _output = quiet_cloud
    cloud.manifest["drainTimeout"] = 5
    cloud.worker_snapshot = lambda: {"requests": []}
    cloud.running = lambda: [{"DurableExecutionArn": "pending"}]
    with pytest.raises(CollectionError):
        cloud.quiesce("queued")


def test_control_keys_are_scoped_to_current_run(monkeypatch):
    writes = []
    monkeypatch.setattr(
        driver,
        "client",
        lambda _service, **_kwargs: SimpleNamespace(
            put_object=lambda **kwargs: writes.append(kwargs)
        ),
    )
    cloud = driver.Cloud({"run": "new-run", "bucket": "persistent"})
    cloud.control("case-loser", "release")
    assert writes[0]["Key"] == "control/new-run/case-loser"


def test_activity_between_idle_samples_resets_quiet_window(quiet_cloud):
    cloud, clock, _output = quiet_cloud
    versions = iter([0, 0, 1, 1, 1, 1])
    cloud.worker_snapshot = lambda: {"requests": [], "activityVersion": next(versions)}
    cloud.quiesce("brief-late-work")
    assert clock["time"] == 10


@pytest.mark.parametrize("source", ["service", "invoke-response"])
def test_settlement_stops_accepted_execution_without_worker_events(quiet_cloud, source):
    cloud, _clock, _output = quiet_cloud
    cloud.manifest.update(bucket="bucket", commit="commit")
    execution = {"DurableExecutionArn": "accepted", "DurableExecutionName": "queued-case"}
    if source == "invoke-response":
        cloud.items = [{"arn": "accepted", "marker": "queued-case", "gates": {}}]
    stopped, histories, prefixes = [], [], []

    def pages(**kwargs):
        prefixes.append(kwargs["Prefix"])
        return [{}]  # No control keys or worker events were ever written.

    cloud.s3 = SimpleNamespace(get_paginator=lambda _name: SimpleNamespace(paginate=pages))
    cloud.lam = SimpleNamespace(
        get_durable_execution=lambda **_kwargs: {"Status": "STOPPED" if stopped else "RUNNING"},
        stop_durable_execution=lambda **kwargs: stopped.append(kwargs["DurableExecutionArn"]),
    )
    cloud.running = lambda: [execution] if source == "service" and not stopped else []
    cloud.worker_snapshot = lambda: {"requests": []}
    cloud.history = lambda item: histories.append(item["arn"])
    cloud.settle_run()
    assert stopped == ["accepted"]
    assert histories == ["accepted"]
    assert "events/run/" in prefixes


@pytest.fixture
def delayed_execution(quiet_cloud):
    cloud, clock, output = quiet_cloud
    cloud.manifest.update(bucket="bucket", commit="commit")
    stopped, listings = [], []

    def running():
        listings.append(clock["time"])
        if clock["time"] < 1 or stopped:
            return []
        return [{"DurableExecutionArn": "accepted", "DurableExecutionName": "invoked-case"}]

    cloud.running = running
    cloud.worker_snapshot = lambda: {"requests": []}
    cloud.s3 = SimpleNamespace(
        get_paginator=lambda _name: SimpleNamespace(paginate=lambda **_kwargs: [{}])
    )
    cloud.lam = SimpleNamespace(
        get_durable_execution=lambda **_kwargs: {"Status": "RUNNING"},
        stop_durable_execution=lambda **kwargs: stopped.append(kwargs["DurableExecutionArn"]),
    )
    cloud.history = lambda _item: []
    return cloud, stopped, listings, output


def test_settle_case_cli_preserves_marker_until_accepted_execution_is_visible(
    delayed_execution, monkeypatch
):
    import json
    import sys

    import deploy

    cloud, stopped, listings, output = delayed_execution
    assert cloud.items == []  # The CLI has no Invoke response or local case records.
    cloud.verify = lambda: None
    (output / "manifest.json").write_text(json.dumps(cloud.manifest))
    monkeypatch.setattr(deploy, "ARTIFACTS", output)
    monkeypatch.setattr(driver, "Cloud", lambda _manifest: cloud)
    monkeypatch.setattr(sys, "argv", ["deploy.py", "settle-case", "--markers", "invoked-case"])
    deploy.main()
    assert stopped == ["accepted"]
    assert listings[0] == 0 and any(0 < time < 1 for time in listings)
    assert not (output / "quarantine.json").exists()


def test_settle_run_rediscovers_unresolved_attempt_without_adopting_prepared_probe(
    delayed_execution,
):
    cloud, stopped, _listings, _output = delayed_execution
    cloud.items = [
        {"marker": "invoked-case", "gates": {}, "timing": {"invokeBegin": {"wall": 0}}},
        {"marker": "prepared-only", "gates": {}, "timing": {"prepareEnd": {"wall": 0}}},
    ]
    cloud.settle_run()
    assert stopped == ["accepted"]
    assert cloud.invoked_markers() == {"invoked-case"}


@pytest.mark.parametrize("entrypoint", ["settle", "settle-previous"])
def test_fresh_process_settlement_cleans_work_appearing_during_quiet_window(
    delayed_execution, monkeypatch, entrypoint
):
    import io
    import json
    import sys

    import deploy

    cloud, stopped, listings, output = delayed_execution
    assert cloud.items == []
    cloud.verify = lambda: None
    monkeypatch.setattr(driver, "Cloud", lambda _manifest: cloud)
    monkeypatch.setattr(deploy, "ARTIFACTS", output)
    if entrypoint == "settle":
        (output / "manifest.json").write_text(json.dumps(cloud.manifest))
        monkeypatch.setattr(sys, "argv", ["deploy.py", "settle"])
        deploy.main()
    else:
        services = {
            "lambda": SimpleNamespace(
                get_function_configuration=lambda **_kwargs: {
                    "Environment": {"Variables": {"LMI_RUN_ID": "run"}}
                }
            ),
            "s3": SimpleNamespace(
                get_object=lambda **_kwargs: {
                    "Body": io.BytesIO(json.dumps(cloud.manifest).encode())
                }
            ),
        }
        monkeypatch.setattr(deploy, "client", lambda service, **_kwargs: services[service])
        deploy.settle_previous(
            {"Outputs": [{"OutputKey": "shared", "OutputValue": "function"}]}, "bucket"
        )
    assert listings[0] == 0
    assert stopped == ["accepted"]
    assert all(item["settled"] for item in cloud.items)
    assert not (output / "quarantine.json").exists()


def test_run_settlement_restores_scoped_invocation_intent_and_quarantine(quiet_cloud):
    import json

    cloud, _clock, output = quiet_cloud
    cloud.manifest["commit"] = "commit"
    records = output / "invocations"
    records.mkdir()
    for item in [
        {
            "marker": "owned",
            "run": "run",
            "commit": "commit",
            "invoked": True,
            "gates": {"loser": "owned-gate"},
        },
        {
            "marker": "prepared",
            "run": "run",
            "commit": "commit",
            "timing": {"prepareEnd": {"wall": 0}},
        },
        {"marker": "foreign", "run": "another-run", "commit": "commit", "arn": "foreign-arn"},
        {"marker": "foreign-commit", "run": "run", "commit": "other", "arn": "foreign-arn"},
        {"marker": "settled", "run": "run", "commit": "commit", "arn": "done", "settled": True},
    ]:
        (records / f"{item['marker']}.json").write_text(json.dumps(item))
    (output / "quarantine.json").write_text(
        json.dumps({"run": "run", "markers": ["example-owned"], "state": "settling"})
    )
    cloud.restore_invocations()
    assert cloud.invoked_markers() == {"owned", "example-owned"}
    assert cloud.gates == {"owned-gate"}
    (output / "quarantine.json").write_text(
        json.dumps({"run": "another-run", "markers": ["foreign-example"]})
    )
    cloud.restore_invocations()
    assert "foreign-example" not in cloud.invoked_markers()


@pytest.mark.parametrize("response_delivered", [False, True])
def test_example_driver_exit_before_teardown_retains_delayed_execution(
    quiet_cloud, response_delivered
):
    import json
    import os
    import subprocess
    from pathlib import Path

    cloud, clock, output = quiet_cloud
    cloud.manifest.update(bucket="bucket", commit="commit", functions={"shared": "function"})
    (output / "manifest.json").write_text(json.dumps(cloud.manifest))
    root = Path(__file__).resolve().parents[2]
    helper = root / "packages/aws-durable-execution-sdk-js-examples/src/utils/shared-lmi.ts"
    script = f"""
import shared from {json.dumps(helper.as_uri())};
import {{ writeFileSync }} from "node:fs";
let factory;
const hooks = shared.sharedLmi({{
  middlewareStack: {{ add(value) {{ factory = value; }} }}
}}, "step-basic");
hooks.before();
const invoke = factory(async ({{ input }}) => {{
  writeFileSync(1, input.DurableExecutionName);
  if ({str(not response_delivered).lower()}) process.exit(23);
  return {{ output: {{ DurableExecutionArn: "accepted" }} }};
}}, {{ commandName: "InvokeCommand" }});
await invoke({{ input: {{ FunctionName: "function" }} }});
process.exit(23);
"""
    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", script],
        cwd=root,
        env={
            **os.environ,
            "LMI_SHARED_EXAMPLES": "1",
            "LMI_RUN_ID": "run",
            "LMI_CONTROL_SCRIPT": "unused.py",
            "LMI_REPO_ROOT": str(root),
            "LMI_QUARANTINE_FILE": str(output / "quarantine.json"),
        },
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 23, result.stderr
    marker = result.stdout
    assert marker.startswith("example-")
    assert not (output / "quarantine.json").exists(), "Teardown never ran"
    stopped = []
    cloud.running = lambda: (
        []
        if clock["time"] < 10 or stopped
        else [{"DurableExecutionArn": "accepted", "DurableExecutionName": marker}]
    )
    cloud.worker_snapshot = lambda: {"requests": []}
    cloud.s3 = SimpleNamespace(
        get_paginator=lambda _name: SimpleNamespace(paginate=lambda **_kwargs: [{}])
    )
    cloud.lam = SimpleNamespace(
        get_durable_execution=lambda **_kwargs: {"Status": "RUNNING"},
        stop_durable_execution=lambda **kwargs: stopped.append(kwargs["DurableExecutionArn"]),
    )
    cloud.history = lambda _item: []
    cloud.settle_run()
    assert stopped == ["accepted"], "Missing intent would falsely finish quiet at t=6"
    assert clock["time"] >= (6 if response_delivered else 16)
    record = json.loads((output / "invocations" / f"{marker}.json").read_text())
    assert record["run"] == "run" and record["commit"] == "commit"
    assert record["arn"] == "accepted" and record["settled"]


def test_cleanup_during_quiet_verification_does_not_restart_drain_budget(quiet_cloud):
    cloud, clock, _output = quiet_cloud
    cloud.manifest.update(bucket="bucket", commit="commit", drainTimeout=5)
    execution = {"DurableExecutionArn": "accepted", "DurableExecutionName": "late-case"}
    stopped = []
    cloud.running = lambda: [execution] if clock["time"] >= 1 else []
    cloud.worker_snapshot = lambda: {"requests": []}
    cloud.s3 = SimpleNamespace(
        get_paginator=lambda _name: SimpleNamespace(paginate=lambda **_kwargs: [{}])
    )
    cloud.lam = SimpleNamespace(
        get_durable_execution=lambda **_kwargs: {"Status": "RUNNING"},
        stop_durable_execution=lambda **kwargs: stopped.append(kwargs["DurableExecutionArn"]),
    )
    cloud.history = lambda _item: []
    with pytest.raises(CollectionError, match="did not become quiescent"):
        cloud.settle_run()
    assert stopped == ["accepted"]
    assert clock["time"] == 6


@pytest.mark.parametrize("persisted", [False, True])
def test_quiet_verification_recovers_worker_evidence_before_service_visibility(
    delayed_execution, persisted
):
    cloud, stopped, _listings, _output = delayed_execution
    if persisted:
        cloud.save_item({"marker": "invoked-case", "gates": {}, "invoked": True})
    snapshots = 0
    cloud.running = lambda: []

    def worker():
        nonlocal snapshots
        snapshots += 1
        return {
            "requests": []
            if snapshots < 3 or stopped
            else [
                {
                    "marker": "invoked-case",
                    "execution": "accepted",
                    "request": "request",
                    "active": {"holds": 1},
                }
            ]
        }

    cloud.worker_snapshot = worker
    cloud.settle_run()
    assert stopped == ["accepted"]


def test_settle_case_cli_restores_only_its_own_saved_execution(delayed_execution, monkeypatch):
    import json
    import sys

    import deploy

    cloud, stopped, _listings, output = delayed_execution
    cloud.running = lambda: []  # The saved ARN is the only available evidence.
    cloud.verify = lambda: None
    records = output / "invocations"
    records.mkdir()
    for item in [
        {"marker": "invoked-case", "arn": "accepted", "gates": {}},
        {"marker": "another-case", "arn": "unrelated", "gates": {"loser": "unrelated-gate"}},
    ]:
        (records / f"{item['marker']}.json").write_text(
            json.dumps({**item, "run": "run", "commit": "commit", "invoked": True})
        )
    (output / "manifest.json").write_text(json.dumps(cloud.manifest))
    monkeypatch.setattr(deploy, "ARTIFACTS", output)
    monkeypatch.setattr(driver, "Cloud", lambda _manifest: cloud)
    monkeypatch.setattr(sys, "argv", ["deploy.py", "settle-case", "--markers", "invoked-case"])
    deploy.main()
    assert stopped == ["accepted"]
    assert cloud.gates == set()
    assert cloud.invoked_markers() == {"invoked-case"}


def test_settle_case_failure_preserves_quarantined_invocation_ownership(
    delayed_execution, monkeypatch
):
    import json
    import sys

    import deploy

    cloud, _stopped, _listings, output = delayed_execution
    pending = {"run": "run", "markers": ["invoked-case"], "state": "settling"}
    (output / "quarantine.json").write_text(json.dumps(pending))
    (output / "manifest.json").write_text(json.dumps(cloud.manifest))

    def unavailable():
        raise OSError("configuration read failed")

    cloud.verify = unavailable
    monkeypatch.setattr(deploy, "ARTIFACTS", output)
    monkeypatch.setattr(driver, "Cloud", lambda _manifest: cloud)
    monkeypatch.setattr(sys, "argv", ["deploy.py", "settle-case", "--markers", "invoked-case"])
    with pytest.raises(OSError, match="configuration read failed"):
        deploy.main()
    assert json.loads((output / "quarantine.json").read_text()) == {
        **pending,
        "error": "configuration read failed",
    }


def test_settlement_releases_busy_executions_before_requesting_worker_probe(delayed_execution):
    cloud, stopped, _listings, _output = delayed_execution
    cloud.running = lambda: (
        []
        if stopped
        else [{"DurableExecutionArn": "accepted", "DurableExecutionName": "invoked-case"}]
    )

    def probe():
        assert stopped == ["accepted"], "A blocked pool cannot admit the diagnostic yet"
        return {"requests": []}

    cloud.worker_snapshot = probe
    cloud.settle_run()
    assert stopped == ["accepted"]


def test_fresh_settlement_releases_full_pool_before_delayed_service_visibility(delayed_execution):
    cloud, stopped, listings, _output = delayed_execution
    released = []
    cloud.control = lambda gate, value: released.append((gate, value))

    def pages(**kwargs):
        if kwargs["Prefix"] == "control/run/":
            return [{"Contents": [{"Key": "control/run/blocked-pool"}]}]
        return [{}]

    cloud.s3.get_paginator = lambda _name: SimpleNamespace(paginate=pages)

    def probe():
        assert released == [("blocked-pool", "release")], (
            "No worker slot can admit the probe until owned gates are released"
        )
        return {"requests": []}

    cloud.worker_snapshot = probe
    cloud.settle_run()
    assert listings[0] == 0
    assert stopped == ["accepted"]
    assert released == [("blocked-pool", "release")]


def test_quiet_window_excludes_the_first_probe_delivery_delay(quiet_cloud):
    import json

    cloud, clock, output = quiet_cloud
    calls = 0

    def probe():
        nonlocal calls
        calls += 1
        if calls == 1:
            clock["time"] += 10
        return {"requests": [], "activityVersion": 0}

    cloud.worker_snapshot = probe
    cloud.quiesce("first-delayed")
    assert calls == 4
    assert clock["time"] == 16
    samples = json.loads((output / "quiescence/first-delayed.json").read_text())["samples"]
    assert samples[0]["probeStart"]["monotonic"] == 0
    assert samples[0]["probeEnd"]["monotonic"] == 10
    assert samples[-1]["probeStart"]["monotonic"] - samples[0]["probeEnd"]["monotonic"] >= 5


def test_later_probe_delivery_delay_cannot_satisfy_quiet_window(quiet_cloud):
    cloud, clock, _output = quiet_cloud
    calls = 0

    def probe():
        nonlocal calls
        calls += 1
        if calls == 2:
            clock["time"] += 4
        return {"requests": [], "activityVersion": 0}

    cloud.worker_snapshot = probe
    cloud.quiesce("later-delayed")
    assert calls == 3
    assert clock["time"] == 8


@pytest.mark.parametrize("field", ["activityVersion", "worker", "environment"])
def test_activity_during_probe_delivery_restarts_quiet_from_fresh_probe_end(quiet_cloud, field):
    import json

    cloud, clock, output = quiet_cloud
    calls = 0
    live = {"requests": [], "activityVersion": 0, "worker": "worker", "environment": "env"}

    def probe():
        nonlocal calls
        calls += 1
        captured = dict(live)
        if calls == 2:
            clock["time"] += 1
            live[field] = 1 if field == "activityVersion" else "changed"
            clock["time"] += 3  # Deliver stale pre-activity evidence at t=6.
        elif calls == 3:
            clock["time"] += 4  # Changed evidence acquired at t=8 arrives at t=12.
        return captured

    cloud.worker_snapshot = probe
    cloud.quiesce("activity-during-delivery")
    assert calls == 6
    assert clock["time"] == 18
    samples = json.loads((output / "quiescence/activity-during-delivery.json").read_text())[
        "samples"
    ]
    assert samples[2]["probeStart"]["monotonic"] == 8
    assert samples[2]["probeEnd"]["monotonic"] == 12
    assert samples[-1]["probeStart"]["monotonic"] - samples[2]["probeEnd"]["monotonic"] >= 5


@pytest.mark.parametrize("delivered_at", [10, 16])
def test_probe_delivered_at_or_after_drain_deadline_cannot_claim_quiet(quiet_cloud, delivered_at):
    cloud, clock, _output = quiet_cloud
    cloud.manifest["drainTimeout"] = 10
    calls = 0

    def probe():
        nonlocal calls
        calls += 1
        if calls == 4:
            assert clock["time"] == 6  # Start minus initial end already exceeds quietSeconds.
            clock["time"] = delivered_at
        return {"requests": [], "activityVersion": 0}

    cloud.worker_snapshot = probe
    with pytest.raises(CollectionError, match="did not become quiescent"):
        cloud.quiesce("late-delivery")
    assert calls == 4
    assert clock["time"] == delivered_at


@pytest.mark.parametrize("entrypoint", ["settle", "settle-previous"])
def test_successful_run_recovery_archives_quarantine_and_allows_new_examples(
    delayed_execution, monkeypatch, entrypoint
):
    import io
    import json
    import subprocess
    import sys

    import deploy

    cloud, stopped, _listings, output = delayed_execution
    pending = {"run": "run", "markers": ["invoked-case"], "error": "previous cleanup failed"}
    quarantine = output / "quarantine.json"
    quarantine.write_text(json.dumps(pending))
    cloud.verify = lambda: None
    monkeypatch.setattr(driver, "Cloud", lambda _manifest: cloud)
    monkeypatch.setattr(deploy, "ARTIFACTS", output)

    # Exercise the real example-runner admission check without invoking AWS/Jest.
    root = output / "example-checkout"
    artifacts = root / "lmi-tests/artifacts"
    artifacts.parent.mkdir(parents=True)
    artifacts.symlink_to(output, target_is_directory=True)
    (root / "lmi-tests/build").mkdir()
    (root / "lmi-tests/build/examples.json").write_text("[]")
    (root / "packages/aws-durable-execution-sdk-js-examples").mkdir(parents=True)
    jest = root / "node_modules/.bin/jest"
    jest.parent.mkdir(parents=True)
    jest.write_text("#!/usr/bin/env node\nprocess.exit(0);\n")
    jest.chmod(0o755)
    (output / "manifest.json").write_text(json.dumps({**cloud.manifest, "run": "new-run"}))

    def run_examples():
        return subprocess.run(
            ["node", str(deploy.ROOT / "lmi-tests/run-examples.mjs")],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        )

    blocked = run_examples()
    assert blocked.returncode != 0 and "Shared fixture has not settled" in blocked.stderr
    if entrypoint == "settle":
        (output / "manifest.json").write_text(json.dumps(cloud.manifest))
        monkeypatch.setattr(sys, "argv", ["deploy.py", "settle"])
        deploy.main()
    else:
        services = {
            "lambda": SimpleNamespace(
                get_function_configuration=lambda **_kwargs: {
                    "Environment": {"Variables": {"LMI_RUN_ID": "run"}}
                }
            ),
            "s3": SimpleNamespace(
                get_object=lambda **_kwargs: {
                    "Body": io.BytesIO(json.dumps(cloud.manifest).encode())
                }
            ),
        }
        monkeypatch.setattr(deploy, "client", lambda service, **_kwargs: services[service])
        deploy.settle_previous(
            {"Outputs": [{"OutputKey": "shared", "OutputValue": "function"}]}, "bucket"
        )
    assert stopped == ["accepted"]
    assert all(item["settled"] for item in cloud.items)
    assert not quarantine.exists()
    archives = list((output / "quarantine").glob("*.json"))
    assert len(archives) == 1
    recovery = json.loads(archives[0].read_text())
    assert recovery["quarantine"] == pending
    assert recovery["recovery"]["run"] == "run"
    samples = json.loads((output / recovery["recovery"]["quiescence"]).read_text())["samples"]
    assert samples[-1]["probeStart"]["monotonic"] - samples[-4]["probeEnd"]["monotonic"] >= 5
    (output / "manifest.json").write_text(json.dumps({**cloud.manifest, "run": "new-run"}))
    admitted = run_examples()
    assert admitted.returncode == 0, admitted.stderr


@pytest.mark.parametrize("failure", ["release", "quiescence", "persist", "archive"])
def test_incomplete_run_recovery_retains_original_quarantine(
    delayed_execution, failure, monkeypatch
):
    import json

    cloud, _stopped, _listings, output = delayed_execution
    pending = {"run": "run", "markers": ["invoked-case"], "error": "previous cleanup failed"}
    quarantine = output / "quarantine.json"
    original = json.dumps(pending)
    quarantine.write_text(original)

    def unavailable(*_args, **_kwargs):
        raise OSError("recovery incomplete")

    if failure == "release":
        cloud.release_and_stop = unavailable
    elif failure == "quiescence":
        cloud.manifest["drainTimeout"] = 5
    elif failure == "persist":
        cloud.mark_settled = unavailable
    else:
        save = driver.save

        def save_with_failed_archive(path, data):
            if path.parent == output / "quarantine":
                unavailable()
            save(path, data)

        monkeypatch.setattr(driver, "save", save_with_failed_archive)
    with pytest.raises((OSError, CollectionError)):
        cloud.settle_run()
    assert quarantine.read_text() == original
    assert not list((output / "quarantine").glob("*.json"))


@pytest.mark.parametrize("owner", ["another-run", None])
def test_run_recovery_cannot_retire_unowned_quarantine(delayed_execution, owner):
    import json

    cloud, _stopped, _listings, output = delayed_execution
    pending = {"markers": ["unowned-case"], "error": "unowned cleanup failed"}
    if owner is not None:
        pending["run"] = owner
    quarantine = output / "quarantine.json"
    original = json.dumps(pending)
    quarantine.write_text(original)
    cloud.settle_run()
    assert quarantine.read_text() == original
    assert not list((output / "quarantine").glob("*.json"))


def test_new_quarantine_during_recovery_is_not_retired(delayed_execution):
    import json

    cloud, _stopped, _listings, output = delayed_execution
    quarantine = output / "quarantine.json"
    quarantine.write_text(json.dumps({"run": "run", "markers": ["invoked-case"]}))
    mark_settled = cloud.mark_settled
    changed = {"run": "run", "markers": ["new-case"], "error": "new cleanup failed"}

    def record_new_quarantine():
        mark_settled()
        quarantine.write_text(json.dumps(changed))

    cloud.mark_settled = record_new_quarantine
    cloud.settle_run()
    assert json.loads(quarantine.read_text()) == changed
    assert not list((output / "quarantine").glob("*.json"))


def test_case_only_recovery_does_not_retire_other_run_quarantine(delayed_execution, monkeypatch):
    import json
    import sys

    import deploy

    cloud, stopped, _listings, output = delayed_execution
    pending = {"run": "another-run", "markers": ["other-case"], "error": "cleanup failed"}
    quarantine = output / "quarantine.json"
    original = json.dumps(pending)
    quarantine.write_text(original)
    (output / "manifest.json").write_text(json.dumps(cloud.manifest))
    cloud.verify = lambda: None
    monkeypatch.setattr(driver, "Cloud", lambda _manifest: cloud)
    monkeypatch.setattr(deploy, "ARTIFACTS", output)
    monkeypatch.setattr(sys, "argv", ["deploy.py", "settle-case", "--markers", "invoked-case"])
    deploy.main()
    assert stopped == ["accepted"]
    assert quarantine.read_text() == original
    assert not list((output / "quarantine").glob("*.json"))


@pytest.mark.parametrize("entrypoint", ["settle", "settle-case"])
def test_failed_standalone_settlement_can_be_recovered_by_verified_whole_run(
    delayed_execution, monkeypatch, entrypoint
):
    import json
    import sys

    import deploy

    cloud, stopped, _listings, output = delayed_execution
    cloud.verify = lambda: None
    (output / "manifest.json").write_text(json.dumps(cloud.manifest))
    monkeypatch.setattr(deploy, "ARTIFACTS", output)
    monkeypatch.setattr(driver, "Cloud", lambda _manifest: cloud)
    monkeypatch.setattr(sys, "argv", ["deploy.py", entrypoint, "--markers", "invoked-case"])
    quiesce = cloud.quiesce

    def unavailable(*_args, **_kwargs):
        raise CollectionError("standalone settlement failed")

    cloud.quiesce = unavailable
    with pytest.raises(CollectionError, match="standalone settlement failed"):
        deploy.main()
    quarantine = output / "quarantine.json"
    pending = json.loads(quarantine.read_text())
    assert pending == {"run": "run", "error": "standalone settlement failed"}
    assert not list((output / "quarantine").glob("*.json"))

    cloud.quiesce = quiesce
    monkeypatch.setattr(sys, "argv", ["deploy.py", "settle"])
    deploy.main()
    assert stopped == ["accepted"]
    assert all(item["settled"] for item in cloud.items)
    assert not quarantine.exists()
    archives = list((output / "quarantine").glob("*.json"))
    assert len(archives) == 1
    recovery = json.loads(archives[0].read_text())
    assert recovery["quarantine"] == pending
    samples = json.loads((output / recovery["recovery"]["quiescence"]).read_text())["samples"]
    assert samples[-1]["probeStart"]["monotonic"] - samples[-4]["probeEnd"]["monotonic"] >= 5


@pytest.mark.parametrize("entrypoint", ["settle", "settle-case"])
@pytest.mark.parametrize("owner", ["run", "another-run", None])
def test_failed_standalone_settlement_preserves_existing_owner_and_markers(
    delayed_execution, monkeypatch, entrypoint, owner
):
    import json
    import sys

    import deploy

    cloud, _stopped, _listings, output = delayed_execution
    pending = {"markers": ["invoked-case"], "state": "settling"}
    if owner is not None:
        pending["run"] = owner
    quarantine = output / "quarantine.json"
    quarantine.write_text(json.dumps(pending))
    (output / "manifest.json").write_text(json.dumps(cloud.manifest))

    def unavailable():
        raise CollectionError("configuration unavailable")

    cloud.verify = unavailable
    monkeypatch.setattr(deploy, "ARTIFACTS", output)
    monkeypatch.setattr(driver, "Cloud", lambda _manifest: cloud)
    monkeypatch.setattr(sys, "argv", ["deploy.py", entrypoint])
    with pytest.raises(CollectionError, match="configuration unavailable"):
        deploy.main()
    expected = {**pending, "error": "configuration unavailable"}
    assert json.loads(quarantine.read_text()) == expected
    cloud.settle_run()
    if owner == "run":
        assert not quarantine.exists()
    else:
        assert json.loads(quarantine.read_text()) == expected
        assert not list((output / "quarantine").glob("*.json"))


@pytest.mark.parametrize("entrypoint", ["settle", "settle-case"])
@pytest.mark.parametrize("manifest", [None, "{", "{}", '{"run": ""}', '{"run": null}'])
def test_failed_standalone_settlement_without_loaded_owner_remains_unowned(
    tmp_path, monkeypatch, entrypoint, manifest
):
    import json
    import sys

    import deploy

    def unavailable(_manifest):
        raise CollectionError("configuration unavailable")

    if manifest is not None:
        (tmp_path / "manifest.json").write_text(manifest)
    monkeypatch.setattr(deploy, "ARTIFACTS", tmp_path)
    monkeypatch.setattr(driver, "Cloud", unavailable)
    monkeypatch.setattr(sys, "argv", ["deploy.py", entrypoint])
    with pytest.raises((OSError, ValueError, CollectionError)):
        deploy.main()
    assert "run" not in json.loads((tmp_path / "quarantine.json").read_text())


@pytest.mark.parametrize("unreadable", ["{", "[]"])
def test_settlement_failure_does_not_replace_unreadable_existing_ownership(
    delayed_execution, monkeypatch, unreadable
):
    import json
    import sys

    import deploy

    cloud, _stopped, _listings, output = delayed_execution
    (output / "manifest.json").write_text(json.dumps(cloud.manifest))
    quarantine = output / "quarantine.json"
    quarantine.write_text(unreadable)

    def unavailable():
        raise CollectionError("configuration unavailable")

    cloud.verify = unavailable
    monkeypatch.setattr(deploy, "ARTIFACTS", output)
    monkeypatch.setattr(driver, "Cloud", lambda _manifest: cloud)
    monkeypatch.setattr(sys, "argv", ["deploy.py", "settle"])
    with pytest.raises(CollectionError, match="configuration unavailable"):
        deploy.main()
    assert quarantine.read_text() == unreadable
