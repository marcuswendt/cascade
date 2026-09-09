import fs from 'node:fs/promises';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';
import ts from 'typescript';
import type { CascadeDocument, NodeDefinition } from '../../packages/contracts/src/index.js';
import { createRuntime } from '../../packages/runtime/src/index.js';
import { createBrowserRuntimeHost } from '../../packages/runtime/src/browser.js';
import { builtinNodeRegistration } from '../../packages/runtime/src/builtins/index.js';
import { extractNodeDefinition } from '../../packages/runtime/src/definition/extract.js';
import { validateNodeModuleArchitecture } from '../../packages/runtime/src/definition/architecture.js';
import type { DefinitionNodeRegistration, RuntimeCapabilities } from '../../packages/runtime/src/types.js';
import { ProjectRoot } from '../../server/src/project.js';
import { moduleId, projectModuleFile } from './projectRuntime.js';

export interface PlayerBuildOptions {
  out: string;
  assets?: readonly string[];
}

interface ProjectModule {
  id: string;
  file: string;
  definition: NodeDefinition;
}

const installRoot = fileURLToPath(new URL('../../', import.meta.url));
const forbiddenModules = new Set(builtinModules.map(name => name.replace(/^node:/, '')));

/** Compile a trusted project without loading its executors or copying its directory. */
export async function buildPlayer(file: string, options: PlayerBuildOptions): Promise<{ directory: string }> {
  if (!options.out) throw new Error('cascade build requires --out <new-directory>');
  const project = new ProjectRoot(path.dirname(path.resolve(file)));
  const out = path.resolve(project.root, options.out);
  if (await exists(out)) throw new Error(`Player output already exists: ${out}. Choose a new directory.`);
  const canonicalOut = await canonicalFuturePath(out);
  for (const sourceDirectory of ['assets', 'nodes']) {
    const sourceRoot = await canonicalFuturePath(path.join(project.root, sourceDirectory));
    if (inside(sourceRoot, canonicalOut)) {
      throw new Error(`Player output cannot be inside the project's ${sourceDirectory} directory`);
    }
  }

  const document = JSON.parse(await fs.readFile(file, 'utf8')) as CascadeDocument;
  if (!Array.isArray(document.nodes)) throw new Error('Graph document must contain a nodes array');
  const modules: ProjectModule[] = [];
  const seen = new Set<string>();
  for (const node of document.nodes) {
    const id = moduleId(node);
    if (seen.has(id)) continue;
    seen.add(id);
    if (builtinNodeRegistration(id)) continue;
    const resolved = await projectModuleFile(project.root, node, id);
    if (!resolved.file) throw new Error(`${id}: no supported static project module (${resolved.tried.join(', ')})`);
    // Resolve canonically too: the shared CLI lookup intentionally only discovers names.
    const sourceFile = project.resolve(path.relative(project.root, resolved.file));
    const source = await fs.readFile(sourceFile, 'utf8');
    const extracted = extractNodeDefinition(source, sourceFile, ts);
    if (!extracted.ok) throw new Error(`${id}: static browser builds require definition-v1\n${extracted.diagnostics.map(d => `${d.code}: ${d.message}`).join('\n')}`);
    const diagnostics = validateNodeModuleArchitecture(source, sourceFile, ts);
    if (diagnostics.length) throw new Error(diagnostics.map(d => `${id}: ${d.code}: ${d.message}`).join('\n'));
    modules.push({ id, file: sourceFile, definition: extracted.definition });
  }

  const registrations: DefinitionNodeRegistration[] = modules.map(item => ({
    kind: 'definition-v1', moduleId: item.id, definition: item.definition,
    loadExecute: async () => { throw new Error('Static builds never execute project code'); },
  }));
  const runtime = createRuntime({ host: createBrowserRuntimeHost({
    modules: { resolve: async id => registrations.find(item => item.moduleId === id) ?? null },
    // Presence describes the exported player contract, not this Node process.
    assets: {} as NonNullable<RuntimeCapabilities['assets']>,
    gpu: {} as NonNullable<RuntimeCapabilities['gpu']>,
  }), nodes: registrations });
  const assets = new Set(options.assets ?? []);
  try {
    const graph = await runtime.load(document);
    const diagnostics = graph.preflight();
    if (diagnostics.length) throw new Error(`This graph cannot be exported to the browser player:\n${diagnostics.map(d => `${d.path ?? ''} ${d.code}: ${d.message}`).join('\n')}`);
    for (const node of graph.inspect().nodes) {
      for (const port of [...Object.values(node.inputs), ...Object.values(node.props)]) {
        if (port.type !== 'image' && port.type !== 'asset') continue;
        const value = port.value;
        const asset = typeof value === 'string' ? value : value && typeof value === 'object' && 'path' in value ? value.path : undefined;
        if (typeof asset === 'string' && asset && !/^(https?:|data:|blob:)/.test(asset)) assets.add(asset);
      }
    }
  } finally {
    await runtime.dispose();
  }

  const sources: Array<{ name: string; file: string }> = [];
  for (const asset of assets) {
    const name = asset.replace(/^\.\//, '');
    if (!name || name.includes('\\') || name.split('/').some(part => !part || part.startsWith('.')) || path.isAbsolute(name)) {
      throw new Error(`Asset must be a visible project-relative file: ${asset}`);
    }
    const source = project.resolve(name);
    if (!(await fs.stat(source)).isFile()) throw new Error(`Asset is not a file: ${asset}`);
    sources.push({ name, file: source });
  }

  const playerApp = await playerFile('app');
  const playerEmbed = await playerFile('embed');
  const plugins = [await staticRuntimePlugin(project.root)];
  const imports = modules.map((item, index) => `import { execute as execute${index} } from ${JSON.stringify(item.file)};`).join('\n');
  const registrationSource = modules.map((item, index) => `{ kind:'definition-v1', moduleId:${JSON.stringify(item.id)}, definition:${JSON.stringify(item.definition)}, loadExecute:async()=>execute${index} }`).join(',');
  const assetSource = sources.map(item => `${JSON.stringify(item.name)}:new URL(${JSON.stringify(`./assets/${item.name.split('/').map(encodeURIComponent).join('/')}`)},import.meta.url).href`).join(',');
  const appSource = `import { startPlayer } from ${JSON.stringify(playerApp)};\n${imports}\nwindow.cascadePlayerReady = startPlayer({document:${JSON.stringify(document)},registrations:[${registrationSource}],assets:{${assetSource}}});\nwindow.cascadePlayerReady.catch(error=>{const message=document.createElement('pre');message.textContent=String(error?.message??error);document.body.append(message);});`;
  const embedSource = `import { mountPlayer } from ${JSON.stringify(playerEmbed)};\nexport function mount(container,options={}) { return mountPlayer(container,{...options,url:new URL('./player.html',import.meta.url)}); }`;

  // Compile before creating the output tree. Dependency resolution is browser-only.
  const common = { bundle: true, platform: 'browser' as const, format: 'esm' as const,
    target: 'es2022', write: false, minify: true, logLevel: 'silent' as const, plugins };
  const app = await build({ ...common, stdin: { contents: appSource, resolveDir: project.root, sourcefile: 'player-entry.js' } });
  const embed = await build({ ...common, stdin: { contents: embedSource, resolveDir: project.root, sourcefile: 'embed-entry.js' } });
  await fs.mkdir(path.dirname(out), { recursive: true });
  const staging = await fs.mkdtemp(path.join(path.dirname(out), '.cascade-player-'));
  try {
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cascade</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font:13px system-ui}pre{white-space:pre-wrap;padding:16px}</style></head><body><script type="module" src="./app.js"></script></body></html>';
    await fs.writeFile(path.join(staging, 'index.html'), html);
    await fs.writeFile(path.join(staging, 'player.html'), html);
    await fs.writeFile(path.join(staging, 'app.js'), app.outputFiles![0].contents);
    await fs.writeFile(path.join(staging, 'embed.js'), embed.outputFiles![0].contents);
    for (const source of sources) {
      const target = path.join(staging, 'assets', source.name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source.file, target);
    }
    // mkdir is the no-overwrite reservation; rename alone may replace an empty directory.
    await fs.mkdir(out);
    try {
      for (const entry of await fs.readdir(staging)) await fs.rename(path.join(staging, entry), path.join(out, entry));
    } catch (error) {
      await fs.rm(out, { recursive: true, force: true });
      throw error;
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  return { directory: out };
}

async function playerFile(name: string): Promise<string> {
  const source = path.join(installRoot, 'src', 'player', `${name}.ts`);
  return await exists(source) ? source : path.join(installRoot, 'dist', 'player', `${name}.js`);
}

async function staticRuntimePlugin(projectRoot: string): Promise<Plugin> {
  const manifest = JSON.parse(await fs.readFile(path.join(installRoot, 'package.json'), 'utf8'));
  const canonicalProjectRoot = await fs.realpath(projectRoot);
  const confinementMarker = Symbol('cascade-player-confinement');
  return { name: 'cascade-static-player', setup(builder) {
    builder.onResolve({ filter: /.*/ }, async args => {
      const marked = typeof args.pluginData === 'object' && args.pluginData !== null &&
        (args.pluginData as Record<PropertyKey, unknown>)[confinementMarker] === true;
      if (!marked && isFilesystemImport(args.path) && await importerIsInProject(args.importer, canonicalProjectRoot)) {
        const resolved = await builder.resolve(args.path, {
          importer: args.importer,
          resolveDir: args.resolveDir,
          kind: args.kind,
          pluginData: { [confinementMarker]: true },
        });
        if (resolved.errors.length || !resolved.path || resolved.external) return resolved;
        const canonicalTarget = await fs.realpath(resolved.path);
        if (!inside(canonicalProjectRoot, canonicalTarget)) {
          return { errors: [{
            text: `Project import escapes the project: ${args.path} resolves to ${canonicalTarget}`,
          }] };
        }
        return resolved;
      }
      if (args.path.startsWith('node:') || forbiddenModules.has(args.path)) {
        return { errors: [{ text: `Browser player cannot import Node module ${args.path}` }] };
      }
      const canonical = args.path.replace(/^@field\/cascade\//, 'cascade/').replace(/^@cascade\//, 'cascade/');
      if (!canonical.startsWith('cascade/')) return;
      const subpath = canonical.slice('cascade/'.length);
      if (!(subpath === 'io' || subpath === 'gpu' || subpath === 'contracts' || subpath.startsWith('contracts/') || subpath === 'runtime' || subpath.startsWith('runtime/'))) {
        return { errors: [{ text: `Browser player cannot import ${args.path}; server transports and configuration are not exported` }] };
      }
      if (subpath === 'runtime/node' || subpath === 'runtime/definition/extract') {
        return { errors: [{ text: `Browser player cannot import ${args.path}` }] };
      }
      const entry = manifest.exports[`./${subpath}`]?.default;
      if (!entry) return { errors: [{ text: `Unknown Cascade browser export: ${args.path}` }] };
      // During checkout development use the very same IO implementation as Studio.
      const sourceShim = path.join(installRoot, 'server', 'src', 'runtime', `${subpath}.ts`);
      return { path: (subpath === 'io' || subpath === 'gpu') && await exists(sourceShim) ? sourceShim : path.resolve(installRoot, entry) };
    });
  } };
}

function isFilesystemImport(specifier: string): boolean {
  return specifier.startsWith('.') || path.isAbsolute(specifier);
}

async function importerIsInProject(importer: string, canonicalProjectRoot: string): Promise<boolean> {
  if (!importer || !path.isAbsolute(importer)) return false;
  try {
    return inside(canonicalProjectRoot, await fs.realpath(importer));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Resolve the part that exists so a symlinked parent cannot disguise a target. */
async function canonicalFuturePath(candidate: string): Promise<string> {
  let existing = path.resolve(candidate);
  const missing: string[] = [];
  for (;;) {
    try {
      await fs.lstat(existing);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error(`Output path has no accessible parent: ${candidate}`);
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
  return path.resolve(await fs.realpath(existing), ...missing);
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function exists(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
