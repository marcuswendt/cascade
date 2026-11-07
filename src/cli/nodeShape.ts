/**
 * Shape warnings for `cascade check`: a node that has grown into a pipeline.
 *
 * Marcus, 2026-11-06: agents write several single-job nodes, because clean
 * graph design is good code design (doc/PROJECT_AUTHORING.md, "Design the
 * graph"). He picked warn-only, so nothing here ever fails a check: a sketch
 * that works keeps checking clean, and the warning says where to split it.
 *
 * Two signals, both read statically from the module source:
 *
 * - `shape/long-execute`: `execute` runs past {@link LONG_EXECUTE_LINES} lines.
 * - `shape/mixed-jobs`: the module does {@link MIXED_JOB_COUNT} or more of the
 *   five jobs (load, generate, colour, draw, export), or both loads and
 *   exports. Drawing with colour and noise is what a drawing node does, so
 *   three jobs alone stay quiet; reading its own input and writing its own
 *   file is the whole pipeline in one box.
 *
 * Jobs are recognised by the calls the module makes, helpers in the same file
 * included, since they run as part of this node. It is a heuristic and says so
 * in its message.
 */
import type * as TypeScript from 'typescript';
import type { Diagnostic } from '../../packages/contracts/src/index.js';

export const LONG_EXECUTE_LINES = 150;
export const MIXED_JOB_COUNT = 4;

export type NodeJob = 'load' | 'generate' | 'colour' | 'draw' | 'export';
const JOB_ORDER: readonly NodeJob[] = ['load', 'generate', 'colour', 'draw', 'export'];

/** Called function or method names that mark each job. */
const BY_NAME: Record<NodeJob, RegExp> = {
  load: /^(readFile(Sync)?|loadImage|loadFont|loadJson|readJson|fetch|decodeImage)$/,
  generate: /^(random|rng|hash\d*|noise\w*|\w*[nN]oise\d*|fbm|simplex\w*|perlin\w*|worley\w*|poisson\w*|scatter\w*)$/,
  colour: /^(oklch|oklab|\w*[oO]klab\w*|\w*[oO]klch\w*|okMix|hsl\w*|palette\w*|mixColou?r|lerpColou?r|\w*Palette)$/,
  draw: /^(getContext|beginPath|fillRect|strokeRect|drawImage|putImageData|createImageData|arc|lineTo|createRenderPipeline|createComputePipeline|draw|drawIndexed|dispatchWorkgroups)$/,
  export: /^(writeFile(Sync)?|savePng|saveSvg|saveJpe?g|toBuffer|toBlob|toDataURL|encodePng|encodeJpe?g|encodeImage)$/,
};

/** `files.read(...)`, `assets.write(...)`: the capability methods. */
const CAPABILITY_RECEIVER = /(^|\.)(files|assets)$/;

export interface NodeShape {
  readonly executeLines: number | null;
  readonly jobs: readonly NodeJob[];
}

export function measureNodeShape(source: string, fileName: string, ts: typeof TypeScript): NodeShape & { readonly executeLine: number | null } {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let executeLines: number | null = null;
  let executeLine: number | null = null;
  const jobs = new Set<NodeJob>();

  for (const statement of file.statements) {
    const body = executeBody(statement);
    if (!body) continue;
    const start = file.getLineAndCharacterOfPosition(body.getStart(file)).line;
    const end = file.getLineAndCharacterOfPosition(body.getEnd()).line;
    executeLines = end - start + 1;
    executeLine = file.getLineAndCharacterOfPosition(statement.getStart(file)).line + 1;
  }

  visit(file);
  return { executeLines, executeLine, jobs: JOB_ORDER.filter((job) => jobs.has(job)) };

  function executeBody(statement: TypeScript.Statement): TypeScript.Node | undefined {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'execute') return statement.body;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'execute') continue;
        const init = declaration.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return init.body;
      }
    }
    return undefined;
  }

  function visit(node: TypeScript.Node): void {
    if (ts.isCallExpression(node)) classify(node.expression);
    ts.forEachChild(node, visit);
  }

  function classify(callee: TypeScript.Expression): void {
    let name: string | undefined;
    if (ts.isIdentifier(callee)) name = callee.text;
    else if (ts.isPropertyAccessExpression(callee)) {
      name = callee.name.text;
      const receiver = callee.expression.getText(file);
      if (CAPABILITY_RECEIVER.test(receiver)) {
        if (/^(read|list|stat|resolveUrl)$/.test(name)) jobs.add('load');
        if (name === 'write') jobs.add('export');
      }
      if (receiver === 'Math' && name === 'random') { jobs.add('generate'); return; }
    }
    if (!name) return;
    for (const job of JOB_ORDER) if (BY_NAME[job].test(name)) jobs.add(job);
  }
}

/** The warnings for one module, empty when its shape is fine. */
export function nodeShapeWarnings(source: string, fileName: string, ts: typeof TypeScript, moduleId?: string): Diagnostic[] {
  const shape = measureNodeShape(source, fileName, ts);
  const where = moduleId ?? fileName;
  const out: Diagnostic[] = [];
  if (shape.executeLines !== null && shape.executeLines > LONG_EXECUTE_LINES) {
    out.push({
      phase: 'shape',
      code: 'shape/long-execute',
      message: `${where}: execute is ${shape.executeLines} lines (over ${LONG_EXECUTE_LINES}). Split it into single-job nodes wired in the graph.`,
      file: fileName,
      line: shape.executeLine ?? undefined,
    });
  }
  const loadsAndExports = shape.jobs.includes('load') && shape.jobs.includes('export') && shape.jobs.length > 2;
  if (shape.jobs.length >= MIXED_JOB_COUNT || loadsAndExports) {
    out.push({
      phase: 'shape',
      code: 'shape/mixed-jobs',
      message: `${where}: one node does ${shape.jobs.join(', ')} (judged from the calls it makes). Give each job its own node.`,
      file: fileName,
    });
  }
  return out;
}

/** Printed by `check` only, under one heading, never fatal. */
export function reportNodeShape(warnings: readonly Diagnostic[]): void {
  if (!warnings.length) return;
  console.warn([
    `Node shape — ${warnings.length === 1 ? 'one warning' : `${warnings.length} warnings`} (advice only, the check still passes):`,
    ...warnings.map((item) => `  ${item.code}: ${item.message}`),
    '  See "Design the graph" in doc/PROJECT_AUTHORING.md.',
  ].join('\n'));
}
