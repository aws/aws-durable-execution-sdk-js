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
