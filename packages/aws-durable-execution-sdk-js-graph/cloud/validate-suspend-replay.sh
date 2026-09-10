#!/usr/bin/env bash
#
# V1/V2/V3 validation driver for the Durable Graph POC.
#
#   V1 happy path        : refund graph runs to completion after the interrupt is approved.
#   V2 zero-cost suspend : while suspended at the `approval` waitForCallback, NO Lambda
#                          invocation runs (proven via CloudWatch Invocations over the window
#                          and via the InvocationCompleted history event).
#   V3 replay across a genuine invocation end: the suspension ends the invocation; on resume a
#                          NEW invocation replays completed ops WITHOUT re-executing them
#                          (proven by stable operation Ids and single-occurrence Step events).
#
# Requires: AWS credentials in the environment (see deploy.sh header).
# Prints machine-greppable RESULT_* lines and writes raw JSON to /tmp/dg-v2v3-*.json.
#
set -euo pipefail
REGION=us-east-1
FN=durable-graph-poc
QUAL=1
AWS_ENV_FILE=${AWS_ENV_FILE:-/dev/null}
SUSPEND_WINDOW_SECS=${SUSPEND_WINDOW_SECS:-120}
aws_() { env $(cat "$AWS_ENV_FILE") aws "$@" --region "$REGION"; }

echo ">>> Start a fresh execution (async Event invoke)"
INV=$(aws_ lambda invoke --function-name "${FN}:${QUAL}" --invocation-type Event \
  --cli-binary-format raw-in-base64-out --payload '{"mode":"refund"}' /tmp/dg-v2-invoke.json)
ARN=$(echo "$INV" | python3 -c 'import json,sys;print(json.load(sys.stdin)["DurableExecutionArn"])')
echo "RESULT_EXECUTION_ARN=$ARN"

echo ">>> Poll until suspended at waitForCallback (InvocationCompleted present)"
CALLBACK_ID=""
for i in $(seq 1 30); do
  aws_ lambda get-durable-execution-history --durable-execution-arn "$ARN" > /tmp/dg-hist-suspend.json 2>/dev/null || true
  CALLBACK_ID=$(python3 -c '
import json
try:
    d=json.load(open("/tmp/dg-hist-suspend.json"))
except Exception:
    print(""); raise SystemExit
evs=d.get("Events",[])
has_ic=any(e["EventType"]=="InvocationCompleted" for e in evs)
cb=""
for e in evs:
    if e["EventType"]=="CallbackStarted":
        cb=e.get("CallbackStartedDetails",{}).get("CallbackId","")
print(cb if (has_ic and cb) else "")
')
  [ -n "$CALLBACK_ID" ] && break
  sleep 2
done
if [ -z "$CALLBACK_ID" ]; then echo "RESULT_V2=BLOCKED reason=never_suspended"; exit 1; fi
SUSPEND_START=$(date -u +%s)
echo "RESULT_SUSPENDED_AT_EPOCH=$SUSPEND_START"
echo "RESULT_CALLBACK_ID_LEN=${#CALLBACK_ID}"

echo ">>> Confirm execution status is RUNNING (suspended/pending), invocation ended"
aws_ lambda get-durable-execution --durable-execution-arn "$ARN" > /tmp/dg-v2-getexec.json
STATUS=$(python3 -c 'import json;print(json.load(open("/tmp/dg-v2-getexec.json"))["Status"])')
echo "RESULT_STATUS_WHILE_SUSPENDED=$STATUS"

echo ">>> Hold for suspension window (${SUSPEND_WINDOW_SECS}s) with NO activity, then measure invocations"
sleep "$SUSPEND_WINDOW_SECS"
SUSPEND_END=$(date -u +%s)
# CloudWatch metric window: from just before suspend to now, 60s period, Sum of Invocations.
MSTART=$(date -u -d "@$((SUSPEND_START-30))" +%Y-%m-%dT%H:%M:%SZ)
MEND=$(date -u -d "@$((SUSPEND_END+30))" +%Y-%m-%dT%H:%M:%SZ)
echo "RESULT_METRIC_WINDOW=$MSTART..$MEND"
aws_ cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Invocations \
  --dimensions Name=FunctionName,Value="$FN" \
  --start-time "$MSTART" --end-time "$MEND" --period 60 --statistics Sum \
  > /tmp/dg-v2-invocations.json
echo "RESULT_INVOCATIONS_DURING_WINDOW_JSON=/tmp/dg-v2-invocations.json"
python3 -c '
import json
d=json.load(open("/tmp/dg-v2-invocations.json"))
pts=sorted(d.get("Datapoints",[]),key=lambda p:p["Timestamp"])
tot=sum(p["Sum"] for p in pts)
print("RESULT_INVOCATIONS_DATAPOINTS=%d" % len(pts))
for p in pts: print("   ",p["Timestamp"],"Sum=",p["Sum"])
print("RESULT_INVOCATIONS_SUM_OVER_WINDOW=%g" % tot)
'

echo ">>> History must be UNCHANGED across the idle window (no new events while suspended)"
aws_ lambda get-durable-execution-history --durable-execution-arn "$ARN" > /tmp/dg-hist-afterwait.json
python3 -c '
import json
a=json.load(open("/tmp/dg-hist-suspend.json"))["Events"]
b=json.load(open("/tmp/dg-hist-afterwait.json"))["Events"]
print("RESULT_EVENTS_AT_SUSPEND=%d" % len(a))
print("RESULT_EVENTS_AFTER_IDLE=%d" % len(b))
print("RESULT_HISTORY_GREW_WHILE_SUSPENDED=%s" % ("YES" if len(b)>len(a) else "NO"))
'

echo ">>> Resume: send callback success (approve). This starts a NEW invocation that replays."
# The callback uses the SDK default PASS-THROUGH serdes (deserialize(data)=>data), so the
# resume value the node receives is the raw Result bytes verbatim. The demo compares
# `decision === "approve"`, so the blob must be the raw string `approve`. The --result param is
# a BLOB: with default binary format the CLI expects base64, so we pass base64("approve").
DECISION_RAW=${DECISION_RAW:-approve}
DECISION_B64=$(printf '%s' "$DECISION_RAW" | base64)
aws_ lambda send-durable-execution-callback-success --callback-id "$CALLBACK_ID" \
  --result "$DECISION_B64" > /tmp/dg-v2-resume.json 2>&1
echo "    resume decision raw='$DECISION_RAW' b64='$DECISION_B64'"
echo "    resume response:"; cat /tmp/dg-v2-resume.json; echo

echo ">>> Poll until terminal"
FINAL_STATUS=""
for i in $(seq 1 30); do
  aws_ lambda get-durable-execution --durable-execution-arn "$ARN" --include-execution-data > /tmp/dg-v2-final.json
  FINAL_STATUS=$(python3 -c 'import json;print(json.load(open("/tmp/dg-v2-final.json"))["Status"])')
  [ "$FINAL_STATUS" != "RUNNING" ] && break
  sleep 3
done
echo "RESULT_FINAL_STATUS=$FINAL_STATUS"

echo ">>> Capture final history for replay analysis (V3)"
aws_ lambda get-durable-execution-history --durable-execution-arn "$ARN" > /tmp/dg-hist-final.json
python3 -c '
import json
d=json.load(open("/tmp/dg-hist-final.json"))
evs=d["Events"]
# Count StepStarted per operation Id: replay must NOT re-run completed steps.
from collections import Counter
step_started=Counter()
for e in evs:
    if e["EventType"]=="StepStarted":
        step_started[(e.get("Id"),e.get("Name"))]+=1
dupes={k:v for k,v in step_started.items() if v>1}
print("RESULT_TOTAL_FINAL_EVENTS=%d" % len(evs))
print("RESULT_DISTINCT_STEP_STARTS=%d" % len(step_started))
print("RESULT_STEPS_STARTED_MORE_THAN_ONCE=%s" % (dupes if dupes else "NONE"))
# invoke-model must appear exactly twice as distinct ids (t0 and t2), each started once.
im=[k for k in step_started if k[1]=="invoke-model"]
print("RESULT_invoke_model_distinct_ids=%d" % len(im), im)
'
echo ">>> DONE"
