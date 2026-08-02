/**
 * CloudFormation template for the "HelloLambda" Step Functions starter pack
 * (id "hl"), STRIPPED of its original Step-Functions-specific orchestration
 * so it provisions only the supporting infra; the workflow itself is
 * imported to `.dar` and deployed as a durable Lambda separately (see
 * `deployStarterPack.ts` / `docs/dar-vs-asl.md`'s two-deploy model).
 *
 * Source: internal package `@amzn/sfn-console-starter-pack`
 * (code.amazon.com/packages/SFNConsoleStarterPack), file
 * `src/assets/templates/HelloLambda.yaml.ts`, mainline, fetched 2026-07-23.
 * Vendored as a one-time snapshot (not live-synced to upstream).
 *
 * Changes from the original template:
 *  1. Removed `StockTradingStateMachine` (`AWS::StepFunctions::StateMachine`)
 *     - we deploy the workflow as a durable Lambda instead, not a Standard
 *       state machine; keeping this resource would provision a redundant,
 *       unused state machine alongside it.
 *  2. Removed `StockTradingStateMachineRole` - existed only as that state
 *     machine's execution role; dead weight once the state machine is gone.
 *  3. `ManualApprovalFunctionRole`'s `StatesExecutionPolicy` statement
 *     (`states:SendTaskSuccess`/`SendTaskFailure` scoped to
 *     `!Ref StockTradingStateMachine`) is REMOVED entirely, not just
 *     re-scoped - `ApproveSqsLambda`'s code (below) no longer calls any Step
 *     Functions API at all, it now calls Lambda's own
 *     `SendDurableExecutionCallbackSuccess` API instead (our SDK's
 *     `context.waitForCallback` completion mechanism - see
 *     `packages/aws-durable-execution-sdk-js/src/types/durable-context.ts`
 *     and the `create-callback` example), so no `states:*` permission is
 *     needed at all. Added `lambda:SendDurableExecutionCallbackSuccess` /
 *     `lambda:SendDurableExecutionCallbackFailure` instead.
 *  4. `ApproveSqsLambda`'s inline code rewritten: was
 *     `require("@aws-sdk/client-sfn")` + `SendTaskSuccessCommand({ output,
 *     taskToken })`; now `require("@aws-sdk/client-lambda")` +
 *     `SendDurableExecutionCallbackSuccessCommand({ CallbackId, Result })`.
 *     The SQS message body's shape changes correspondingly: our workflow's
 *     `waitForCallback` submitter publishes `{ callbackId, stock_price,
 *     recommended_type }` (see the imported `.dar`'s "Request Human
 *     Approval" node), not Step Functions' `{ Input, TaskToken }" shape.
 *  5. `LambdaFunctionEventSourceMapping` unchanged - SQS -> ApproveSqsLambda
 *     trigger wiring is orchestrator-agnostic.
 *  6. `Outputs` replaced: `StateMachineArn`/`ExecutionInput` (meaningless
 *     without the state machine) -> `RequestHumanApprovalSqsUrl`,
 *     `ReportResultSnsTopicArn`, and the 5 Lambda function ARNs - what the
 *     imported `.dar` workflow's code actually needs to reference.
 *  7. All 5 original Lambda functions (BuyStockLambda,
 *     GenerateBuySellRecommendationLambda, CheckStockPriceLambda,
 *     SellStockLambda) are UNCHANGED except ApproveSqsLambda (see #4).
 */

const content = `---
AWSTemplateFormatVersion: 2010-09-09
Description: >-
  Workflow Studio "HelloLambda" starter pack infra (stripped of the original
  Step Functions state machine - see helloLambda.cfn.yaml.ts's header comment
  for what changed and why).
Resources:
  BuyStockLambda:
    Type: 'AWS::Lambda::Function'
    Properties:
      Handler: index.handler
      Code:
        ZipFile: |
          const crypto = require("crypto");

          function getRandomInt(max) {
              return Math.floor(Math.random() * Math.floor(max)) + 1;
          }

          /**
          * Sample Lambda function which mocks the operation of buying a random number of shares for a stock.
          * For demonstration purposes, this Lambda function does not actually perform any  actual transactions. It simply returns a mocked result.
          *
          * @param {Object} event - Input event to the Lambda function
          * @param {Object} context - Lambda Context runtime methods and attributes
          *
          * @returns {Object} object - Object containing details of the stock buying transaction
          *
          */
          exports.handler = async (event, context) => {
              // Get the price of the stock provided as input
              const stock_price = event["stock_price"]
              var date = new Date();
              // Mocked result of a stock buying transaction
              let transaction_result = {
                  'id': crypto.randomBytes(16).toString("hex"), // Unique ID for the transaction
                  'price': stock_price.toString(), // Price of each share
                  'type': "buy", // Type of transaction(buy/ sell)
                  'qty': getRandomInt(10).toString(),  // Number of shares bought / sold(We are mocking this as a random integer between 1 and 10)
                  'timestamp': date.toISOString(),  // Timestamp of the when the transaction was completed
              }
              return transaction_result
          };
      Role: !GetAtt
        - LambdaFunctionRole
        - Arn
      Runtime: nodejs22.x
  GenerateBuySellRecommendationLambda:
    Type: 'AWS::Lambda::Function'
    Properties:
      Handler: index.handler
      Code:
        ZipFile: |
          /**
          * Sample Lambda function which mocks the operation of recommending buying or selling of stocks.
          * For demonstration purposes this Lambda function simply returns a "buy" or "sell" string depending on stock price.
          *
          * @param {Object} event - Input event to the Lambda function
          * @param {Object} context - Lambda Context runtime methods and attributes
          *
          * @returns {String} - Either "buy" or "sell" string of recommendation.
          *
          */
          exports.handler = async (event, context) => {
              const { stock_price } = event;
              // If the stock price is greater than 50 recommend selling. Otherwise, recommend buying.
              return stock_price > 50 ? 'sell' : 'buy';
          };
      Role: !GetAtt
        - LambdaFunctionRole
        - Arn
      Runtime: nodejs22.x
  CheckStockPriceLambda:
    Type: 'AWS::Lambda::Function'
    Properties:
      Handler: index.handler
      Code:
        ZipFile: |
          function getRandomInt(max) {
              return Math.floor(Math.random() * Math.floor(max));
          }

          /**
          * Sample Lambda function which mocks the operation of checking the current price of a stock.
          * For demonstration purposes this Lambda function simply returns a random integer between 0 and 100 as the stock price.
          *
          * @param {Object} event - Input event to the Lambda function
          * @param {Object} context - Lambda Context runtime methods and attributes
          *
          * @returns {Object} object - Object containing the current price of the stock
          *
          */
          exports.handler = async (event, context) => {
              // Check current price of the stock
              const stock_price = getRandomInt(100)  // Current stock price is mocked as a random integer between 0 and 100
              return { 'stock_price': stock_price }
          };
      Role: !GetAtt
        - LambdaFunctionRole
        - Arn
      Runtime: nodejs22.x
  LambdaFunctionEventSourceMapping:
    Type: 'AWS::Lambda::EventSourceMapping'
    Properties:
      BatchSize: 10
      Enabled: true
      EventSourceArn: !GetAtt
        - RequestHumanApprovalSqs
        - Arn
      FunctionName: !GetAtt
        - ApproveSqsLambda
        - Arn
  SellStockLambda:
    Type: 'AWS::Lambda::Function'
    Properties:
      Handler: index.handler
      Code:
        ZipFile: |
          const crypto = require("crypto");

          function getRandomInt(max) {
              return Math.floor(Math.random() * Math.floor(max)) + 1;
          }

          /**
          * Sample Lambda function which mocks the operation of selling a random number of shares for a stock.
          * For demonstration purposes, this Lambda function does not actually perform any  actual transactions. It simply returns a mocked result.
          *
          * @param {Object} event - Input event to the Lambda function
          * @param {Object} context - Lambda Context runtime methods and attributes
          *
          * @returns {Object} object - Object containing details of the stock selling transaction
          *
          */
          exports.handler = async (event, context) => {
              // Get the price of the stock provided as input
              const stock_price = event["stock_price"]
              var date = new Date();
              // Mocked result of a stock selling transaction
              let transaction_result = {
                  'id': crypto.randomBytes(16).toString("hex"), // Unique ID for the transaction
                  'price': stock_price.toString(), // Price of each share
                  'type': "sell", // Type of transaction(buy/ sell)
                  'qty': getRandomInt(10).toString(),  // Number of shares bought / sold(We are mocking this as a random integer between 1 and 10)
                  'timestamp': date.toISOString(),  // Timestamp of the when the transaction was completed
              }
              return transaction_result
          };
      Role: !GetAtt
        - LambdaFunctionRole
        - Arn
      Runtime: nodejs22.x
  ApproveSqsLambda:
    Type: 'AWS::Lambda::Function'
    Properties:
      Handler: index.handler
      Code:
        ZipFile: |
          const { LambdaClient, SendDurableExecutionCallbackSuccessCommand } = require("@aws-sdk/client-lambda");

          /**
          * Auto-approves any durable-execution callback submitted to this queue by
          * the Workflow Studio "HelloLambda" durable function's "Request Human
          * Approval" waitForCallback step. Rewritten from the original starter
          * pack (which called Step Functions' SendTaskSuccess) to call Lambda's
          * SendDurableExecutionCallbackSuccess API instead - see this template's
          * header comment for why.
          *
          * @param {Object} event - SQS event; each record's body is the JSON the
          *   workflow's waitForCallback submitter published:
          *   { callbackId, stock_price, recommended_type }
          * @param {Object} context - Lambda Context runtime methods and attributes
          */
          exports.handler = async (event, context) => {
              const client = new LambdaClient();

              for (const record of event.Records) {
                  const messageBody = JSON.parse(record.body);
                  const callbackId = messageBody.callbackId;

                  console.log("Approving durable-execution callback " + callbackId);

                  try {
                      const data = await client.send(
                          new SendDurableExecutionCallbackSuccessCommand({
                              CallbackId: callbackId,
                              // Result becomes the workflow's next \\"input\\" -
                              // pass stock_price/recommended_type straight
                              // through (plus an approved flag) so downstream
                              // nodes ("Buy or Sell?", "Buy/Sell Stock") still
                              // have them.
                              Result: Buffer.from(
                                  JSON.stringify({
                                      approved: true,
                                      stock_price: messageBody.stock_price,
                                      recommended_type: messageBody.recommended_type,
                                  }),
                              ),
                          }),
                      );
                      console.log(data);
                  } catch (err) {
                      console.error(err && err.message ? err.message : err);
                      throw err;
                  }
              }
          };
      Role: !GetAtt
        - ManualApprovalFunctionRole
        - Arn
      Runtime: nodejs22.x
  ReportResultSnsTopic:
    Type: 'AWS::SNS::Topic'
  LambdaFunctionRole:
    Type: 'AWS::IAM::Role'
    Properties:
      AssumeRolePolicyDocument:
        Version: 2012-10-17
        Statement:
          - Action:
              - 'sts:AssumeRole'
            Effect: Allow
            Principal:
              Service:
                - lambda.amazonaws.com
      ManagedPolicyArns:
        - !Sub 'arn:\${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
  RequestHumanApprovalSqs:
    Type: 'AWS::SQS::Queue'
    Properties:
      SqsManagedSseEnabled: true
  ManualApprovalFunctionRole:
    Type: 'AWS::IAM::Role'
    Properties:
      Policies:
        - PolicyName: SQSReceiveMessagePolicy
          PolicyDocument:
            Version: 2012-10-17
            Statement:
              - Action:
                  - 'sqs:ReceiveMessage'
                  - 'sqs:DeleteMessage'
                  - 'sqs:GetQueueAttributes'
                  - 'sqs:ChangeMessageVisibility'
                Resource: !GetAtt
                  - RequestHumanApprovalSqs
                  - Arn
                Effect: Allow
        - PolicyName: CloudWatchLogsPolicy
          PolicyDocument:
            Statement:
              - Action:
                  - 'logs:CreateLogGroup'
                  - 'logs:CreateLogStream'
                  - 'logs:PutLogEvents'
                Resource: !Sub 'arn:\${AWS::Partition}:logs:*:*:*'
                Effect: Allow
        - PolicyName: DurableExecutionCallbackPolicy
          PolicyDocument:
            Version: 2012-10-17
            Statement:
              - Action:
                  - 'lambda:SendDurableExecutionCallbackSuccess'
                  - 'lambda:SendDurableExecutionCallbackFailure'
                Resource: '*'
                Effect: Allow
      AssumeRolePolicyDocument:
        Version: 2012-10-17
        Statement:
          - Action: 'sts:AssumeRole'
            Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
Outputs:
  RequestHumanApprovalSqsUrl:
    Value: !Ref RequestHumanApprovalSqs
  RequestHumanApprovalSqsArn:
    Value: !GetAtt
      - RequestHumanApprovalSqs
      - Arn
  ReportResultSnsTopicArn:
    Value: !Ref ReportResultSnsTopic
  CheckStockPriceLambdaArn:
    Value: !GetAtt
      - CheckStockPriceLambda
      - Arn
  GenerateBuySellRecommendationLambdaArn:
    Value: !GetAtt
      - GenerateBuySellRecommendationLambda
      - Arn
  BuyStockLambdaArn:
    Value: !GetAtt
      - BuyStockLambda
      - Arn
  SellStockLambdaArn:
    Value: !GetAtt
      - SellStockLambda
      - Arn
  ApproveSqsLambdaArn:
    Value: !GetAtt
      - ApproveSqsLambda
      - Arn
`;

export default content;
