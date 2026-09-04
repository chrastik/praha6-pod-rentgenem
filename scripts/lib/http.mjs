// Síťová vrstva: retry, rozumný User-Agent, detekce kódování, volitelná disková cache.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const UA = 'praha6-pod-rentgenem/0.1 (+https://github.com/; verejna data MC Praha 6)';
const CACHE_DIR = path.resolve('.cache/http');

export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} — ${url}`);
    this.status = status; this.url = url; this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stáhne URL jako text. Řeší windows-1250 (starší stránky Prahy 6 i MARBES),
 * exponenciální retry a volitelnou cache na disku (pro lokální vývoj).
 */
export async function fetchText(url, opts = {}) {
  const {
    retries = 4, timeoutMs = 45_000, cache = process.env.HTTP_CACHE === '1',
    headers = {}, method = 'GET', body,
  } = opts;

  const key = createHash('sha1').update(method + url + (body ?? '')).digest('hex');
  const cacheFile = path.join(CACHE_DIR, `${key}.txt`);
  if (cache) {
    try { return await readFile(cacheFile, 'utf8'); } catch { /* miss */ }
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(Math.min(2 ** attempt * 500, 15_000));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method, body, signal: ctrl.signal,
        headers: { 'user-agent': UA, 'accept-language': 'cs,en;q=0.6', ...headers },
      });
      if (res.status >= 500 || res.status === 429) {
        lastErr = new HttpError(res.status, url, '');
        continue; // retry
      }
      if (!res.ok) throw new HttpError(res.status, url, (await res.text()).slice(0, 500));

      const buf = Buffer.from(await res.arrayBuffer());
      const text = decode(buf, res.headers.get('content-type') || '');
      if (cache) {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(cacheFile, text, 'utf8');
      }
      return text;
    } catch (err) {
      lastErr = err;
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error(`Nepodařilo se stáhnout ${url}`);
}

export async function fetchJson(url, opts = {}) {
  return JSON.parse(await fetchText(url, { headers: { accept: 'application/json' }, ...opts }));
}

/** Detekce kódování: hlavička → <meta charset> → heuristika na české znaky. */
function decode(buf, contentType) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const head = buf.subarray(0, 2048).toString('latin1');
  const fromMeta = /charset=["']?([\w-]+)/i.exec(head)?.[1];
  const enc = (fromHeader || fromMeta || 'utf-8').toLowerCase();
  const label = enc === 'windows-1250' || enc === 'cp1250' ? 'windows-1250' : enc;
  try {
    const text = new TextDecoder(label, { fatal: false }).decode(buf);
    // Náhradní znaky = špatné kódování; zkus windows-1250.
    if (label.startsWith('utf') && text.includes('�')) {
      return new TextDecoder('windows-1250').decode(buf);
    }
    return text;
  } catch {
    return buf.toString('utf8');
  }
}

/** Omezená paralelita — radnice nemá být zahlcena. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
