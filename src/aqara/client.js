import { createHash, randomBytes } from 'node:crypto';

/**
 * Aqara Open API v3 signature.
 * sign = md5(lowercase("Accesstoken=..&Appid=..&Keyid=..&Nonce=..&Time=.." + appKey))
 * The Accesstoken part is omitted when no token is sent (e.g. auth intents).
 */
export function sign({ accessToken, appId, keyId, nonce, time, appKey }) {
  let s = accessToken ? `Accesstoken=${accessToken}&` : '';
  s += `Appid=${appId}&Keyid=${keyId}&Nonce=${nonce}&Time=${time}`;
  return createHash('md5').update((s + appKey).toLowerCase()).digest('hex');
}

export class AqaraApiError extends Error {
  constructor(code, message, detail) {
    super(`Aqara API error ${code}: ${message}${detail ? ` (${detail})` : ''}`);
    this.code = code;
    this.detail = detail;
  }
}

const TOKEN_ERRORS = new Set([108, 2010]); // token expired / invalid
const NO_TOKEN_INTENTS = new Set(['config.auth.getAuthCode', 'config.auth.getToken', 'config.auth.refreshToken']);

/**
 * Thin client over POST https://<host>/v3.0/open/api.
 * Holds tokens via a TokenStore and refreshes once on token errors.
 */
export class AqaraClient {
  constructor({ appId, appKey, keyId, host, tokenStore, fetchImpl = globalThis.fetch, lang = 'en' }) {
    if (!appId || !appKey || !keyId) throw new Error('AQARA_APP_ID, AQARA_APP_KEY and AQARA_KEY_ID are required');
    Object.assign(this, { appId, appKey, keyId, host, tokenStore, fetchImpl, lang });
  }

  headers(accessToken) {
    const nonce = randomBytes(8).toString('hex');
    const time = String(Date.now());
    const h = {
      'Content-Type': 'application/json',
      Appid: this.appId,
      Keyid: this.keyId,
      Nonce: nonce,
      Time: time,
      Lang: this.lang,
      Sign: sign({ accessToken, appId: this.appId, keyId: this.keyId, nonce, time, appKey: this.appKey }),
    };
    if (accessToken) h.Accesstoken = accessToken;
    return h;
  }

  async call(intent, data = {}, { retry = true } = {}) {
    const accessToken = NO_TOKEN_INTENTS.has(intent) ? '' : this.tokenStore?.get().accessToken || '';
    if (!accessToken && !NO_TOKEN_INTENTS.has(intent)) {
      throw new AqaraApiError(401, 'Not logged in to Aqara', 'use the Login panel or set AQARA_ACCESS_TOKEN');
    }
    const res = await this.fetchImpl(`https://${this.host}/v3.0/open/api`, {
      method: 'POST',
      headers: this.headers(accessToken),
      body: JSON.stringify({ intent, data }),
    });
    if (!res.ok) throw new AqaraApiError(res.status, `HTTP ${res.status}`);
    const body = await res.json();
    if (body.code === 0) return body.result;

    if (retry && TOKEN_ERRORS.has(body.code) && this.tokenStore?.get().refreshToken) {
      await this.refresh();
      return this.call(intent, data, { retry: false });
    }
    throw new AqaraApiError(body.code, body.message || 'unknown', body.msgDetails);
  }

  /** Step 1 of login: Aqara sends a verification code to the account (app/SMS/email). */
  requestAuthCode(account, accessTokenValidity = '30d') {
    return this.call('config.auth.getAuthCode', { account, accountType: 0, accessTokenValidity });
  }

  /** Step 2 of login: exchange the code for tokens. */
  async exchangeAuthCode(account, authCode) {
    const r = await this.call('config.auth.getToken', { authCode, account, accountType: 0 });
    this.tokenStore.set(normalizeTokens(r));
    return this.tokenStore.get();
  }

  async refresh() {
    const { refreshToken } = this.tokenStore.get();
    const r = await this.call('config.auth.refreshToken', { refreshToken });
    this.tokenStore.set(normalizeTokens(r));
    return this.tokenStore.get();
  }
}

function normalizeTokens(r) {
  return {
    accessToken: r.accessToken,
    refreshToken: r.refreshToken,
    openId: r.openId,
    expiresAt: r.expiresIn ? Date.now() + Number(r.expiresIn) * 1000 : undefined,
  };
}
