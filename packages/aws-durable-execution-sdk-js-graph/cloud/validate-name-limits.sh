#!/usr/bin/env bash
#
# V4 probe: Operation.Name / Operation.Id length limits in the REAL backend.
#
# The driver encodes the structural path into the operation Name. For a node named N chars long,
# the deepest name is `t0/<N-char-name>/mark` (len = N + 8). We invoke the `longnames` mode with
# escalating node-name lengths, run each to completion (no interrupt), and read back the actual
# Operation.Name values recorded by the backend. If the backend caps/truncates/rejects long
# names, we observe it here; otherwise we report the largest proven value.
#
# Also records the Operation.Id length (the SDK mints 16-hex ids regardless of name) and checks
# id uniqueness within an execution.
#
set -euo pipefail
REGION=us-east-1
FN=durable-graph-poc
QUAL=1
AWS_ENV_FILE=${AWS_ENV_FILE:-/dev/null}
aws_() { env $(cat "$AWS_ENV_FILE") aws "$@" --region "$REGION"; }

LENS=${LENS:-"8 64 256 1024 4096 16384"}
declare -A ARNMAP

echo ">>> Launch a longnames execution per node-name length: $LENS"
for L in $LENS; do
  INV=$(aws_ lambda invoke --function-name "${FN}:${QUAL}" --invocation-type Event \
    --cli-binary-format raw-in-base64-out --payload "{\"mode\":\"longnames\",\"nameLen\":$L}" \
    /tmp/dg-ln-$L.json 2>&1) || { echo "  len=$L INVOKE_ERROR: $INV"; continue; }
  ARN=$(echo "$INV" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("DurableExecutionArn",""))' 2>/dev/null || true)
  if [ -z "$ARN" ]; then echo "  len=$L NO_ARN resp=$INV"; continue; fi
  ARNMAP[$L]="$ARN"
  echo "  len=$L started ${ARN##*/}"
done

echo ">>> Wait for completion & inspect recorded Operation.Name lengths"
sleep 8
for L in $LENS; do
  ARN="${ARNMAP[$L]:-}"
  [ -z "$ARN" ] && { echo "RESULT_LEN_${L}=NOT_STARTED"; continue; }
  # poll terminal
  ST=""
  for i in $(seq 1 20); do
    aws_ lambda get-durable-execution --durable-execution-arn "$ARN" --include-execution-data > /tmp/dg-ln-exec-$L.json 2>/dev/null || true
    ST=$(python3 -c 'import json;print(json.load(open("/tmp/dg-ln-exec-'$L'.json")).get("Status",""))' 2>/dev/null || echo "")
    [ -n "$ST" ] && [ "$ST" != "RUNNING" ] && break
    sleep 2
  done
  aws_ lambda get-durable-execution-history --durable-execution-arn "$ARN" > /tmp/dg-ln-hist-$L.json 2>/dev/null || true
  python3 - "$L" "$ST" <<'PY'
import json,sys
L=int(sys.argv[1]); ST=sys.argv[2]
try:
    ev=json.load(open("/tmp/dg-ln-hist-%d.json"%L))["Events"]
except Exception as e:
    print("RESULT_LEN_%d=NO_HISTORY status=%s err=%s"%(L,ST,e)); raise SystemExit
names=[(e.get("Name") or "") for e in ev if e.get("Name")]
ids=[(e.get("Id") or "") for e in ev if e.get("Id")]
maxname=max(names,key=len) if names else ""
# the node name is `n`+`x`*(L-1); deepest recorded name is t0/<node>/mark
node_names=[n for n in names if n.startswith("t0/n")]
observed_node_len = max((len(n) for n in node_names), default=0)
id_lens=sorted(set(len(i) for i in ids))
dup_ids = len(ids)!=len(set(ids))
# check truncation: expected deepest name length = L + len("t0/") + len("/mark") = L+3+5 = L+8
expected_deepest = L + 8
print("RESULT_LEN_%d status=%s max_recorded_name_len=%d expected_deepest=%d node_path_names=%d id_len_set=%s dup_ids=%s"
      % (L, ST, len(maxname), expected_deepest, len(node_names), id_lens, dup_ids))
# show a sample of the longest name (first/last 40 chars)
if maxname:
    disp = maxname if len(maxname)<=90 else (maxname[:45]+"..."+maxname[-42:])
    print("        longest_name[%d]=%s" % (len(maxname), disp))
PY
done
echo ">>> DONE"
