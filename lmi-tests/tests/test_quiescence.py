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
    monkeypatch.setattr(driver, "client", lambda _service: object())
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
        lambda _service: SimpleNamespace(put_object=lambda **kwargs: writes.append(kwargs)),
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
