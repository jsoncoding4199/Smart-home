import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Minimal .env loader (no dependency). Existing process.env values win. */
export function loadDotEnv(path = resolve(process.cwd(), '.env')) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export const REGION_HOSTS = {
  cn: 'open-cn.aqara.com',
  usa: 'open-usa.aqara.com',
  eu: 'open-ger.aqara.com',
  kr: 'open-kr.aqara.com',
  ru: 'open-ru.aqara.com',
  sg: 'open-sg.aqara.com',
};

export function getConfig(env = process.env) {
  const region = (env.AQARA_REGION || 'usa').toLowerCase();
  if (!REGION_HOSTS[region]) {
    throw new Error(`Unknown AQARA_REGION "${region}". Use one of: ${Object.keys(REGION_HOSTS).join(', ')}`);
  }
  const appId = env.AQARA_APP_ID || '';
  return {
    demo: !appId || env.AQARA_DEMO === '1',
    aqara: {
      appId,
      appKey: env.AQARA_APP_KEY || '',
      keyId: env.AQARA_KEY_ID || '',
      region,
      host: REGION_HOSTS[region],
      account: env.AQARA_ACCOUNT || '',
      accessToken: env.AQARA_ACCESS_TOKEN || '',
      refreshToken: env.AQARA_REFRESH_TOKEN || '',
    },
    port: Number(env.PORT || 3000),
    host: env.HOST || '0.0.0.0',
    dashboardToken: env.DASHBOARD_TOKEN || '',
    dataDir: resolve(env.DATA_DIR || 'data'),
  };
}
