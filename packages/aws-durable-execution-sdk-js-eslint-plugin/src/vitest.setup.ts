import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";

// ESLint's RuleTester looks for global describe/it, which vitest only
// provides with `globals: true`. Wire it to the explicit imports instead.
RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
