/**
 * ASL definition for the "AthenaDataQuery" Step Functions starter pack:
 * generates a small sample CSV, crawls it with an AWS Glue crawler, then
 * runs an Athena query against the resulting Glue table and publishes the
 * results to SNS.
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/AthenaDataQuery.yaml.ts`, mainline, fetched
 * 2026-07-23. Vendored verbatim as a one-time snapshot (the `DefinitionString`
 * ASL embedded in that template, with its `${dataGenerationLambda}` /
 * `${crawlerName}` / `${database}` / `${workgroup}` / `${snsTopicArn}`
 * `Fn::Sub` placeholders left as literal `${...}` tokens, matching the other
 * starter packs' `.asl.json.ts` convention of vendoring the plain ASL
 * document rather than its CFN-embedded form).
 */
const content = `{
  "StartAt": "Generate example log",
  "QueryLanguage": "JSONata",
  "States": {
    "Generate example log": {
      "Type": "Task",
      "Resource": "arn:\${AWS::Partition}:states:::lambda:invoke",
      "Arguments": { "Payload": "{% $states.input %}", "FunctionName": "\${dataGenerationLambda}" },
      "Output": {},
      "Next": "Run Glue crawler"
    },
    "Run Glue crawler": {
      "Type": "Task",
      "Arguments": { "Name": "\${crawlerName}" },
      "Resource": "arn:\${AWS::Partition}:states:::aws-sdk:glue:startCrawler",
      "Next": "Get Crawler Status"
    },
    "Get Crawler Status": {
      "Type": "Task",
      "Arguments": { "Name": "\${crawlerName}" },
      "Resource": "arn:\${AWS::Partition}:states:::aws-sdk:glue:getCrawler",
      "Next": "Check Crawler Status"
    },
    "Check Crawler Status": {
      "Type": "Choice",
      "Choices": [{ "Next": "Start an Athena query", "Condition": "{% $states.input.Crawler.State = 'READY' %}" }],
      "Default": "Wait For Crawler To Complete"
    },
    "Wait For Crawler To Complete": { "Type": "Wait", "Seconds": 30, "Next": "Get Crawler Status" },
    "Start an Athena query": {
      "Resource": "arn:\${AWS::Partition}:states:::athena:startQueryExecution.sync",
      "Arguments": { "QueryString": "SELECT * FROM \\"\${database}\\".\\"log\\" limit 1", "WorkGroup": "\${workgroup}" },
      "Type": "Task",
      "Next": "Get query results"
    },
    "Get query results": {
      "Resource": "arn:\${AWS::Partition}:states:::athena:getQueryResults",
      "Arguments": { "QueryExecutionId": "{% $states.input.QueryExecution.QueryExecutionId %}" },
      "Type": "Task",
      "Next": "Send query results"
    },
    "Send query results": {
      "Resource": "arn:\${AWS::Partition}:states:::sns:publish",
      "Arguments": { "TopicArn": "\${snsTopicArn}", "Message": { "Input": "{% $states.input.ResultSet.Rows %}" } },
      "Type": "Task",
      "End": true
    }
  }
}`;

export default content;
