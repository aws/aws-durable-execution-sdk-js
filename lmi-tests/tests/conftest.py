# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cloud import Cloud
from deploy import ARTIFACTS


def pytest_addoption(parser):
    parser.addoption("--cloud", action="store_true", help="Invoke the deployed LMI fixtures")


@pytest.fixture
def cloud(request):
    if not request.config.getoption("--cloud"):
        pytest.fail("Cloud cases require --cloud and a verified deployment")
    instance = Cloud(json.loads((ARTIFACTS / "manifest.json").read_text()))
    instance.verify()
    try:
        yield instance
    finally:
        instance.close_case()
