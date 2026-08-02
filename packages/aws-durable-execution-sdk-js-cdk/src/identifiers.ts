/**
 * Identifier helpers now live in the shared
 * `@aws/durable-execution-sdk-js-visual-workflow-model` package so the Studio
 * and the CDK generator can't drift. Re-exported here (with the historical
 * `RESERVED` alias) so existing imports keep working.
 */
export {
  toIdentifier,
  buildIdentifierMap,
  RESERVED_IDENTIFIERS as RESERVED,
} from "@aws/durable-execution-sdk-js-visual-workflow-model";
