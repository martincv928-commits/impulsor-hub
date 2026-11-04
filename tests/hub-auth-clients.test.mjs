// Uses Node 24's built-in TypeScript stripping; no package installation needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import readline from 'node:readline';

const nativeFetch = globalThis.fetch;
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const browser = (hash = '', session = storage()) => {
  const local = storage();
  local.setItem('impulsor-hub-workspace-mode', 'cloud');
  local.setItem('impulsor-hub-cloud-url', 'https://obsolete.invalid');
  const window = { localStorage: local };
  const location = { hash, pathname: '/', search: '' };
  const history = { replaceState: (_state, _unused, url) => { location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } };
  return { window, location, history, sessionStorage: session, localStorage: local, URLSearchParams };
};
const py = spawnSync(process.env.PYTHON || 'python', ['-c', `
from starlette.requests import Request
from app.core.ui_bootstrap import bootstrap_html
request = Request({'type':'http','scheme':'https','path':'/','query_string':b'', 'headers':[(b'host',b'public.example')], 'client':('203.0.113.1',1234),'server':('public.example',443)})
print(bootstrap_html('<head><script type="module" src="/assets/app.js"></script></head>', request))
`], { encoding: 'utf8' });
assert.equal(py.status, 0, py.stderr);
const bootstrap = py.stdout.match(/<script>([\s\S]*?)<\/script>/)[1];
function boot(context) { vm.runInNewContext(bootstrap, context); globalThis.window = context.window; }
function moduleUrl(path, dependencies = {}) {
  let source = readFileSync(path === 'ui/src/api/workspaceMode.ts' && process.env.HUB_TEST_OLD_WORKSPACE ? process.env.HUB_TEST_OLD_WORKSPACE : new URL('../' + path, import.meta.url), 'utf8');
  source = source.replace(/^import \{[^}]*\} from "\.\/types";\n/gm, '');
  source = source.replaceAll('import.meta.env', '({})');
  for (const [name, url] of Object.entries(dependencies)) source = source.replaceAll('"' + name + '"', JSON.stringify(url));
  return 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64');
}
const workspaceUrl = moduleUrl('ui/src/api/workspaceMode.ts');
const mode = await import(workspaceUrl);
const { api } = await import(moduleUrl('ui/src/api/client.ts', { './workspaceMode': workspaceUrl }));
const agent = await import(moduleUrl('ui/src/api/agentClient.ts', { './workspaceMode': workspaceUrl }));

test('legacy injected token beats stale cloud mode even without the newer marker', async () => {
  const context = browser();
  globalThis.window = context.window;
  // This reproduces the older token-only HTML + stale cloud selection.
  window.__IMPULSOR_AGENT_TOKEN__ = 'owner-token';
  globalThis.fetch = async (_url, init) => {
    const authenticated = new Headers(init.headers).get('Authorization') === 'Bearer owner-token';
    return new Response(authenticated ? '[]' : 'Missing or malformed Authorization header', { status: authenticated ? 200 : 401 });
  };
  await api.listProjects();
  assert.equal(mode.getMode(), 'local');
  assert.equal(mode.activeToken(), 'owner-token');
  assert.equal(mode.apiBaseUrl(), '');
});

test('launch initializes before API calls, clears old config, and survives reload', async () => {
  const context = browser('#impulsor-token=owner-token');
  boot(context);
  assert.equal(context.location.hash, '');
  assert.equal(context.localStorage.getItem('impulsor-hub-cloud-url'), null);
  assert.equal(mode.getMode(), 'local');
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer owner-token');
    return new Response(JSON.stringify(url.includes('projects') ? [] : { id: 'test-project' }));
  };
  await api.listProjects();
  await agent.createTestGameProject();
  const reloaded = browser('', context.sessionStorage);
  boot(reloaded);
  await api.listProjects();
  await api.addProject('/temporary/project');
  assert.deepEqual(calls.map(c => c.url), ['/api/projects', '/api/test-game', '/api/projects', '/api/projects']);
  assert.equal(calls[1].init.method, 'POST');
});

test('all exported authenticated agent operations use the active token', async () => {
  boot(browser('#impulsor-token=current-token'));
  let count = 0;
  globalThis.fetch = async (_url, init) => {
    count++;
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer current-token');
    return new Response('{}');
  };
  for (const [name, fn] of Object.entries(agent)) {
    if (name !== 'checkAgentConnected' && name !== 'createCloudSession') await fn('test-id');
  }
  assert.equal(count, 10);
});

test('every authenticated project/task API operation carries the active token', async () => {
  boot(browser('#impulsor-token=owner-token'));
  globalThis.fetch = async (_url, init) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer owner-token');
    return new Response('{}');
  };
  for (const [name, fn] of Object.entries(api)) await fn(name === 'getEvents' ? {} : 'test-id');
});

test('public visitor receives no credentials and remote sessions retain their own origin', () => {
  const context = browser();
  boot(context);
  assert.equal(window.__IMPULSOR_AGENT_TOKEN__, undefined);
  assert.equal(mode.activeToken(), undefined);
  mode.setCloudSession('https://remote.example', 'remote-token');
  assert.equal(mode.activeToken(), 'remote-token');
  assert.equal(mode.apiBaseUrl(), 'https://remote.example');
});

test('storage denial cannot redirect an owner request to stale remote configuration', () => {
  const context = browser('#impulsor-token=owner-token');
  context.sessionStorage = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  context.localStorage.removeItem = () => { throw Error(); };
  boot(context);
  assert.equal(mode.apiBaseUrl(), '');
  assert.equal(mode.activeToken(), 'owner-token');
});

test('actual API: launch, list, create test project, reload and read created project', { skip: !process.env.HUB_TEST_BRIDGE && !process.env.HUB_TEST_BASE_URL }, async () => {
  const context = browser('#impulsor-token=' + process.env.HUB_TEST_TOKEN);
  boot(context);
  let input;
  if (process.env.HUB_TEST_BRIDGE) {
    input = readline.createInterface({ input: process.stdin });
    const iterator = input[Symbol.asyncIterator]();
    globalThis.fetch = async (url, init) => {
      process.stdout.write('__HUB_REQUEST__' + JSON.stringify({ url, method: init.method || 'GET', headers: Object.fromEntries(new Headers(init.headers)), body: init.body }) + '\n');
      const line = await iterator.next();
      const reply = JSON.parse(line.value);
      return new Response(reply.body, { status: reply.status });
    };
  } else {
    globalThis.fetch = (url, init) => nativeFetch(process.env.HUB_TEST_BASE_URL + url, init);
  }
  try {
  const before = await api.listProjects();
  const project = await agent.createTestGameProject();
  assert.ok(project.id);
  boot(browser('', context.sessionStorage));
  const after = await api.listProjects();
  assert.equal(after.length, before.length + 1);
  assert.ok(after.some(p => p.id === project.id));
  assert.equal((await api.getProject(project.id)).id, project.id);
  } finally { input?.close(); }
});
