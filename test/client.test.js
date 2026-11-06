import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sign, AqaraClient } from '../src/aqara/client.js';
import { TokenStore } from '../src/aqara/tokenStore.js';

test('sign matches the Aqara v3 algorithm', () => {
  const p = { accessToken: 'TOK', appId: 'APP', keyId: 'K1', nonce: 'n0', time: '1700000000000', appKey: 'SeCrEt' };
  const expected = createHash('md5')
    .update('accesstoken=tok&appid=app&keyid=k1&nonce=n0&time=1700000000000secret').digest('hex');
  assert.equal(sign(p), expected);
  // Without a token the Accesstoken pair is omitted.
  const noTok = createHash('md5').update('appid=app&keyid=k1&nonce=n0&time=1700000000000secret').digest('hex');
  assert.equal(sign({ ...p, accessToken: '' }), noTok);
});

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    const r = responses.shift();
    return { ok: true, status: 200, json: async () => r };
  };
  fn.calls = calls;
  return fn;
}

const base = { appId: 'APP', appKey: 'KEY', keyId: 'K1', host: 'open-usa.aqara.com' };

test('call sends signed request and returns result', async () => {
  const fetchImpl = fakeFetch([{ code: 0, result: { data: [] } }]);
  const c = new AqaraClient({ ...base, fetchImpl, tokenStore: new TokenStore(null, { accessToken: 'AT' }) });
  assert.deepEqual(await c.call('query.device.info', { pageNum: 1 }), { data: [] });
  const [req] = fetchImpl.calls;
  assert.equal(req.url, 'https://open-usa.aqara.com/v3.0/open/api');
  assert.equal(req.body.intent, 'query.device.info');
  assert.equal(req.headers.Accesstoken, 'AT');
  assert.equal(req.headers.Sign, sign({ accessToken: 'AT', appId: 'APP', keyId: 'K1', nonce: req.headers.Nonce, time: req.headers.Time, appKey: 'KEY' }));
});

test('expired token triggers a refresh and one retry', async () => {
  const fetchImpl = fakeFetch([
    { code: 108, message: 'token expired' },
    { code: 0, result: { accessToken: 'NEW', refreshToken: 'R2', expiresIn: '3600' } },
    { code: 0, result: 'ok' },
  ]);
  const store = new TokenStore(null, { accessToken: 'OLD', refreshToken: 'R1' });
  const c = new AqaraClient({ ...base, fetchImpl, tokenStore: store });
  assert.equal(await c.call('query.position.info'), 'ok');
  assert.equal(fetchImpl.calls[1].body.intent, 'config.auth.refreshToken');
  assert.equal(fetchImpl.calls[1].headers.Accesstoken, undefined);
  assert.equal(fetchImpl.calls[2].headers.Accesstoken, 'NEW');
  assert.equal(store.get().refreshToken, 'R2');
});

test('API errors surface code and message', async () => {
  const c = new AqaraClient({ ...base, fetchImpl: fakeFetch([{ code: 302, message: 'Missing parameter' }]), tokenStore: new TokenStore(null, { accessToken: 'AT' }) });
  await assert.rejects(c.call('query.device.info'), { code: 302 });
});

test('no token -> 401 without hitting the network', async () => {
  const fetchImpl = fakeFetch([]);
  const c = new AqaraClient({ ...base, fetchImpl, tokenStore: new TokenStore(null) });
  await assert.rejects(c.call('query.device.info'), { code: 401 });
  assert.equal(fetchImpl.calls.length, 0);
});
