# MicroVM end-to-end test

`e2e/run-e2e.mjs` deploys a durable function and a MicroVM image to a real AWS account and runs fifteen scenarios by default:

- A job that succeeds with heartbeats. Its small input goes in the `run` hook.
- A job that fails.
- A MicroVM that crashes. The heartbeat timeout must end the wait.
- A MicroVM that the runner terminates 5 seconds after it is `RUNNING`, during a 600-second job. The worker's `terminate` hook must fail the job within a minute, long before its 300-second heartbeat timeout.
- Two jobs in a `map`.
- A job with a 10 KB input and no route. It must go over HTTP to the worker's `handler`.
- A job on a named route with a 10 KB input.
- Two jobs with 3,400 code points of CJK and of emoji input, about 10.6 KB and 13.9 KB. They must go in the `run` hook and reach the MicroVM unchanged.
- A job with 4,200 code points of CJK input. It must go over HTTP.
- A failing job over HTTP.
- A job over HTTP whose MicroVM the function terminates as soon as RunMicrovm returns. The job must fail with `MicrovmNotRunningError` after at most two requests. The runner counts the requests from the function's log.
- A session whose second job reads a file that its first job wrote, with a durable wait between them.
- A session whose last job reads a value that its first job kept in memory, with two durable waits between them. Its idle time is 10 seconds, so the worker suspends the MicroVM during the first wait. Its idle policy enables auto-resume, so the service resumes the MicroVM on the last job's request. The runner polls the MicroVM state and requires `SUSPENDED`.
- A session whose first job keeps a value in memory and sets `suspendAfter`. The second job is sent at once, inside the window of about 5 seconds in which the endpoint answers 502 and does not resume the MicroVM. The job must read the value back. Its first request must get no 2xx: a 502, or no answer when it arrives during the suspend hook. The function role has no `lambda:ResumeMicrovm`, so a ResumeMicrovm call would fail the job.

It checks the execution status, the operation history, and that every MicroVM ends `TERMINATED`. Three more scenarios run only when `E2E_SCENARIOS` names them. `long-job` and `idle-probe` take minutes and answer design questions. `dead-microvm-run-hook` terminates the MicroVM of a small job right after its launch, and only reports the outcome.

`PROBES=dead node e2e/probe-service.mjs` records what the endpoint and CreateMicrovmAuthToken answer for a running, a terminating, and a terminated MicroVM. It needs `MICROVM_IMAGE_ARN` set to an image with a worker on port 8080, such as the end-to-end image.

`e2e/probe-lifecycle.mjs` records when Lambda calls the `suspend` and `terminate` hooks, and which headers the hook calls and forwarded requests carry. It needs the roles and the bucket that `run-e2e.mjs` creates, so run that first.

```bash
npm run build -w packages/aws-durable-execution-sdk-js \
  && npm run build -w packages/aws-durable-execution-sdk-js-extras \
  && npm run build -w packages/aws-durable-execution-sdk-js-microvm-worker
cd packages/aws-durable-execution-sdk-js-extras
AWS_REGION=us-east-1 node e2e/run-e2e.mjs
```

The script creates or reuses resources named `dex-microvm-e2e-*`: an S3 bucket, three IAM roles, one MicroVM image per app build, and a function. It does not delete them. `E2E_SCENARIOS=succeed,fail` runs a subset.
