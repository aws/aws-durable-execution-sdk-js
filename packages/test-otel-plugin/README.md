### test-otel-plugin

This is the POC Otel plugin integrated with traces on AWS CloudWatch.

### How to build the function.zip to use for testing with AWS Lambda and AWS Xray.

1. In the root package, install and build all the packages via `npm run install-all` and `npm run build`.
2. `cd packages/aws-durable-execution-sdk-js`, `npm pack`.
3. `cd ../packages/aws-durable-execution-sdk-js-testing`, `npm pack`.
4. `cd ../packages/aws-durable-execution-sdk-js-otel`, `npm pack`.
5. `cd ../packages/test-otel-plugin/hello-world/`, copy over all the zip files from the previous steps into the `hello-world` folder.
6. Install all the zip files and compile the typescript app.ts file. It should look like this. Finally, zip the required files into `function.zip`.

```
npm install aws-durable-execution-sdk-js-2.0.0-alpha.1.tgz  && \
npm install aws-durable-execution-sdk-js-testing-1.1.1.tgz  && \
npm install aws-durable-execution-sdk-js-otel-1.0.0.tgz && \
tsc && \
zip -r function.zip app.js package.json node_modules collector.yaml
```

### AWS Xray Setup

1. Create a new lambda function (I called mine `test-otel-plugin`) with the handler set to `app.lambdaHandler` in `ap-southeast-2`, you can use any region just need to change the region in the arns that follow.
2. Add a layer with the following arn: `arn:aws:lambda:ap-southeast-2:901920570463:layer:aws-otel-nodejs-amd64-ver-1-30-2:1`. This is the ARN from https://aws-otel.github.io/docs/getting-started/lambda/lambda-js. Note we aren't using `arn:aws:lambda:ap-southeast-2:615299751070:layer:AWSOpenTelemetryDistroJs:12` from https://aws-otel.github.io/docs/getting-started/lambda#aws-lambda-layer-for-opentelemetry-arns because that one uses the BatchSpanProcessor which doesn't work well with the plugin design. The plugin requires the use of the SimpleSpanProcessor which gives us agency over when to "flush" the trace. Using the BatchSpanProcessor may lead to lost traces, which are confusing.
3. Set the following environment variables.

| Variable                             | Value                      |
| ------------------------------------ | -------------------------- |
| `AWS_LAMBDA_EXEC_WRAPPER`            | `/opt/otel-handler`        |
| `OPENTELEMETRY_COLLECTOR_CONFIG_URI` | `/var/task/collector.yaml` |
| `OTEL_NODE_ENABLED_INSTRUMENTATIONS` | `all`                      |

4. Turn on `Lambda Service Traces` in the `Configuration`/`Monitoring and operations tools` tab.
5. Create a `hello-world` function in the same region.
6. Add lambda invoke permissions to the Execution Role. The lambda function defined makes an invoke to the `hello-world` function mentionned above.
7. Upload `function.zip`
