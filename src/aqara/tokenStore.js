import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Persists Aqara tokens to <dataDir>/tokens.json (mode 600). */
export class TokenStore {
  constructor(dataDir, initial = {}) {
    this.file = dataDir ? join(dataDir, 'tokens.json') : null;
    this.tokens = {};
    if (this.file && existsSync(this.file)) {
      try { this.tokens = JSON.parse(readFileSync(this.file, 'utf8')); } catch { /* ignore corrupt file */ }
    }
    // Explicit env tokens override whatever is on disk.
    for (const [k, v] of Object.entries(initial)) if (v) this.tokens[k] = v;
  }

  get() { return { ...this.tokens }; }

  set(tokens) {
    this.tokens = { ...this.tokens, ...tokens };
    if (!this.file) return;
    mkdirSync(join(this.file, '..'), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
  }

  clear() {
    this.tokens = {};
    if (this.file && existsSync(this.file)) writeFileSync(this.file, '{}', { mode: 0o600 });
  }
}
