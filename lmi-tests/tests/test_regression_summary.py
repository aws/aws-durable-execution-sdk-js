# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
from summarize_regressions import summarize


def test_node_fixture_exception_is_not_reported_as_an_assertion(tmp_path):
    report = tmp_path / "results.xml"
    report.write_text("""<testsuites><testsuite>
      <testcase name="passed" />
      <testcase name="late write"><failure>cause: AssertionError [ERR_ASSERTION]</failure></testcase>
      <testcase name="bad fixture"><failure>cause: Error: metadata required on first call for 1</failure></testcase>
      <testcase name="load error"><error>SyntaxError</error></testcase>
      <testcase name="skipped"><skipped /></testcase>
    </testsuite></testsuites>""")
    result = summarize(report)
    assert "1 passed; 1 assertion failures; 2 test execution errors; 1 skipped" in result
    assert "| errors | bad fixture |" in result
