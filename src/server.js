import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { loadDotEnv, getConfig } from './config.js';
import { AqaraClient } from './aqara/client.js';
import { TokenStore } from './aqara/tokenStore.js';
import { MockAqara } from './aqara/mock.js';
import { HomeService } from './service.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

/** Build the HTTP app. `api` can be injected (tests); otherwise chosen from config. */
export function createApp(config, { api, client } = {}) {
  if (!api) {
    if (config.demo) {
      api = new MockAqara();
    } else {
      const a = config.aqara;
      const tokenStore = new TokenStore(config.dataDir, { accessToken: a.accessToken, refreshToken: a.refreshToken });
      client = new AqaraClient({ ...a, tokenStore });
      api = client;
    }
  }
  const home = new HomeService(api);

  const routes = [
    ['GET', /^\/api\/status$/, async () => ({
      mode: config.demo ? 'demo' : 'aqara',
      region: config.demo ? null : config.aqara.region,
      loggedIn: config.demo || Boolean(client?.tokenStore?.get().accessToken),
      account: config.demo ? 'demo@example.com' : config.aqara.account || null,
    })],
    ['GET', /^\/api\/overview$/, () => home.overview()],
    ['GET', /^\/api\/rooms$/, () => home.rooms()],
    ['GET', /^\/api\/devices$/, () => home.devices()],
    ['GET', /^\/api\/devices\/([^/]+)$/, (_, [id]) => home.device(id)],
    ['POST', /^\/api\/devices\/([^/]+)$/, (body, [id]) => home.control(id, body)],
    ['GET', /^\/api\/scenes$/, () => home.scenes()],
    ['POST', /^\/api\/scenes\/([^/]+)\/run$/, async (_, [id]) => { await home.runScene(id); return { ok: true }; }],
    ['GET', /^\/api\/automations$/, () => home.automations()],
    ['POST', /^\/api\/automations\/([^/]+)$/, async (body, [id]) => {
      if (typeof body.enabled !== 'boolean') throw badRequest('"enabled" must be true or false');
      await home.setAutomation(id, body.enabled);
      return { ok: true };
    }],
    ['POST', /^\/api\/auth\/code$/, async (body) => {
      requireClient(client);
      const account = body.account || config.aqara.account;
      if (!account) throw badRequest('account is required');
      await client.requestAuthCode(account);
      return { ok: true, account };
    }],
    ['POST', /^\/api\/auth\/token$/, async (body) => {
      requireClient(client);
      const account = body.account || config.aqara.account;
      if (!account || !body.code) throw badRequest('account and code are required');
      await client.exchangeAuthCode(account, String(body.code));
      return { ok: true };
    }],
    ['POST', /^\/api\/auth\/logout$/, async () => { requireClient(client); client.tokenStore.clear(); return { ok: true }; }],
  ];

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) return await serveStatic(url.pathname, res);
      if (config.dashboardToken && !authorized(req, config.dashboardToken)) return send(res, 401, { error: 'Unauthorized' });

      const match = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!match) return send(res, 404, { error: 'Not found' });
      const params = url.pathname.match(match[1]).slice(1).map(decodeURIComponent);
      const body = req.method === 'POST' ? await readJson(req) : {};
      send(res, 200, (await match[2](body, params)) ?? { ok: true });
    } catch (err) {
      const status = err.status || (err.code === 401 ? 401 : err.code !== undefined ? 502 : 500);
      if (status >= 500) console.error(err);
      send(res, status, { error: err.message, code: err.code });
    }
  });
}

function requireClient(client) {
  if (!client) throw Object.assign(new Error('Login is not needed in demo mode'), { status: 400 });
}

const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

function authorized(req, token) {
  const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e5) throw Object.assign(new Error('Body too large'), { status: 413 });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw badRequest('Invalid JSON body'); }
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function serveStatic(pathname, res) {
  const rel = normalize(pathname === '/' ? 'index.html' : pathname.slice(1));
  if (rel.startsWith('..')) return send(res, 400, { error: 'Bad path' });
  try {
    const file = await readFile(join(PUBLIC_DIR, rel));
    res.writeHead(200, { 'Content-Type': MIME[extname(rel)] || 'application/octet-stream' });
    res.end(file);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  loadDotEnv();
  const config = getConfig();
  createApp(config).listen(config.port, config.host, () => {
    console.log(`Aqara Smart Home running at http://localhost:${config.port} (${config.demo ? 'demo mode' : `Aqara ${config.aqara.region}`})`);
  });
}
