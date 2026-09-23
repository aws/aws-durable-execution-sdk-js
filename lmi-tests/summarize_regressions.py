# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Expose Node assertion failures separately from test execution errors in CI."""

import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def summarize(path):
    cases = list(ET.parse(path).getroot().iter("testcase"))
    if not cases:
        raise ValueError("No test cases in regression report")
    counts = dict(passed=0, assertions=0, errors=0, skipped=0)
    rows = []
    for case in cases:
        failure = case.find("failure")
        error = case.find("error")
        if case.find("skipped") is not None:
            category = "skipped"
        elif error is not None:
            category = "errors"
        elif failure is not None:
            # node:test wraps both assertions and fixture exceptions in failure
            # elements. ERR_ASSERTION identifies the nested assertion cause.
            category = "assertions" if "[ERR_ASSERTION]" in (failure.text or "") else "errors"
        else:
            category = "passed"
        counts[category] += 1
        name = case.get("name", "unnamed").replace("|", "\\|").replace("\n", " ")
        rows.append(f"| {category} | {name} |")
    return (
        "### Local lifecycle regressions\n\n"
        f"{counts['passed']} passed; {counts['assertions']} assertion failures; "
        f"{counts['errors']} test execution errors; {counts['skipped']} skipped.\n\n"
        "Assertions target the desired behavior in #927; they remain failures until the SDK is fixed. "
        "Test execution errors are harness failures and are not evidence of an SDK defect.\n\n"
        "| Outcome | Test |\n| --- | --- |\n" + "\n".join(rows) + "\n"
    )


if __name__ == "__main__":
    print(summarize(Path(sys.argv[1])))
