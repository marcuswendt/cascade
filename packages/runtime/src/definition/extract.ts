import type * as TypeScript from "typescript";
import {
  validateNodeDefinition,
  type Diagnostic,
  type NodeDefinition,
} from "@cascade/contracts";

export type DefinitionExtractionResult =
  | {
      readonly ok: true;
      readonly definition: NodeDefinition;
      readonly diagnostics: readonly [];
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

const MAX_DEPTH = 32;
const MAX_NODES = 10_000;

export function extractNodeDefinition(
  source: string,
  fileName: string,
  ts: typeof TypeScript,
): DefinitionExtractionResult {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const syntaxDiagnostics = (
    file as TypeScript.SourceFile & {
      readonly parseDiagnostics?: readonly TypeScript.Diagnostic[];
    }
  ).parseDiagnostics;
  if (syntaxDiagnostics?.length) {
    const syntax = syntaxDiagnostics[0];
    const start = syntax.start ?? 0;
    const point = file.getLineAndCharacterOfPosition(start);
    return {
      ok: false,
      diagnostics: [
        {
          phase: "definition",
          code: "definition/syntax",
          message: ts.flattenDiagnosticMessageText(syntax.messageText, "\n"),
          file: fileName,
          line: point.line + 1,
          column: point.character + 1,
        },
      ],
    };
  }
  const declarations: TypeScript.VariableDeclaration[] = [];
  for (const statement of file.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    )
      continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "definition"
      )
        declarations.push(declaration);
    }
  }
  if (declarations.length !== 1)
    return failure(
      declarations[1] ?? declarations[0] ?? file,
      declarations.length
        ? "definition/duplicate-export"
        : "definition/missing-export",
      declarations.length
        ? "Exactly one definition export is allowed"
        : "Missing exported const definition",
    );
  const declaration = declarations[0];
  const initializer = declaration.initializer;
  if (!initializer)
    return failure(
      declaration,
      "definition/non-literal",
      "definition requires a literal initializer",
    );
  let visited = 0;
  try {
    const definition = read(initializer, "$", 0);
    const diagnostics = validateNodeDefinition(definition).map((item) => ({
      ...item,
      file: fileName,
      ...location(initializer),
    }));
    return diagnostics.length
      ? { ok: false, diagnostics }
      : { ok: true, definition: definition as NodeDefinition, diagnostics: [] };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [(error as ExtractionFailure).diagnostic],
    };
  }

  function read(
    node: TypeScript.Expression,
    path: string,
    depth: number,
  ): unknown {
    if (++visited > MAX_NODES)
      throw extraction(
        node,
        "definition/size-limit",
        "Definition exceeds 10,000 syntax nodes",
        path,
      );
    if (depth > MAX_DEPTH)
      throw extraction(
        node,
        "definition/depth-limit",
        "Definition exceeds 32 levels",
        path,
      );
    if (ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node))
      return read(node.expression, path, depth + 1);
    if (ts.isAsExpression(node)) {
      if (node.type.getText(file) !== "const")
        throw extraction(
          node.type,
          "definition/non-literal",
          "Only 'as const' assertions are allowed",
          path,
        );
      return read(node.expression, path, depth + 1);
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand)
    )
      return -Number(node.operand.text);
    if (ts.isArrayLiteralExpression(node))
      return node.elements.map((element, index) => {
        if (ts.isSpreadElement(element))
          throw extraction(
            element,
            "definition/spread",
            "Spreads are not allowed",
            `${path}.${index}`,
          );
        return read(element, `${path}.${index}`, depth + 1);
      });
    if (ts.isObjectLiteralExpression(node)) {
      const object = Object.create(null) as Record<string, unknown>;
      const keys = new Set<string>();
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property))
          throw extraction(
            property,
            "definition/spread",
            "Spreads are not allowed",
            path,
          );
        if (
          !ts.isPropertyAssignment(property) ||
          (property.name && ts.isComputedPropertyName(property.name))
        )
          throw extraction(
            property,
            "definition/non-literal",
            "Only explicit properties are allowed",
            path,
          );
        const key =
          ts.isIdentifier(property.name) ||
          ts.isStringLiteral(property.name) ||
          ts.isNumericLiteral(property.name)
            ? property.name.text
            : undefined;
        if (key === undefined)
          throw extraction(
            property,
            "definition/non-literal",
            "Property name must be literal",
            path,
          );
        if (keys.has(key))
          throw extraction(
            property.name,
            "definition/duplicate-key",
            `Duplicate key ${key}`,
            `${path}.${key}`,
          );
        keys.add(key);
        object[key] = read(property.initializer, `${path}.${key}`, depth + 1);
      }
      return object;
    }
    throw extraction(
      node,
      "definition/non-literal",
      `Unsupported ${ts.SyntaxKind[node.kind]}`,
      path,
    );
  }
  function location(node: TypeScript.Node) {
    const point = file.getLineAndCharacterOfPosition(node.getStart(file));
    return { line: point.line + 1, column: point.character + 1 };
  }
  function extraction(
    node: TypeScript.Node,
    code: string,
    message: string,
    path?: string,
  ) {
    return new ExtractionFailure({
      phase: "definition",
      code,
      message,
      path,
      file: fileName,
      ...location(node),
    });
  }
  function failure(
    node: TypeScript.Node,
    code: string,
    message: string,
  ): DefinitionExtractionResult {
    return {
      ok: false,
      diagnostics: [extraction(node, code, message).diagnostic],
    };
  }
}

class ExtractionFailure extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}
