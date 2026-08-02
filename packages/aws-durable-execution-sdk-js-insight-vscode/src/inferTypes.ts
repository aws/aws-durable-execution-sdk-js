// Result-type inference for Workflow Studio nodes.
//
// Each result-binding node's `code` becomes the body of an async function; we
// compile a small self-contained module (the same shape as the "Edit in VS
// Code" scaffold, but with an *un-annotated* function so TypeScript infers the
// return type) and read the inferred type back via the compiler API.
//
// The compiler only sees the inline scaffold types (StepCtx/WaitCtx/Logger) and
// the upstream `declare const`s — not the real AWS SDK typings — so SDK-heavy
// bodies resolve to `any` (dropped). Object literals and local logic infer
// precisely. Inference runs in dependency order so each node's upstream types
// feed the next node's scope.
import * as ts from "typescript";

export interface InferItem {
  /** Stable node id; the returned map is keyed by this. */
  nodeId: string;
  /** Identifier the result binds to (so downstream nodes can reference it). */
  resultName: string;
  /** The node's code (function body). */
  code: string;
  /** step-like bodies vs waitForCondition (state) bodies. */
  codeKind: "step" | "condition";
  /** Identifier names in scope at this node (upstream results + extras). */
  scope: string[];
}

const VIRTUAL_FILE = "__wf_infer__.ts";

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  lib: ["lib.es2020.d.ts"],
  noEmit: true,
  strict: false,
  skipLibCheck: true,
  noLib: false,
};

/**
 * Infer result types for the given nodes (in dependency order). Author-declared
 * types in `seedTypes` (keyed by result-const identifier) take precedence and
 * seed the scope. Returns a map of nodeId -> inferred type string, omitting any
 * node whose type could not be inferred to something more precise than `any`.
 */
export function inferResultTypes(
  items: InferItem[],
  seedTypes: Record<string, string> = {},
  inputType?: string,
): Record<string, string> {
  const known: Record<string, string> = { ...seedTypes };
  const out: Record<string, string> = {};
  for (const item of items) {
    try {
      const scopeTypes: Record<string, string> = {};
      for (const name of item.scope) {
        if (known[name]) scopeTypes[name] = known[name];
      }
      const inferred = inferOne(item, scopeTypes, inputType);
      if (inferred) {
        out[item.nodeId] = inferred;
        // Feed the inferred type forward, but never clobber an author-declared
        // seed type for the same identifier.
        if (!(item.resultName in seedTypes)) known[item.resultName] = inferred;
      }
    } catch {
      // Leave this node's type to the author; keep inferring the rest.
    }
  }
  return out;
}

function inferOne(
  item: InferItem,
  scopeTypes: Record<string, string>,
  inputType?: string,
): string | undefined {
  const source = buildModule(item, scopeTypes, inputType);
  const sourceFile = ts.createSourceFile(
    VIRTUAL_FILE,
    source,
    COMPILER_OPTIONS.target ?? ts.ScriptTarget.ES2020,
    true,
  );
  const host = ts.createCompilerHost(COMPILER_OPTIONS);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, langVersion, onError, shouldCreate) =>
    name === VIRTUAL_FILE
      ? sourceFile
      : originalGetSourceFile(name, langVersion, onError, shouldCreate);
  host.writeFile = () => {};

  const program = ts.createProgram([VIRTUAL_FILE], COMPILER_OPTIONS, host);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(VIRTUAL_FILE);
  if (!sf) return undefined;

  let result: string | undefined;
  ts.forEachChild(sf, (node) => {
    if (result || !ts.isVariableStatement(node)) return;
    for (const decl of node.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === "__wf_result__" &&
        decl.initializer
      ) {
        const fnType = checker.getTypeAtLocation(decl.initializer);
        const signatures = fnType.getCallSignatures();
        if (signatures.length > 0) {
          const returnType = unwrapPromise(
            checker,
            checker.getReturnTypeOfSignature(signatures[0]),
          );
          result = normalize(
            checker.typeToString(
              returnType,
              undefined,
              ts.TypeFormatFlags.NoTruncation |
                ts.TypeFormatFlags.WriteArrayAsGenericType,
            ),
          );
        }
      }
    }
  });
  return result;
}

function unwrapPromise(checker: ts.TypeChecker, type: ts.Type): ts.Type {
  const symbol = type.getSymbol();
  if (symbol?.getName() === "Promise") {
    const args = checker.getTypeArguments(type as ts.TypeReference);
    if (args.length === 1) return args[0];
  }
  return type;
}

function normalize(raw: string): string | undefined {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (
    collapsed === "" ||
    collapsed === "any" ||
    collapsed === "unknown" ||
    collapsed === "never" ||
    collapsed === "{}" ||
    collapsed === "void"
  ) {
    return undefined;
  }
  return collapsed;
}

function buildModule(
  item: InferItem,
  scopeTypes: Record<string, string>,
  inputType?: string,
): string {
  const hasInputType =
    typeof inputType === "string" && inputType.trim().length > 0;
  const typedInput = new Set(["event", "input"]);
  // `state` is a function parameter in the condition wrapper — don't redeclare.
  const provided = item.codeKind === "condition" ? ["state"] : [];
  const inScope = item.scope.filter((name) => !provided.includes(name));
  const declarations = inScope.map((name) => {
    const t =
      hasInputType && typedInput.has(name)
        ? "WorkflowInput"
        : (scopeTypes[name] ?? "any");
    return `declare const ${name}: ${t};`;
  });
  const signature =
    item.codeKind === "condition"
      ? "const __wf_result__ = async (state: any, ctx: WaitCtx) => {"
      : "const __wf_result__ = async (stepCtx: StepCtx) => {";
  return [
    "export {};",
    "type Logger = { debug(...a: any[]): void; info(...a: any[]): void; warn(...a: any[]): void; error(...a: any[]): void };",
    "type StepCtx = { attempt: number; logger: Logger; [k: string]: any };",
    "type WaitCtx = { logger: Logger; [k: string]: any };",
    ...(hasInputType ? [`type WorkflowInput = ${inputType!.trim()};`] : []),
    ...declarations,
    signature,
    item.code,
    "};",
  ].join("\n");
}
