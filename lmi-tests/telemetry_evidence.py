# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Independent assertions over recorded native headers and exported OTel spans."""

import re
from typing import Any

from evidence import CollectionError, select


def parse_header(header: object) -> dict[str, str | bool] | None:
    if not isinstance(header, str):
        return None
    fields = dict(piece.strip().split("=", 1) for piece in header.split(";") if "=" in piece)
    root, parent, sampled = (fields.get(key) for key in ("Root", "Parent", "Sampled"))
    if (
        not root
        or not re.fullmatch(r"1-[0-9a-f]{8}-[0-9a-f]{24}", root)
        or not parent
        or not re.fullmatch(r"[0-9a-f]{16}", parent)
        or sampled not in {"0", "1"}
    ):
        return None
    return {
        "trace_id": root[2:].replace("-", ""),
        "parent_id": parent,
        "sampled": sampled == "1",
    }


def explicit_sampling(header: object) -> bool | None:
    if not isinstance(header, str):
        return None
    values = [part.strip()[8:] for part in header.split(";") if part.strip().startswith("Sampled=")]
    return None if not values or values[-1] not in {"0", "1"} else values[-1] == "1"


def invocation(
    events: list[dict[str, Any]],
    *,
    native: bool = True,
    expected_outcome: str = "success",
) -> None:
    starts = select(events, "OTEL_ENTER")
    if not starts:
        raise CollectionError("Missing OTel invocation entry and carrier evidence")
    for start in starts:
        local = [event for event in events if event["request"] == start["request"]]
        if native and not start.get("carrier_available"):
            raise CollectionError("LMI runtime context carrier was unavailable")
        ends = select(local, "OTEL_EXIT")
        if len(ends) != 1:
            raise CollectionError("Missing or duplicate OTel invocation exit evidence")
        assert ends[0]["context_restored"], "OTel context leaked after invocation End"
        assert ends[0]["exporter_shutdowns"] == 0, "Invocation shut down a shared exporter"
        factories = select(local, "OTEL_FACTORY")
        assert len(factories) == 1, "Expected one plugin instance per invocation"
        exports = select(local, "OTEL_EXPORT")
        header = parse_header(start.get("carrier"))
        if native and header is None:
            raise CollectionError("Real LMI did not provide the required valid X-Ray carrier")
        if explicit_sampling(start.get("carrier")) is False:
            assert not exports, "An explicit Sampled=0 invocation exported spans"
            continue
        roots = [event["span"] for event in exports if event["span"]["name"] == "Invocation"]
        if len(roots) != 1:
            raise CollectionError("Expected one exported Invocation span for a sampled request")
        for event in exports:
            span = event["span"]
            assert event["outcome"] == expected_outcome, "Unexpected export result"
            assert span["attributes"].get("durable.execution.arn") == start["execution"], (
                "Exported span belongs to another execution"
            )
            assert span["start_ns"] <= span["end_ns"], "Span duration is negative"
            assert span["sampled"], "Recording export has an unsampled span context"
            if header is not None:
                assert span["trace_id"] == header["trace_id"], "Runtime X-Ray Root was lost"
        if header is not None:
            assert roots[0]["parent_id"] == header["parent_id"], "Runtime X-Ray Parent was lost"
    instances = [event["plugin_instance"] for event in select(events, "OTEL_FACTORY")]
    assert len(instances) == len(set(instances)), "Plugin instance reused across invocations"


def terminal(events: list[dict[str, Any]], *, failed: bool = False) -> None:
    """Workflow is emitted once at the terminal invocation, not once per replay."""
    sampled = [
        entry
        for entry in select(events, "OTEL_ENTER")
        if explicit_sampling(entry.get("carrier")) is not False
    ]
    if not sampled:
        return
    spans = [event["span"] for event in select(events, "OTEL_EXPORT")]
    workflows = [span for span in spans if span["name"] == "Workflow"]
    if not workflows:
        raise CollectionError("Terminal Workflow export is missing")
    assert len(workflows) == 1, "Workflow was missing or duplicated across replay"
    assert workflows[0]["status"] == ("ERROR" if failed else "OK")
