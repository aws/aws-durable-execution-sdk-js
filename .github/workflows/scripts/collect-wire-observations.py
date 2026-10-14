"""Temporary read-only case11 wire/header correlation. Never upload request bodies."""
import argparse, base64, datetime, gzip, hashlib, json, os, pathlib, subprocess, tempfile

def api(*args):
    p = subprocess.run(['aws', *args, '--region', REGION, '--output', 'json'], capture_output=True, text=True, timeout=90, env={**os.environ, 'AWS_MAX_ATTEMPTS':'8'})
    if p.returncode: raise RuntimeError('Read-only AWS request failed: ' + ' '.join(args[:2]))
    return json.loads(p.stdout)

def parse_header(value):
    if not isinstance(value, str): return {}
    parts = dict(p.strip().split('=', 1) for p in value.split(';') if '=' in p)
    return {k:parts.get(k) for k in ['Root','Parent','Sampled']}

def instant(value):
    return datetime.datetime.fromisoformat(value.replace('Z','+00:00'))

def wire_rows(group, start, end, execution_name, operation_id):
    response = api('logs','filter-log-events','--log-group-name',group,'--start-time',str(int(start.timestamp()*1000)-30000),'--end-time',str(int(end.timestamp()*1000)+60000),'--filter-pattern','"CHAIN_WIRE_OBSERVATION"')
    rows=[]
    for event in response.get('events',[]):
        message=event['message']
        try:
            outer=json.loads(message)
            if isinstance(outer,dict) and isinstance(outer.get('message'),str): message=outer['message']
        except json.JSONDecodeError: pass
        marker='CHAIN_WIRE_OBSERVATION '
        if marker not in message: continue
        row,_=json.JSONDecoder().raw_decode(message.split(marker,1)[1].lstrip())
        if row.get('operationId')==operation_id and execution_name in row.get('executionArn',''):
            rows.append({k:row.get(k) for k in ['executionArn','operationId','operationName','updateIndex','wireOperationId','dtoHeader','wireHeader']})
    return rows

def xray_spans(root):
    if not root: return []
    response=api('xray','batch-get-traces','--trace-ids',root); rows=[]
    def visit(node, parent=None):
        if node.get('name')=='otel-invoke':
            rows.append({'name':node['name'],'spanId':node.get('id'),'parentSpanId':node.get('parent_id',parent),'traceId':root.replace('1-','',1).replace('-',''),'source':'actual X-Ray segment/subsegment'})
        for child in node.get('subsegments',[]): visit(child,node.get('id'))
    for trace in response.get('Traces',[]):
        for segment in trace.get('Segments',[]): visit(json.loads(segment['Document']))
    return rows

def hex_id(value, length):
    if len(value)==length and all(c in '0123456789abcdef' for c in value.lower()): return value.lower()
    return base64.b64decode(value).hex()

def s3_spans(start,end,caller,operation_id):
    bucket=f"dex-otel-javascript-exec-{os.environ['TEST_ACCOUNT_ID']}-{REGION}"; rows=[]
    for item in api('s3api','list-objects-v2','--bucket',bucket,'--prefix','traces/').get('Contents',[]):
        modified=instant(item['LastModified'])
        if modified<start-datetime.timedelta(seconds=30) or modified>end+datetime.timedelta(minutes=3): continue
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'trace'
            p=subprocess.run(['aws','s3api','get-object','--bucket',bucket,'--key',item['Key'],str(path),'--region',REGION],capture_output=True,text=True,timeout=60)
            if p.returncode: raise RuntimeError('Read-only trace object download failed')
            raw=path.read_bytes()
            if raw[:2]==b'\x1f\x8b': raw=gzip.decompress(raw)
            try: documents=[json.loads(raw)]
            except json.JSONDecodeError: documents=[json.loads(line) for line in raw.decode().splitlines() if line.strip()]
            for document in documents:
                for resource in document.get('resourceSpans',[]):
                    for scope in resource.get('scopeSpans',[]):
                        for span in scope.get('spans',[]):
                            attributes={a['key']:a.get('value',{}).get('stringValue') for a in span.get('attributes',[])}
                            if span.get('name')!='otel-invoke' or attributes.get('durable.execution.arn')!=caller or attributes.get('durable.operation.id')!=operation_id: continue
                            rows.append({'name':span['name'],'spanId':hex_id(span['spanId'],16),'parentSpanId':hex_id(span['parentSpanId'],16),'traceId':hex_id(span['traceId'],32),'flags':span.get('flags'),'source':'actual raw OTLP S3 record','objectKey':item['Key']})
    return rows

parser=argparse.ArgumentParser(); parser.add_argument('--artifacts',required=True); parser.add_argument('--output',required=True); parser.add_argument('--region',default='us-west-2'); args=parser.parse_args(); REGION=args.region
result={'sourceHead':os.environ['GITHUB_SHA'],'runId':os.environ['GITHUB_RUN_ID'],'cases':[]}
for file in sorted(pathlib.Path(args.artifacts).rglob('otel-execution-11.json')):
    events=json.loads(file.read_text())['Events']; first=next(e for e in events if e['EventType']=='ExecutionStarted'); starts=[e for e in events if e['EventType']=='ChainedInvokeStarted']
    if len(starts)!=1: raise RuntimeError('Expected existing case11 single invoke START')
    start_event=starts[0]; child=start_event['ChainedInvokeStartedDetails']['DurableExecutionArn']; backend='s3' if 's3' in str(file) else 'xray'; start=min(instant(e['EventTimestamp']) for e in events); end=max(instant(e['EventTimestamp']) for e in events)
    row={'backend':backend,'historySha256':hashlib.sha256(file.read_bytes()).hexdigest(),'operationId':start_event['Id'],'classification':'INSUFFICIENT_EVIDENCE'}
    try:
        observed=wire_rows(f'/aws/lambda/conformance-tests-javascript-{backend}-exec-otel-execution-11',start,end,first['Name'],start_event['Id']); row['wireObservations']=observed
        service=api('lambda','get-durable-execution','--durable-execution-arn',child,'--query','{DurableExecutionArn:DurableExecutionArn,Status:Status,TraceHeader:TraceHeader}'); row['childExecution']=service; received=parse_header((service.get('TraceHeader')or{}).get('XAmznTraceId')); row['receivedHeader']=received
        callers={o['executionArn'] for o in observed}; spans=[]
        if len(callers)==1: spans=xray_spans(received.get('Root')) if backend=='xray' else s3_spans(start,end,next(iter(callers)),start_event['Id'])
        row['actualInvokeSpans']=spans; row['rawMatchedSpanCount']=len(spans); identities={(s['traceId'],s['spanId'])for s in spans}
        if observed and len(identities)==1:
            trace_id,span_id=next(iter(identities)); expected_root=f'1-{trace_id[:8]}-{trace_id[8:]}'; headers=[parse_header(o['wireHeader'])for o in observed]; row['dtoEqualsWire']=all(o['dtoHeader']==o['wireHeader']for o in observed); row['wireMatchesActualInvoke']=all(h.get('Root')==expected_root and h.get('Parent')==span_id for h in headers); row['serviceMatchesWire']=all(h==received for h in headers)
            row['classification']=('SDK_DTO_METADATA_ABSENT' if all(o['dtoHeader']is None for o in observed) else 'DTO_WIRE_MISMATCH' if not row['dtoEqualsWire'] else 'SDK_HEADER_ID_MISMATCH' if not row['wireMatchesActualInvoke'] else 'SERVICE_HEADER_DIFFERS_FROM_CORRECT_WIRE' if not row['serviceMatchesWire'] else 'WIRE_AND_SERVICE_MATCH')
    except Exception as error:
        row['readFailureType']=type(error).__name__
    result['cases'].append(row)
pathlib.Path(args.output).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'cases':[{'backend':r['backend'],'classification':r['classification']}for r in result['cases']]}))
if len(result['cases'])!=2 or any(r['classification']=='INSUFFICIENT_EVIDENCE'for r in result['cases']): raise SystemExit('Diagnostic incomplete; saved partial facts do not establish a cause')
