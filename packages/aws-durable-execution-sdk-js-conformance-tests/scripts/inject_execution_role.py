#!/usr/bin/env python3
"""Inject a pre-existing Lambda execution role into a conformance SAM template.

Rewrites the given template in place so that every AWS::Serverless::Function
uses the provided execution role ARN, and removes the self-created
DurableFunctionRole resource. Used by CI to avoid creating an IAM role per
deploy; the checked-in template stays self-contained for local runs.

Usage:
    python3 scripts/inject_execution_role.py --template template_step.yaml \
        --role-arn arn:aws:iam::123456789012:role/my-execution-role

Requires PyYAML (already a dependency of the conformance runner).
"""

from __future__ import annotations

import argparse
import sys

import yaml

SELF_CREATED_ROLE = "DurableFunctionRole"
FUNCTION_TYPE = "AWS::Serverless::Function"


def inject(template_path: str, role_arn: str) -> int:
    """Rewrite template_path in place; return the number of functions updated."""
    with open(template_path, encoding="utf-8") as f:
        doc = yaml.safe_load(f)

    resources = doc.get("Resources")
    if not isinstance(resources, dict):
        raise SystemExit(f"{template_path}: no Resources section found")

    resources.pop(SELF_CREATED_ROLE, None)

    updated = 0
    for resource in resources.values():
        if resource.get("Type") == FUNCTION_TYPE:
            resource.setdefault("Properties", {})["Role"] = role_arn
            updated += 1

    if updated == 0:
        raise SystemExit(f"{template_path}: no {FUNCTION_TYPE} resources found")

    with open(template_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(doc, f, sort_keys=False)

    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--template",
        required=True,
        help="Path to the SAM template to rewrite in place.",
    )
    parser.add_argument(
        "--role-arn",
        required=True,
        help="Execution role ARN to set on every serverless function.",
    )
    args = parser.parse_args()

    updated = inject(args.template, args.role_arn)
    print(f"Injected execution role into {updated} functions in {args.template}")


if __name__ == "__main__":
    sys.exit(main())
