import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { getConfig } from '../src/config.js';

let server, url;
const start = (env) => new Promise((resolve) => {
  const s = createApp(getConfig({ ...env, DATA_DIR: '' })).listen(0, '127.0.0.1', () => resolve(s));
});

before(async () => { server = await start({}); url = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

const req = (path, body, headers = {}) => fetch(url + path, {
  method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body),
});

test('status reports demo mode', async () => {
  const r = await (await req('/api/status')).json();
  assert.equal(r.mode, 'demo');
  assert.equal(r.loggedIn, true);
});

test('overview + device control + scene run', async () => {
  const o = await (await req('/api/overview')).json();
  assert.ok(o.devices.length > 5);
  const r = await req('/api/devices/lumi.light02', { on: true, brightness: 55 });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).state, { on: true, brightness: 55 });
  assert.equal((await req('/api/scenes/scene.movie/run', {})).status, 200);
});

test('bad input returns 400/404', async () => {
  assert.equal((await req('/api/devices/lumi.ht01', { on: true })).status, 400);
  assert.equal((await req('/api/devices/missing')).status, 404);
  assert.equal((await req('/api/automations/auto.hall', { enabled: 'yes' })).status, 400);
  assert.equal((await req('/api/nope')).status, 404);
});

test('serves the dashboard and blocks path traversal', async () => {
  const r = await req('/');
  assert.match(await r.text(), /Aqara Home/);
  assert.notEqual((await req('/../package.json')).status, 200);
});

test('dashboard token is enforced when set', async () => {
  const s = await start({ DASHBOARD_TOKEN: 'secret' });
  const u = `http://127.0.0.1:${s.address().port}/api/status`;
  assert.equal((await fetch(u)).status, 401);
  assert.equal((await fetch(u, { headers: { Authorization: 'Bearer secret' } })).status, 200);
  s.close();
});

test('real mode without a token asks for login', async () => {
  const s = await start({ AQARA_APP_ID: 'a', AQARA_APP_KEY: 'b', AQARA_KEY_ID: 'c' });
  const u = `http://127.0.0.1:${s.address().port}`;
  assert.equal((await (await fetch(`${u}/api/status`)).json()).loggedIn, false);
  assert.equal((await fetch(`${u}/api/overview`)).status, 401);
  s.close();
});
