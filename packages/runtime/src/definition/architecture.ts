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
    if (
      ts.isVariableStatement(statement) &&
      !isDefinition(statement) &&
      !supersededByDefinition(statement) &&
      isPureConstant(statement)
    ) {
      // A helper: `const TAU = Math.PI * 2`, `const PALETTE = [...] as const`,
      // `const lerp = (a, b, t) => a + (b - a) * t`. Immutable, so it cannot
      // carry anything from one cook to the next.
      continue;
    }
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

  /**
   * Whether a module-level declaration is an immutable helper rather than
   * state: `const` only, and every initializer pure (see `isPure`).
   */
  function isPureConstant(statement: TypeScript.VariableStatement): boolean {
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) return false;
    return statement.declarationList.declarations.every(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        declaration.initializer !== undefined &&
        isPure(declaration.initializer, false),
    );
  }

  /**
   * An expression that creates no mutable value: literals, arithmetic and
   * logic over them, references and property reads (`Math.PI`), functions
   * (they close over nothing mutable, since nothing at module level is), and
   * array/object literals only when frozen — `as const` or `Object.freeze(…)`.
   * Calls, `new`, regular expressions (`lastIndex` is state) and a bare
   * array or object are not.
   */
  function isPure(node: TypeScript.Expression, frozen: boolean): boolean {
    if (
      ts.isNumericLiteral(node) || ts.isStringLiteral(node) || ts.isBigIntLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword ||
      node.kind === ts.SyntaxKind.NullKeyword
    ) return true;
    if (ts.isIdentifier(node)) return true;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
    if (ts.isParenthesizedExpression(node)) return isPure(node.expression, frozen);
    if (ts.isAsExpression(node))
      return isPure(node.expression, frozen || isConstAssertion(node.type));
    if (ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node))
      return isPure(node.expression, frozen);
    if (ts.isPrefixUnaryExpression(node))
      return node.operator !== ts.SyntaxKind.PlusPlusToken &&
        node.operator !== ts.SyntaxKind.MinusMinusToken &&
        isPure(node.operand, false);
    if (ts.isBinaryExpression(node))
      return !isAssignment(node.operatorToken.kind) &&
        isPure(node.left, false) && isPure(node.right, false);
    if (ts.isConditionalExpression(node))
      return isPure(node.condition, false) && isPure(node.whenTrue, frozen) && isPure(node.whenFalse, frozen);
    if (ts.isTemplateExpression(node))
      return node.templateSpans.every((span) => isPure(span.expression, false));
    if (ts.isPropertyAccessExpression(node)) return isPure(node.expression, false);
    if (ts.isElementAccessExpression(node))
      return isPure(node.expression, false) && isPure(node.argumentExpression, false);
    if (ts.isArrayLiteralExpression(node))
      return frozen && node.elements.every((element) => !ts.isSpreadElement(element) && isPure(element, true));
    if (ts.isObjectLiteralExpression(node))
      return frozen && node.properties.every((property) =>
        ts.isPropertyAssignment(property)
          ? !ts.isComputedPropertyName(property.name) && isPure(property.initializer, true)
          : ts.isShorthandPropertyAssignment(property));
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Object" &&
      node.expression.name.text === "freeze" &&
      node.arguments.length === 1
    ) {
      const [argument] = node.arguments;
      // Object.freeze is shallow: a nested array or object needs its own freeze.
      return ts.isArrayLiteralExpression(argument)
        ? argument.elements.every((element) => !ts.isSpreadElement(element) && isPure(element, false))
        : ts.isObjectLiteralExpression(argument)
          ? argument.properties.every((property) =>
            ts.isPropertyAssignment(property) &&
            !ts.isComputedPropertyName(property.name) &&
            isPure(property.initializer, false))
          : false;
    }
    return false;
  }

  function isConstAssertion(type: TypeScript.TypeNode): boolean {
    return ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === "const";
  }

  function isAssignment(kind: TypeScript.SyntaxKind): boolean {
    return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
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
