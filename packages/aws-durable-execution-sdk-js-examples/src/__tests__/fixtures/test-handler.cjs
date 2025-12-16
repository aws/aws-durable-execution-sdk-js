const { withDurableExecution } = require("@aws/durable-execution-sdk-js");

module.exports.handler = withDurableExecution(async (event, context) => {
  return "Test CLI Success!";
});

module.exports.customHandler = withDurableExecution(async (event, context) => {
  return "Custom Handler Success!";
});
