// Real-browser static deployment proof. No Playwright/runtime dependency and no Studio server.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cascade-player-proof-'));
const cli = process.env.CASCADE_PLAYER_CLI || fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
const chrome = process.env.CASCADE_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let browser;
let server;
let socket;
try {
  await fs.access(chrome);
  await fs.mkdir(path.join(root, 'nodes', 'Draw'), { recursive: true });
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'assets', 'tile.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#fff"/></svg>');
  await fs.writeFile(path.join(root, 'nodes', 'Draw', 'index.ts'), `
import { loadBitmap, saveImage, cachePath } from 'cascade/io';
export const definition = {
 apiVersion:1, runsOn:'browser',
 inputs:{strength:{kind:'data',type:'float',default:1}},
 props:{tone:{type:'int',default:40},frame:{type:'float',default:1,expression:'$FF'}},
 outputs:{image:{kind:'data',type:'image'}}
} as const;
export async function execute(context) {
 const canvas = new OffscreenCanvas(64,48);
 const draw = canvas.getContext('2d');
 const bitmap = await loadBitmap('assets/tile.svg');
 draw.drawImage(bitmap,0,0); bitmap.close();
 draw.fillStyle = 'rgb('+context.props.tone+','+(context.props.frame%255)+','+(context.inputs.strength*50)+')';
 draw.fillRect(8,0,56,48);
 const file = await saveImage(canvas,cachePath(context.nodeId,'.png'));
 context.outputs.image.set({path:file,size:[64,48],channels:'rgba',depth:'u8',space:'srgb'});
}`);
  await fs.writeFile(path.join(root, 'image.cascade'), JSON.stringify({ version: '0.2', nodes: [{ id: 'draw', module: 'project.Draw' }], connections: [] }));
  await fs.writeFile(path.join(root, 'scene.cascade'), JSON.stringify({ version: '0.2', nodes: [{ id: 'shape', module: 'cascade.geo.Rectangle' }], connections: [] }));
  await exec(process.execPath, [cli, 'build', path.join(root, 'image.cascade'), '--out', 'image', '--asset', 'assets/tile.svg'], { timeout: 60000 });
  await exec(process.execPath, [cli, 'build', path.join(root, 'scene.cascade'), '--out', 'scene'], { timeout: 60000 });
  const realGraph = process.env.CASCADE_PLAYER_GRAPH;
  if (realGraph) await exec(process.execPath, [cli, 'build', path.resolve(realGraph), '--out', path.join(root, 'sketch'),
    ...JSON.parse(process.env.CASCADE_PLAYER_ASSETS || '[]').flatMap(asset => ['--asset', asset])], { timeout: 60000 });
  await fs.writeFile(path.join(root, 'host.html'), `<!doctype html><html><body>
<div id="a" style="display:inline-block;width:320px;height:240px"></div>
<div id="b" style="display:inline-block;width:320px;height:240px"></div>
<div id="scene" style="width:320px;height:240px"></div>
${realGraph ? '<div id="sketch" style="width:640px;height:480px"></div>' : ''}
<script type="module">
import { mount } from './image/embed.js';
import { mount as mountScene } from './scene/embed.js';
window.ready = Promise.all([mount(document.querySelector('#a')),mount(document.querySelector('#b')),mountScene(document.querySelector('#scene'))]);
${realGraph ? "window.sketchReady = import('./sketch/embed.js').then(({mount})=>mount(document.querySelector('#sketch')));" : ''}
</script></body></html>`);

  const requests = [];
  server = http.createServer(async (request, response) => {
    requests.push(request.url);
    try {
      const url = new URL(request.url, 'http://localhost');
      if (!url.pathname.startsWith('/artwork/')) { response.writeHead(404).end(); return; }
      const relative = decodeURIComponent(url.pathname.slice('/artwork/'.length));
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      const content = await fs.readFile(file);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': mime }); response.end(content);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  browser = spawn(chrome, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(root, 'chrome')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-extensions', '--window-size=900,700', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' });
  const debugUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Chrome startup timed out: ${stderr.slice(-2000)}`)), 15000);
    browser.once('error', error => { clearTimeout(timer); reject(error); });
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(debugUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  const network = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Network.requestWillBeSent') network.push(message.params.request.url);
    if (message.id) {
      const callback = pending.get(message.id);
      if (callback) { pending.delete(message.id); message.error ? callback.reject(new Error(JSON.stringify(message.error))) : callback.resolve(message.result); }
    }
  });
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  for (const name of ['Runtime.enable', 'Page.enable', 'Network.enable']) await command(name, {}, sessionId);
  await command('Page.navigate', { url: `http://127.0.0.1:${port}/artwork/host.html` }, sessionId);
  const evaluated = await command('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async()=>{
    for(let tries=0;!window.ready && tries<200;tries++) await new Promise(resolve=>setTimeout(resolve,20));
    if(!window.ready) throw new Error('host bootstrap missing');
    const [a,b,scene] = await window.ready;
    async function pixels(player) {
      const blob=await player.downloadOutput(); const bitmap=await createImageBitmap(blob);
      const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);const draw=canvas.getContext('2d');draw.drawImage(bitmap,0,0);bitmap.close();
      const data=draw.getImageData(0,0,canvas.width,canvas.height).data;let ink=0,sum=0;
      for(let i=0;i<data.length;i+=4){if(data[i+3])ink++;sum+=data[i]+data[i+1]+data[i+2];}
      return {width:canvas.width,height:canvas.height,ink,sum,sample:[...draw.getImageData(Math.min(10,canvas.width-1),0,1,1).data]};
    }
    const initial=await pixels(b);await a.setProp('draw','tone',180);await a.seek(20);await a.setInput('draw','strength',2);
    const changed=await pixels(a),untouched=await pixels(b),geometry=await pixels(scene);
    const frames=[];const unsub=a.subscribe(event=>{if(event.type==='frame')frames.push(event.frame)});
    a.play();await new Promise(resolve=>setTimeout(resolve,220));a.pause();unsub();
    await a.dispose();const remaining=document.querySelectorAll('iframe').length;await b.seek(30);const surviving=await pixels(b);
    window.proofPlayers=[b,scene];
    let sketch;
    if(window.sketchReady) {
      const player=await window.sketchReady;
      ${process.env.CASCADE_PLAYER_OUTPUT ? `await player.selectOutput(...${JSON.stringify(process.env.CASCADE_PLAYER_OUTPUT.split(':'))});` : ''}
      const first=await pixels(player);await player.seek(20);const second=await pixels(player);
      window.proofPlayers.push(player);sketch={first,second};
    }
    return {initial,changed,untouched,geometry,frames,remaining,surviving,sketch};
  })()` }, sessionId);
  if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.exception?.description || evaluated.exceptionDetails.text);
  const proof = evaluated.result.value;
  assert.deepEqual(proof.initial, proof.untouched, 'two iframe instances must not share generated assets');
  assert.deepEqual(proof.changed.sample, [180, 20, 100, 255]);
  assert.equal(proof.changed.width, 64); assert.equal(proof.changed.height, 48);
  assert(proof.geometry.ink > 0, 'geometry preview must contain pixels');
  assert(proof.frames.length > 0, 'playback must emit frames');
  assert(proof.frames.every(frame => frame >= 20), 'playback must not step behind its starting frame');
  assert.equal(proof.remaining, realGraph ? 3 : 2); assert.equal(proof.surviving.sample[1], 30);
  if (realGraph) { assert(proof.sketch.first.ink > 0); assert(proof.sketch.second.ink > 0); }
  assert(!network.some(url => new URL(url).pathname.startsWith('/api/')), 'static player requested a Cascade API');
  assert(!requests.some(url => url.startsWith('/api/')));
  const layout = await command('Page.getLayoutMetrics', {}, sessionId);
  const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { ...layout.cssContentSize, scale: 1 } }, sessionId);
  await fs.writeFile(path.join(root, 'player.png'), Buffer.from(shot.data, 'base64'));
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ ...proof, requests }, null, 2));
  await command('Runtime.evaluate', { expression: 'Promise.all(window.proofPlayers.map(player=>player.dispose()))', awaitPromise: true }, sessionId);
  console.log(JSON.stringify({ status: 'passed', ...proof, apiRequests: 0, ...(process.env.CASCADE_KEEP_PLAYER_PROOF ? { artifacts: root } : {}) }, null, 2));
} finally {
  socket?.close();
  if (browser?.pid && browser.exitCode === null) {
    const closed = new Promise(resolve => browser.once('close', resolve));
    try { process.platform === 'win32' ? browser.kill('SIGTERM') : process.kill(-browser.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await closed;
  }
  if (server) await new Promise(resolve => server.close(resolve));
  if (!process.env.CASCADE_KEEP_PLAYER_PROOF) await fs.rm(root, { recursive: true, force: true });
  else console.log(`Player proof files: ${root}`);
}
