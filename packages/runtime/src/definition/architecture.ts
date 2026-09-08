import type * as TypeScript from "typescript";
import type { Diagnostic } from "@cascade/contracts";

const AMBIENT_STATE = new Set([
  "globalThis",
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "process",
  "Bun",
  "Deno",
]);

/**
 * Enforces the statically inspectable node-module boundary. This is an
 * architecture check for trusted project code, not a security sandbox.
 */
export function validateNodeModuleArchitecture(
  source: string,
  fileName: string,
  ts: typeof TypeScript,
): readonly Diagnostic[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics: Diagnostic[] = [];
  const exportsDefinition = file.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) && isDefinition(statement),
  );

  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement) && !isDefinition(statement)) {
      // `icon` and `runsOn` get their own sentence, because the general
      // message sends you looking for the wrong thing. A dynamic node declares
      // them at module level and must — they are read by a pass over the
      // source. A definition-v1 node declares them *inside* the definition,
      // and the moment it does, the module-level copies become exactly the
      // module state this rule forbids.
      //
      // Found the hard way on 2026-09-08: the first literal stub written for a
      // converted shared node failed here, and the message talks about pure
      // functions and capabilities while the actual fix is to move two lines
      // into the object above them. That is not guessable from the error.
      const superseded = supersededByDefinition(statement);
      add(
        statement,
        "module-state",
        superseded
          ? `\`${superseded}\` belongs inside the definition, not beside it — a definition-v1 node declares it as \`${superseded}: ...\` in \`export const definition\`, and a module-level copy is the module state this rule forbids. A dynamic node without a definition still declares it here.`
          : "Node modules may not declare module-level values; use a pure function or pass state through ports, props, and declared capabilities",
      );
    } else if (
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      add(
        statement,
        "module-state",
        "Node modules may not declare classes, enums, or namespaces because they can retain module-global state",
      );
    } else if (ts.isExpressionStatement(statement)) {
      add(
        statement,
        "top-level-effect",
        "Node modules may not run top-level effects",
      );
    } else if (
      ts.isImportDeclaration(statement) &&
      !statement.importClause
    ) {
      add(
        statement,
        "side-effect-import",
        "Side-effect imports are not allowed in node modules",
      );
    } else if (
      ts.isImportDeclaration(statement) &&
      !statement.importClause?.isTypeOnly &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      importsSiblingNode(fileName, statement.moduleSpecifier.text)
    ) {
      add(
        statement.moduleSpecifier,
        "node-import",
        "A node may not import another node implementation; connect the nodes with a graph wire",
      );
    }
  }

  visit(file);
  return diagnostics;

  function visit(node: TypeScript.Node): void {
    if (ts.isTypeNode(node) || ts.isImportDeclaration(node)) return;
    if (
      ts.isIdentifier(node) &&
      AMBIENT_STATE.has(node.text) &&
      isReference(node)
    ) {
      add(
        node,
        "ambient-state",
        `${node.text} is ambient state; receive data through ports, props, or a declared capability`,
      );
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      add(
        node,
        "dynamic-import",
        "Dynamic imports are not allowed in deterministic node execution",
      );
    }
    ts.forEachChild(node, visit);
  }

  function isReference(node: TypeScript.Identifier): boolean {
    const parent = node.parent;
    return !(
      (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isPropertyAssignment(parent) && parent.name === node) ||
      (ts.isMethodDeclaration(parent) && parent.name === node) ||
      (ts.isPropertyDeclaration(parent) && parent.name === node)
    );
  }

  /**
   * The name of a declaration a `definition` has taken over, or null.
   *
   * Only reported when the file actually exports a definition: without one,
   * `export const icon` is the correct and only way to state it, and telling
   * somebody to move it into an object that does not exist would be worse than
   * the general message.
   */
  function supersededByDefinition(
    statement: TypeScript.VariableStatement,
  ): string | null {
    if (!exportsDefinition) return null;
    const declaration = statement.declarationList.declarations[0];
    if (statement.declarationList.declarations.length !== 1) return null;
    if (!declaration || !ts.isIdentifier(declaration.name)) return null;
    return declaration.name.text === "icon" || declaration.name.text === "runsOn"
      ? declaration.name.text
      : null;
  }

  function isDefinition(statement: TypeScript.VariableStatement): boolean {
    return Boolean(statement.declarationList.flags & ts.NodeFlags.Const) &&
      Boolean(statement.modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)) &&
      statement.declarationList.declarations.length === 1 &&
      ts.isIdentifier(statement.declarationList.declarations[0].name) &&
      statement.declarationList.declarations[0].name.text === "definition";
  }

  function add(node: TypeScript.Node, code: string, message: string): void {
    const point = file.getLineAndCharacterOfPosition(node.getStart(file));
    diagnostics.push({
      phase: "architecture",
      code: `architecture/${code}`,
      message,
      file: fileName,
      line: point.line + 1,
      column: point.character + 1,
    });
  }
}

function importsSiblingNode(fileName: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const file = normalize(fileName).split("/");
  const nodesIndex = file.lastIndexOf("nodes");
  if (nodesIndex < 0 || !file[nodesIndex + 1]) return false;
  const sourceNode = file[nodesIndex + 1];
  const resolved = normalize([...file.slice(0, -1), ...specifier.split("/")].join("/")).split("/");
  const resolvedNodesIndex = resolved.lastIndexOf("nodes");
  return resolvedNodesIndex >= 0 &&
    Boolean(resolved[resolvedNodesIndex + 1]) &&
    resolved[resolvedNodesIndex + 1] !== sourceNode;
}

function normalize(value: string): string {
  const output: string[] = [];
  // split/join rather than replaceAll: the root tsconfig targets ES2020, so
  // svelte-check rejects the ES2021 method even though this package targets ES2022.
  for (const part of value.split("\\").join("/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") output.pop();
    else output.push(part);
  }
  return output.join("/");
}
