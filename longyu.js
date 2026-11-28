#!/usr/bin/env node
/**
 * longyu.js — CLI LONGYU MINE (mine.longyu.network)
 * author 19Seniman
 *
 * Login situs: X (Twitter) OAuth. Untuk script: Bearer accessToken dari localStorage
 * `longyu.tokens` (lihat README), lalu semua request /v1/* pakai header itu.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { keccak256, encodeFunctionData, decodeAbiParameters, numberToHex } from 'viem';

const VERSION = '1.1.4';
const QUIET = process.argv.includes('--quiet') || process.argv.includes('-q');
const NO_COLOR = !!process.env.NO_COLOR || !process.stdout.isTTY;
const C = (code) => (s) => (NO_COLOR ? String(s) : `\u001b[${code}m${s}\u001b[0m`);
const dim = C('2'), bold = C('1'), cyan = C('36'), green = C('32'), yellow = C('33'), red = C('31');

// ─────────────────────────────────────── banner ───────────────────────────────────────
function banner() {
  if (QUIET || !process.stdout.isTTY) return;
  const w = 46;
  const line = (l, r) => dim(l + '─'.repeat(w) + r);
  const row = (a, b) => dim('│') + ' ' + bold(a.padEnd(9)) + ' ' + b.padEnd(w - 11) + dim('│');
  console.log('');
  console.log(line('┌', '┐'));
  console.log(dim('│') + ' ' + cyan(bold('L O N G Y U   M I N E')) + dim('  companion'.padEnd(w - 18)) + dim('│'));
  console.log(row('project', 'Longyu · mine.longyu.network'));
  console.log(row('author', '19Seniman'));
  console.log(row('build', `v${VERSION}`));
  console.log(line('└', '┘'));
  console.log('');
}

// ─────────────────────────────────────── config ───────────────────────────────────────
const ENV = {
  ACCESS_TOKEN: (process.env.ACCESS_TOKEN || '').trim(),
  REFRESH_TOKEN: (process.env.REFRESH_TOKEN || '').trim(),
  API_URL: (process.env.API_URL || 'https://api.longyu.network').replace(/\/+$/, ''),
  L2_RPC: process.env.L2_RPC || 'https://rpc.longyu.network',
  L1_RPC: process.env.L1_RPC || 'https://bsc-rpc.publicnode.com',
  OUTPUT_ORACLE: process.env.OUTPUT_ORACLE || '0x77fF9CDD8B92869D428956695dE0e2d94a75aDC8',
  CHAIN_CHECK_MS: Number(process.env.CHAIN_CHECK_MS || 300_000),
  POLL_SECONDS: Number(process.env.POLL_SECONDS || 60),
  MAX_ROUNDS: Number(process.env.MAX_ROUNDS || 0),
  HUMAN_MIN_MS: Number(process.env.HUMAN_MIN_MS || 700),
  HUMAN_MAX_MS: Number(process.env.HUMAN_MAX_MS || 1800),
  NO_PACING: process.env.NO_PACING === '1',
  MAX_RETRY: Number(process.env.MAX_RETRY || 3),
  TURNSTILE: (process.env.TURNSTILE_TOKEN || '').trim(),
  WALLET_ADDRESS: (process.env.WALLET_ADDRESS || '').trim(),
  AUTO_TASKS: (process.env.AUTO_TASKS ?? '1') !== '0',
  TASKS_INTERVAL_MIN: Number(process.env.TASKS_INTERVAL_MIN || 30),
  MIN_CLAIM: Number(process.env.MIN_CLAIM ?? 1),
  CLAIM_EVERY_MIN: Number(process.env.CLAIM_EVERY_MIN ?? 360),
  TOKENS_FILE: process.env.TOKENS_FILE || '.tokens.json',
  CLAIM_STATE_FILE: process.env.CLAIM_STATE_FILE || '.claim-state.json',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ─────────────────────────────────────── util ───────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
async function pace() {
  if (!ENV.NO_PACING) await sleep(rand(ENV.HUMAN_MIN_MS, ENV.HUMAN_MAX_MS));
}
const strLen = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, '').length;

function table(headers, rows, aligns = []) {
  if (!rows.length) return '';
  const widths = headers.map((h, i) => Math.max(strLen(h), ...rows.map((r) => strLen(r[i] ?? ''))));
  const pad = (s, i) => (aligns[i] === 'r' ? String(s).padStart(widths[i]) : String(s).padEnd(widths[i]));
  const line = (cells) => '│ ' + cells.map((c, i) => pad(c, i)).join(' │ ') + ' │';
  const top = '┌' + widths.map((w) => '─'.repeat(w + 2)).join('┬') + '┐';
  const mid = '├' + widths.map((w) => '─'.repeat(w + 2)).join('┼') + '┤';
  const bot = '└' + widths.map((w) => '─'.repeat(w + 2)).join('┴') + '┘';
  const out = [dim(top), line(headers.map((h) => bold(h))), dim(mid), ...rows.map((r) => line(r)), dim(bot)];
  return out.map((l) => (NO_COLOR ? l.replace(/\u001b\[[0-9;]*m/g, '') : l)).join('\n');
}

function flat(v, depth = 0) {
  if (v === null) return 'null';
  if (v === undefined) return '-';
  if (Array.isArray(v)) return v.length ? `[${v.length} item]` : '[]';
  if (typeof v === 'object') return depth > 0 ? JSON.stringify(v) : Object.keys(v).length + ' field';
  return String(v);
}

/** Render data apa pun: objek -> key/value, array objek -> tabel. */
function render(data, title) {
  if (title) console.log(bold(title));
  if (data === null || data === undefined) return console.log(dim('(kosong)'));
  if (Array.isArray(data)) {
    const objs = data.filter((x) => x && typeof x === 'object');
    if (!objs.length) return console.log(data.length ? data.join('\n') : dim('(kosong)'));
    const keys = [...new Set(objs.slice(0, 20).flatMap((o) => Object.keys(o)))].slice(0, 8);
    console.log(table(keys.map((k) => k.toUpperCase()), objs.map((o) => keys.map((k) => flat(o[k])))));
    if (data.length > objs.length) console.log(dim(`… ${data.length - objs.length} item lain`));
    return;
  }
  if (typeof data === 'object') {
    const rows = Object.entries(data).map(([k, v]) => [k, flat(v, 1).slice(0, 70)]);
    console.log(table(['FIELD', 'VALUE'], rows));
    return;
  }
  console.log(String(data));
}

const ok = (m) => console.log(`${green('✔')} ${m}`);
const warn = (m) => console.log(`${yellow('!')} ${m}`);
const fail = (m) => console.error(`${red('✖')} ${m}`);

// ─────────────────────────────────────── token store ───────────────────────────────────────
const BASE_DIR = path.dirname(fileURLToPath(import.meta.url));
const tokenPath = path.isAbsolute(ENV.TOKENS_FILE) ? ENV.TOKENS_FILE : path.join(BASE_DIR, ENV.TOKENS_FILE);

const AUTH = { accessToken: '', refreshToken: '' };

function loadSaved() {
  try {
    return JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  } catch {
    return null;
  }
}
function saveSaved(obj) {
  fs.writeFileSync(tokenPath, JSON.stringify(obj, null, 2), { mode: 0o600 });
  try { fs.chmodSync(tokenPath, 0o600); } catch {}
}
function initAuth() {
  const saved = loadSaved();
  AUTH.accessToken = ENV.ACCESS_TOKEN || saved?.accessToken || '';
  AUTH.refreshToken = ENV.REFRESH_TOKEN || saved?.refreshToken || '';
}
function persistTokens(json) {
  if (!json?.accessToken) return;
  AUTH.accessToken = json.accessToken;
  if (json.refreshToken) AUTH.refreshToken = json.refreshToken;
  saveSaved({ accessToken: AUTH.accessToken, refreshToken: AUTH.refreshToken, savedAt: new Date().toISOString() });
}

// ─────────────────────────────────────── API ───────────────────────────────────────
class ApiError extends Error {
  constructor(message, code, status, body) {
    super(message);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

let refreshing = null;

async function refreshTokens() {
  if (!AUTH.refreshToken) return false;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const res = await fetch(`${ENV.API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ refreshToken: AUTH.refreshToken }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.accessToken) return false;
    persistTokens(json);
    return true;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

async function apiOnce(method, p, body, { auth = true, retried = false } = {}) {
  await pace();
  const headers = { accept: 'application/json', 'user-agent': UA, origin: 'https://mine.longyu.network', referer: 'https://mine.longyu.network/' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && AUTH.accessToken) headers.authorization = `Bearer ${AUTH.accessToken}`;

  let res;
  try {
    res = await fetch(`${ENV.API_URL}${p}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(`gagal menghubungi API: ${e.message}`, 'NETWORK', 0);
  }
  const json = await res.json().catch(() => null);

  const tokenError = res.status === 401 || /invalid_token|unauthorized/i.test(String(json?.error || json?.code || ''));
  if (tokenError && auth && !retried && AUTH.refreshToken) {
    if (await refreshTokens()) return apiOnce(method, p, body, { auth, retried: true });
  }
  if (!res.ok) {
    const code = json?.error || json?.code || `HTTP_${res.status}`;
    const msg = json?.message || json?.error || `${res.status}`;
    if (res.status === 429 || /rate limit|too many requests|retry in/i.test(`${code} ${msg}`)) {
      throw new RateLimitError(msg, parseRetryMinutes(msg));
    }
    throw new ApiError(msg, String(code).toUpperCase(), res.status, json);
  }
  return json ?? {};
}

async function api(method, p, body, opts = {}) {
  const maxAttempts = Math.max(1, ENV.MAX_RETRY + 1);
  let last;
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      return await apiOnce(method, p, body, opts);
    } catch (e) {
      last = e;
      const retryable = e.code === 'NETWORK' || (e.status >= 500 && e.status !== 429);
      if (e.code === 'RATE_LIMIT' || !retryable || i === maxAttempts) throw e;
      const wait = Math.min(15000, 800 * 2 ** (i - 1)) + rand(0, 400);
      if (process.env.DEBUG) console.error(dim(`  retry ${i}/${maxAttempts - 1} · ${e.code || e.status} · ${wait}ms`));
      await sleep(wait);
    }
  }
  throw last;
}

const get = (p) => api('GET', p);
const post = (p, b) => api('POST', p, b ?? {});

// ─────────────────────────────── proof-of-work (sama seperti situs) ───────────────────────────────
/** Jumlah bit nol di depan. */
function zeroBits(buf) {
  let n = 0;
  for (const byte of buf) {
    if (byte !== 0) {
      let b = byte;
      let c = 0;
      while ((b & 0x80) === 0) { b <<= 1; c += 1; }
      return n + c;
    }
    n += 8;
  }
  return n;
}

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest();

/** Cari counter sehingga sha256("nonce:counter") punya >= bits bit nol. */
async function solvePuzzle(nonce, bits, onProgress) {
  const t0 = Date.now();
  for (let i = 0; ; i += 1) {
    if (zeroBits(sha256(`${nonce}:${i}`)) >= bits) {
      if (onProgress) onProgress(i, Date.now() - t0);
      return String(i);
    }
    if (i > 0 && i % 4000 === 0) {
      if (onProgress) onProgress(i, Date.now() - t0);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}

// ─────────────────────────────── verifikasi state L2 (chain check) ───────────────────────────────
const MESSAGE_PASSER = '0x4200000000000000000000000000000000000016';
const ORACLE_ABI = [
  { inputs: [], name: 'latestOutputIndex', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  {
    inputs: [{ type: 'uint256' }],
    name: 'getL2Output',
    outputs: [
      {
        components: [
          { name: 'outputRoot', type: 'bytes32' },
          { name: 'timestamp', type: 'uint128' },
          { name: 'l2BlockNumber', type: 'uint128' },
        ],
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

/** Endpoint L1 cadangan — kalau satu kena rate limit, pindah ke berikutnya. */
const L1_POOL = [
  ENV.L1_RPC,
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed1.ninicoin.io',
  'https://binance.llamarpc.com',
].filter((v, i, a) => v && a.indexOf(v) === i);

class RateLimitError extends Error {
  constructor(message, minutes) {
    super(message);
    this.code = 'RATE_LIMIT';
    this.minutes = minutes;
  }
}

/** "Rate limit exceeded, retry in 22 minutes" -> 22 */
function parseRetryMinutes(msg) {
  const m = /retry in\s+(\d+)\s*min/i.exec(String(msg || ''));
  return m ? Number(m[1]) : 5;
}

async function rpcCallPool(pool, method, params = []) {
  let lastErr;
  for (const url of pool) {
    try {
      return await rpcCall(url, method, params);
    } catch (e) {
      lastErr = e;
      if (/rate limit|too many requests|429/i.test(e.message)) continue;
      throw e;
    }
  }
  throw lastErr;
}

async function rpcCall(url, method, params = []) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    const json = await res.json();
    if (json.error || json.result === undefined) {
      const msg = json.error?.message || `${method} gagal`;
      if (/rate limit|too many requests/i.test(msg)) throw new RateLimitError(msg, parseRetryMinutes(msg));
      throw new Error(msg);
    }
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

/** Ambil bagian state L2 + bandingkan dengan output root di L1 (OutputOracle di BSC). */
let chainCache = null; // { at, index, result }

async function checkChain(index, { maxAgeMs = 45_000 } = {}) {
  if (index === undefined && chainCache && Date.now() - chainCache.at < maxAgeMs) return chainCache.result;

  let idx = index;
  if (idx === undefined) {
    const data = encodeFunctionData({ abi: ORACLE_ABI, functionName: 'latestOutputIndex' });
    const raw = await rpcCallPool(L1_POOL, 'eth_call', [{ to: ENV.OUTPUT_ORACLE, data }, 'latest']);
    idx = BigInt(raw);
    if (chainCache && chainCache.index === String(idx) && Date.now() - chainCache.at < 180_000) {
      chainCache.at = Date.now();
      return chainCache.result;
    }
  }
  const data = encodeFunctionData({ abi: ORACLE_ABI, functionName: 'getL2Output', args: [idx] });
  const rawOut = await rpcCallPool(L1_POOL, 'eth_call', [{ to: ENV.OUTPUT_ORACLE, data }, 'latest']);
  const [out] = decodeAbiParameters(
    [{ type: 'tuple', components: [
      { type: 'bytes32', name: 'outputRoot' },
      { type: 'uint128', name: 'timestamp' },
      { type: 'uint128', name: 'l2BlockNumber' },
    ] }],
    rawOut,
  );

  const blockHex = numberToHex(out.l2BlockNumber);
  const [block, proof] = await Promise.all([
    rpcCall(ENV.L2_RPC, 'eth_getBlockByNumber', [blockHex, false]),
    rpcCall(ENV.L2_RPC, 'eth_getProof', [MESSAGE_PASSER, [], blockHex]),
  ]);
  if (!block?.stateRoot || !block?.hash || !proof?.storageHash) {
    throw new Error('L2 mengembalikan blok tidak lengkap');
  }
  const parts = {
    stateRoot: block.stateRoot,
    messagePasserRoot: proof.storageHash,
    blockHash: block.hash,
  };
  const root = keccak256(
    `0x${'00'.repeat(32)}${parts.stateRoot.slice(2)}${parts.messagePasserRoot.slice(2)}${parts.blockHash.slice(2)}`,
  );
  const result = {
    index: String(idx),
    l2Block: String(out.l2BlockNumber),
    parts,
    match: root.toLowerCase() === out.outputRoot.toLowerCase(),
  };
  chainCache = { at: Date.now(), index: String(idx), result };
  return result;
}

// ─────────────────────────────── device attestation ───────────────────────────────
function turnstileToken() {
  if (ENV.TURNSTILE) return ENV.TURNSTILE;
  const i = process.argv.indexOf('--turnstile');
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return '';
}

async function attestDevice() {
  let ch = await post('/v1/device/challenge');
  let token = 'skipped';
  if (ch.humanCheck !== false) {
    const t = turnstileToken();
    if (!t) {
      throw new ApiError(
        'server minta human check (Cloudflare Turnstile). Buka situs, selesaikan challenge, lalu jalankan ulang dengan --turnstile <token>',
        'HUMAN_CHECK',
        403,
      );
    }
    token = t;
    ch = await post('/v1/device/challenge');
  }
  const res = await post('/v1/device/attest', { challengeId: ch.challengeId, token });
  if (!res.attested) throw new ApiError('device tidak lolos attestation', 'ATTEST_FAILED', 403);
  ok('device ter-attest');
  return res;
}

// ─────────────────────────────── alur mining ───────────────────────────────
async function miningStatus() {
  return get('/v1/mining/status');
}

function renderMining(st) {
  const s = st.session;
  const rows = [];
  if (s) {
    rows.push(['sesi', s.endsAt ? `aktif → ${new Date(Number(s.endsAt) * 1000).toISOString().replace('T', ' ').slice(0, 19)}Z` : 'aktif']);
    if (s.startedAt && s.endsAt) {
      const total = Number(s.endsAt) - Number(s.startedAt);
      const left = Math.max(0, Number(s.endsAt) - Math.floor(Date.now() / 1000));
      rows.push(['sisa', total > 0 ? `${Math.round((left / total) * 100)}% · ${Math.floor(left / 60)}m` : '-']);
    }
  }
  if (st.canStart !== undefined) rows.push(['bisa mulai', st.canStart ? green('ya') : dim('tidak')]);
  if (st.estimatedPerHour !== undefined) rows.push(['estimasi/jam', fmtMaybeE18(st.estimatedPerHour)]);
  if (st.rate !== undefined) rows.push(['rate', String(st.rate)]);
  if (st.power !== undefined) rows.push(['power', String(st.power)]);
  if (st.streak !== undefined) rows.push(['streak', String(st.streak)]);
  if (st.miningDay !== undefined) rows.push(['hari ke-', String(st.miningDay)]);
  for (const k of ['claimable', 'pending', 'mined', 'earned', 'rewards']) {
    if (st[k] !== undefined && st[k] !== null) rows.push([k, flat(st[k], 1).slice(0, 60)]);
  }
  if (st.epoch) rows.push(['epoch', flat(st.epoch, 1).slice(0, 60)]);

  if (rows.length) console.log(table(['FIELD', 'NILAI'], rows));
  else render(st);
  return rows.length > 0;
}

async function startMining({ autoAttest = true } = {}) {
  let ch;
  try {
    ch = await post('/v1/mining/challenge');
  } catch (e) {
    if (e.code === 'DEVICE_NOT_ATTESTED' && autoAttest) {
      warn('device belum ter-attest, memproses attestation…');
      await attestDevice();
      return startMining({ autoAttest: false });
    }
    throw e;
  }

  // `work` di API bukan angka: bentuknya objek { counter, parts } (lihat bundle mine.js)
  let counter;
  let parts;

  if (ch.work && Number(ch.work.bits) > 0) {
    process.stdout.write(`${dim('PoW')} ${ch.work.bits} bit`);
    counter = await solvePuzzle(ch.nonce, Number(ch.work.bits), (i, ms) => {
      if (!QUIET && process.stdout.isTTY) process.stdout.write(`\r${dim('PoW')} ${ch.work.bits} bit · ${i} hash · ${(i / (ms / 1000) / 1000).toFixed(0)}k/s   `);
    });
    if (!QUIET && process.stdout.isTTY) process.stdout.write('\n');
    ok(`PoW selesai · counter ${counter}`);
  }

  if (ch.work?.output?.index !== undefined && ch.work?.output?.index !== null) {
    const chain = await checkChain(BigInt(ch.work.output.index)).catch((e) => {
      warn(`chain check gagal: ${e.message}`);
      return null;
    });
    if (chain) {
      parts = chain.parts;
      if (!chain.match) warn(`output root tidak cocok (index ${chain.index})`);
    }
  }

  const body = { challengeId: ch.challengeId };
  if (ch.work) body.work = { counter, parts };
  if (ch.pulseRequired) {
    const t = turnstileToken();
    if (!t) {
      throw new ApiError(
        'mining minta human check (pulseRequired). Selesaikan Turnstile di browser lalu kirim tokennya: --turnstile <token>',
        'HUMAN_CHECK',
        403,
      );
    }
    body.captchaToken = t;
  }

  let res;
  try {
    res = await post('/v1/mining/start', body);
  } catch (e) {
    if (e.code === 'INVALID_REQUEST' || e.code === 'invalid_request') {
      const detail = e.body ? JSON.stringify(e.body) : '(tanpa detail)';
      const hint = ch.pulseRequired
        ? 'challenge minta human check — kirim --turnstile <token>'
        : 'bentuk body: { challengeId, work:{counter,parts}, captchaToken?, attestationToken? }';
      throw new ApiError(`start ditolak server · ${detail} · ${hint}`, 'INVALID_REQUEST', e.status, e.body);
    }
    throw e;
  }
  ok('sesi mining dimulai');
  return res;
}

/** Kirim bukti state L2 secara berkala selama sesi aktif. */
let checkCooldownUntil = 0;
let lastCheckAt = 0; // dipakai auto: jangan kirim /v1/mining/check tiap putaran poll

/** Jarak minimal antar check. Server Longyu membatasi request, jadi ada lantai aman. */
function checkEveryMs() {
  const floor = 120_000;
  return Math.max(ENV.CHAIN_CHECK_MS, floor);
}

async function heartbeatLoop(stopAt, { once = false } = {}) {
  if (Date.now() < checkCooldownUntil) {
    const left = Math.ceil((checkCooldownUntil - Date.now()) / 60000);
    console.log(dim(`${new Date().toISOString().slice(11, 19)} · check ditunda ${left}m (cooldown server)`));
    lastCheckAt = Date.now(); // jangan spam log tiap putaran poll
    return;
  }
  for (;;) {
    try {
      const chain = await checkChain();
      await post('/v1/mining/check', { index: chain.index, parts: chain.parts });
      lastCheckAt = Date.now();
      console.log(`${dim(new Date().toISOString().slice(11, 19))} · check index ${chain.index} · ${chain.match ? green('match') : yellow('mismatch')}`);
    } catch (e) {
      if (e.code === 'RATE_LIMIT') {
        const wait = Math.min(e.minutes || 5, 60);
        checkCooldownUntil = Date.now() + wait * 60_000;
        warn(`server membatasi request · check dijeda ${wait} menit (otomatis lanjut)`);
        return;
      }
      warn(`check gagal: ${e.message}`);
    }
    if (once) return;
    if (stopAt && Date.now() >= stopAt) return;
    await sleep(ENV.CHAIN_CHECK_MS);
  }
}

// ─────────────────────────────── saldo ───────────────────────────────
const ERC20_ABI = [
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
];

const fmt = (v, dec = 18, dp = 4) => {
  const base = 10n ** BigInt(dec);
  const n = BigInt(v ?? 0);
  const i = n / base;
  const f = (n % base).toString().padStart(dec, '0').slice(0, dp).replace(/0+$/, '');
  return i.toLocaleString('en-US') + (f ? '.' + f : '');
};

async function tokenInfo(rpc, address) {
  const [sym, dec] = await Promise.all([
    rpcCall(rpc, 'eth_call', [{ to: address, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'symbol' }) }, 'latest']),
    rpcCall(rpc, 'eth_call', [{ to: address, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'decimals' }) }, 'latest']),
  ]);
  return {
    symbol: decodeAbiParameters([{ type: 'string' }], sym)[0],
    decimals: Number(decodeAbiParameters([{ type: 'uint8' }], dec)[0]),
  };
}

async function tokenBalance(rpc, address, owner) {
  const raw = await rpcCall(rpc, 'eth_call', [
    { to: address, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] }) },
    'latest',
  ]);
  return decodeAbiParameters([{ type: 'uint256' }], raw)[0];
}

/** Ambil alamat wallet dari objek /v1/me (beberapa bentuk). */
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;

/**
 * Cari alamat EVM di mana pun dalam payload /v1/me.
 * Skema wallet situs bisa berubah (embedded wallet, custody, dst) — jangan bergantung satu field.
 */
function deepAddress(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return '';
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && EVM_ADDR.test(v) && /wallet|address/i.test(k)) return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const hit = deepAddress(v, depth + 1);
      if (hit) return hit;
    }
  }
  return '';
}

function walletAddressOf(me) {
  const own = deepAddress(me);
  if (own) return own;
  // cadangan: alamat dari .env (hanya untuk memantau saldo, bukan tujuan payout)
  if (EVM_ADDR.test(ENV.WALLET_ADDRESS)) return ENV.WALLET_ADDRESS;
  return '';
}

const walletFromEnv = (me) => !deepAddress(me) && EVM_ADDR.test(ENV.WALLET_ADDRESS);

// ─────────────────────────────── tampilan dashboard ───────────────────────────────
function bar(pct, width = 24) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return (NO_COLOR ? '#' : '\u001b[36m') + '█'.repeat(filled) + (NO_COLOR ? '-' : '\u001b[2m') + '░'.repeat(width - filled) + (NO_COLOR ? '' : '\u001b[0m');
}

/** Apakah nilai saldo > 0? Menangani "0", 0, "0.0000", objek U128, dan e18 string. */
function isPositive(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'object') {
    if ('hi' in v || 'lo' in v) return (BigInt(v.hi ?? 0) << 64n) + BigInt(v.lo ?? 0) > 0n;
    return false;
  }
  const str = String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) return false;
  const [int, frac = ''] = str.split('.');
  return Number(int) > 0 || /[1-9]/.test(frac); // "0.5" dihitung, "0.0000" tidak
}

/** Angka dari API kadang e18 (mis. "1020000000000000000") — rapikan untuk tampilan. */
function fmtMaybeE18(v) {
  const str = String(v);
  if (/^\d{16,}$/.test(str)) return fmt(str);
  return str;
}

/** Nilai apa pun dari API -> angka LONG (bukan wei). Aman untuk e18 string, desimal, dan U128. */
function amountToNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'object') {
    if ('hi' in v || 'lo' in v) return Number((BigInt(v.hi ?? 0) << 64n) + BigInt(v.lo ?? 0)) / 1e18;
    return 0;
  }
  const str = String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) return 0;
  if (/^\d{16,}$/.test(str)) return Number(str) / 1e18; // e18 mentah
  return Number(str);
}

/** Tampilkan nominal hasil mining dengan 4 desimal, apa pun bentuk mentahnya. */
function fmtAmount(v) {
  const str = String(v ?? 0).trim();
  if (/^\d{16,}$/.test(str)) return fmt(str);
  const n = amountToNum(v);
  if (!Number.isFinite(n)) return str;
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

// ─────────────────────────── pengaman klaim (MIN_CLAIM / CLAIM_EVERY_MIN) ───────────────────────────
const claimStatePath = path.isAbsolute(ENV.CLAIM_STATE_FILE)
  ? ENV.CLAIM_STATE_FILE
  : path.join(BASE_DIR, ENV.CLAIM_STATE_FILE);

function loadClaimState() {
  try {
    const s = JSON.parse(fs.readFileSync(claimStatePath, 'utf8'));
    return { lastAt: Number(s.lastAt) || 0, lastAmount: String(s.lastAmount ?? ''), lastId: String(s.lastId ?? '') };
  } catch {
    return { lastAt: 0, lastAmount: '', lastId: '' };
  }
}
function saveClaimState(patch) {
  const next = { ...loadClaimState(), ...patch };
  try {
    fs.writeFileSync(claimStatePath, JSON.stringify(next, null, 2), { mode: 0o600 });
  } catch {}
  return next;
}

/**
 * Boleh klaim sekarang? Kembalikan { ok, reason } supaya auto bisa menjelaskan
 * kenapa menahan diri, bukan diam saja.
 */
function claimGate(claimable) {
  const amount = amountToNum(claimable);
  const st = loadClaimState();
  const min = ENV.MIN_CLAIM;
  const windowMs = ENV.CLAIM_EVERY_MIN * 60_000;

  if (min > 0 && amount < min) {
    return { ok: false, amount, reason: `nominal ${fmtAmount(claimable)} < min ${min}`, kind: 'AMOUNT' };
  }
  if (windowMs > 0 && st.lastAt && Date.now() - st.lastAt < windowMs) {
    const left = windowMs - (Date.now() - st.lastAt);
    return {
      ok: false,
      amount,
      reason: `jeda klaim · sisa ${durationText(left)} dari ${ENV.CLAIM_EVERY_MIN}m`,
      kind: 'INTERVAL',
      lastAt: st.lastAt,
    };
  }
  return { ok: true, amount, lastAt: st.lastAt };
}


function durationText(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  const h = Math.floor(ms / 3.6e6);
  const m = Math.floor((ms % 3.6e6) / 6e4);
  return h ? `${h}j ${m}m` : `${m}m`;
}

function accountLine(me) {
  const handle = me?.handle || me?.username || me?.xHandle;
  const name = me?.name || me?.displayName;
  const addr = walletAddressOf(me);
  console.log(`${bold(handle ? '@' + handle : 'akun tanpa handle')}${name && name !== handle ? dim(' · ' + name) : ''}`);
  const fromEnv = walletFromEnv(me);
  console.log(
    `${dim('wallet ')} ${addr ? cyan(addr) : dim('belum ditautkan')}` +
    (addr && fromEnv ? dim(' (dari .env — pantau saja)') : ''),
  );
}

// ── saldo LONG (dibaca berkala, tidak tiap putaran) ──
let BALANCE_CACHE = { at: 0, value: null, address: '', symbol: 'LONG', rewardAddr: '' };
const BALANCE_TTL_MS = 10 * 60 * 1000;
let REWARDS_CACHE = { at: 0, data: null };
const REWARDS_TTL_MS = 5 * 60 * 1000;

/** ambil /v1/rewards (dipakai untuk available / pending / claimed) */
async function refreshRewards() {
  if (Date.now() - REWARDS_CACHE.at < REWARDS_TTL_MS && REWARDS_CACHE.data) return REWARDS_CACHE.data;
  const data = await get('/v1/rewards').catch(() => null);
  REWARDS_CACHE = { at: Date.now(), data };
  return data;
}

/** cari angka pertama yang cocok dari beberapa nama field (termasuk nested summary/totals) */
function pickAmount(obj, names, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return undefined;
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase();
    if (names.some((n) => key === n || key === n + 'e18') && (typeof v === 'string' || typeof v === 'number')) {
      return v;
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const hit = pickAmount(v, names, depth + 1);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

async function refreshBalance(me) {
  const fresh = Date.now() - BALANCE_CACHE.at < BALANCE_TTL_MS && BALANCE_CACHE.value !== null;
  if (fresh) return BALANCE_CACHE;

  try {
    const net = await get('/v1/network').catch(() => null);
    const addr = walletAddressOf(me);
    const rewardAddr = net?.rewardToken?.address || BALANCE_CACHE.rewardAddr;
    const symbol = net?.rewardToken?.symbol || BALANCE_CACHE.symbol;
    let value = null;
    if (addr && rewardAddr) {
      value = await tokenBalance(ENV.L2_RPC, rewardAddr, addr).catch(() => null);
    }
    BALANCE_CACHE = { at: Date.now(), value, address: addr, symbol, rewardAddr };
  } catch {
    BALANCE_CACHE.at = Date.now();
  }
  return BALANCE_CACHE;
}

/** tiga angka seperti di website: Available · Pending · Claimed */
function bucketsLine(st, rewards) {
  const avail = pickAmount(rewards, ['available', 'claimable']) ?? (st?.claimable ?? st?.pending);
  const pend = pickAmount(rewards, ['pending', 'unclaimed']);
  const claimed = pickAmount(rewards, ['claimed', 'totalclaimed', 'claimedtotal']);
  const nextAt = pickAmount(rewards, ['nextclaimat', 'claimableat', 'availableat', 'unlockat']);

  const cells = [
    `${dim('Available')} ${bold(fmtAmount(avail ?? 0))}`,
    `${dim('Pending  ')} ${bold(pend === undefined ? '-' : fmtAmount(pend))}`,
    `${dim('Claimed  ')} ${bold(claimed === undefined ? '-' : fmtAmount(claimed))}`,
  ];
  console.log('  ' + cells.join(dim('  ·  ')));

  if (nextAt) {
    const ts = Number(nextAt);
    const ms = ts > 1e12 ? ts : ts * 1000;
    if (Number.isFinite(ms) && ms > Date.now()) {
      const d = new Date(ms);
      console.log('  ' + dim(`bisa diklaim ${d.toLocaleString('en-GB', { hour12: false }).replace(',', '')}`));
    }
  }
}

/** baris ringkas: saldo + yang bisa diklaim + jarak ke ambang */
function claimBalanceLine(st) {
  const claimable = st?.claimable ?? st?.pending;
  const bal = BALANCE_CACHE.value;
  const sym = BALANCE_CACHE.symbol || 'LONG';
  const parts = [];
  parts.push(`${dim('saldo ')}${bal === null ? dim('?') : bold(fmt(bal))} ${sym}`);
  if (claimable !== undefined && claimable !== null) {
    const amount = amountToNum(claimable);
    parts.push(`${dim('bisa diklaim ')}${bold(fmtAmount(claimable))} ${sym}`);
    if (ENV.MIN_CLAIM > 0 && amount > 0 && amount < ENV.MIN_CLAIM) {
      parts.push(dim(`(kurang ${(ENV.MIN_CLAIM - amount).toFixed(2)} dari min ${ENV.MIN_CLAIM})`));
    }
  }
  console.log('  ' + parts.join(dim(' · ')));
}

function sessionBlock(st) {
  const s = st?.session;
  if (!s) {
    const can = st?.canStart;
    console.log(`${bold('MINING')} ${can ? green('siap dimulai') : dim('istirahat')}`);
    return;
  }
  const start = Number(s.startedAt) * 1000;
  const end = Number(s.endsAt) * 1000;
  const now = Date.now();
  const pct = end > start ? Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)) : 0;
  console.log(`${bold('MINING')} ${green('aktif')} ${dim('· sisa ' + durationText(end - now))}`);
  console.log(`${bar(pct)} ${pct.toFixed(0)}%`);
  const extra = [];
  if (st.estimatedPerHour !== undefined) extra.push(`${fmtMaybeE18(st.estimatedPerHour)}/jam`);
  if (st.power !== undefined) extra.push(`power ${st.power}`);
  if (st.streakDays !== undefined) extra.push(`streak ${st.streakDays}h`);
  if (st.day !== undefined) extra.push(`hari ${st.day}`);
  if (extra.length) console.log(dim(extra.join(' · ')));
}

/** /v1/tasks -> {tasks:[{id,kind,url,done,opened,boostEndsAt}], eligible, boostBps, hours} */
function tasksOf(data) {
  const list = Array.isArray(data) ? data : data?.tasks || data?.items || [];
  return { list, meta: Array.isArray(data) ? {} : data || {} };
}

const TASK_ICON = { follow: 'follow', like: 'like', repost: 'repost', reply: 'reply', share: 'share' };

function renderTaskTable(list, meta = {}) {
  if (!list.length) return console.log(dim('tidak ada task'));
  const done = list.filter((t) => t.done).length;
  const rows = list.map((t) => [
    TASK_ICON[t.kind] || t.kind || 'task',
    t.boostEndsAt && Number(t.boostEndsAt) * 1000 > Date.now() ? green('aktif') : '-',
    t.done ? green('selesai') : t.opened ? yellow('sudah dibuka') : dim('belum'),
  ]);
  console.log(table(['TASK', 'BOOST', 'STATUS'], rows, ['l', 'l', 'l']));
  console.log(`${dim('progress')} ${bar((done / list.length) * 100, 16)} ${done}/${list.length} task selesai`);
  if (meta.eligible === false) warn('akun belum eligible untuk task (perlu mining aktif / verifikasi)');
}

/** Kerjakan semua task yang belum selesai. Dipakai `tasks --auto` dan loop `auto`. */
const TASK_ERR = {
  NOT_FOLLOWING: 'akun X belum follow target',
  NOT_CONFIRMED: 'aksi belum terdeteksi di X (like/repost/reply belum ada)',
  NOT_LIKED: 'belum like postingan target',
  NOT_REPOSTED: 'belum repost',
  NOT_REPLIED: 'belum reply',
  TASK_NOT_DONE: 'aksi belum dilakukan',
};

const failedTasks = new Set();

async function runTasksAuto({ quiet = false } = {}) {
  const data = await get('/v1/tasks');
  const { list, meta } = tasksOf(data);
  const todo = list.filter((t) => !t.done && !failedTasks.has(t.id));
  if (!todo.length) {
    if (!quiet) ok('semua task sudah selesai');
    return { done: 0, failed: 0, total: list.length };
  }
  if (meta.eligible === false) {
    warn('akun belum eligible untuk task — dilewati');
    return { done: 0, failed: 0, total: list.length, skipped: true };
  }

  let done = 0;
  let failed = 0;
  for (const t of todo) {
    const label = TASK_ICON[t.kind] || t.kind || 'task';
    try {
      await sleep(rand(ENV.HUMAN_MIN_MS, ENV.HUMAN_MAX_MS));
      await api('POST', `/v1/tasks/${t.id}/open`).catch(() => null);
      if (t.url && !quiet) console.log(`${dim('buka')} ${t.url}`);
      await sleep(rand(1500, 3200));
      await api('POST', `/v1/tasks/${t.id}/verify`);
      done += 1;
      ok(`task ${label} terverifikasi`);
    } catch (e) {
      failed += 1;
      failedTasks.add(t.id);
      warn(`task ${label} gagal: ${TASK_ERR[e.code] || e.code || e.message.slice(0, 40)}`);
    }
  }
  return { done, failed, total: list.length };
}

// ─────────────────────────────── klaim ke wallet ───────────────────────────────
/** /v1/rewards -> daftar klaim; bentuknya defensif karena skema belum terlihat. */
function claimsOf(data) {
  const list = data?.claims || data?.rewards || data?.items || (Array.isArray(data) ? data : []);
  return Array.isArray(list) ? list : [];
}

const CLAIM_STATUS = { queued: yellow('antri'), sent: cyan('dikirim'), confirmed: green('masuk'), skipped: dim('dilewati'), failed: red('gagal') };

function statusOf(c) {
  const st = String(c.status || c.state || '').toLowerCase();
  return CLAIM_STATUS[st] || st || '-';
}

function renderClaims(data) {
  const list = claimsOf(data);
  if (!list.length) return console.log(dim('belum ada riwayat klaim'));
  const rows = list.slice(0, 15).map((c) => [
    String(c.claimId || c.id || '-').slice(0, 12),
    c.amount !== undefined ? fmt(c.amount) : c.amountE18 !== undefined ? fmt(c.amountE18) : '-',
    statusOf(c),
    (c.txHash || c.transactionHash || '-').slice(0, 14),
    c.at || c.createdAt || c.date ? new Date(Number(c.at || c.createdAt) * 1000 || c.createdAt).toISOString().slice(0, 16).replace('T', ' ') : '-',
  ]);
  console.log(table(['CLAIM', 'JUMLAH', 'STATUS', 'TX', 'WAKTU'], rows, ['l', 'r', 'l', 'l', 'l']));
}

/** Tunggu klaim berubah status (queued -> sent -> confirmed), seperti situs. */
async function waitClaim(claimId, { timeoutMs = 10 * 60_000, everyMs = 5000 } = {}) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    const data = await get('/v1/rewards').catch(() => null);
    const list = claimsOf(data);
    const mine = list.find((c) => String(c.claimId || c.id) === String(claimId)) || list[0];
    const st = mine ? String(mine.status || mine.state || '').toLowerCase() : '';
    if (st && st !== last) {
      console.log(`${dim(new Date().toISOString().slice(11, 19))} · status ${CLAIM_STATUS[st] || st}`);
      last = st;
      if (['confirmed', 'sent', 'failed', 'skipped'].includes(st)) return { status: st, claim: mine };
    }
    if (!st) return { status: 'unknown', claim: mine };
    await sleep(everyMs);
  }
  return { status: last || 'timeout', claim: null };
}

// ─────────────────────────────── perintah ───────────────────────────────
const posArgs = () => process.argv.slice(2).filter((a) => !a.startsWith('-'));

const cmds = {
  async token() {
    if (!AUTH.accessToken) {
      warn('ACCESS_TOKEN kosong');
      console.log(`
${bold('Cara ambil bearer token:')}
  1. buka https://mine.longyu.network dan login dengan X
  2. F12 → Application → Local Storage → https://mine.longyu.network
  3. cari key ${bold('longyu.tokens')} → isinya JSON {"accessToken":"…","refreshToken":"…"}
  4. isi .env:
     ${dim('ACCESS_TOKEN=…')}
     ${dim('REFRESH_TOKEN=…')}`);
      return;
    }
    console.log(`${dim('access token ')} ${AUTH.accessToken.slice(0, 18)}… ${dim('(' + AUTH.accessToken.length + ' char)')}`);
    console.log(`${dim('refresh token')} ${AUTH.refreshToken ? AUTH.refreshToken.slice(0, 12) + '…' : dim('kosong (tidak bisa auto-refresh)')}`);
    try {
      const me = await get('/v1/me');
      ok(`token valid · @${me.handle || me.username || me.xHandle || '?'}`);
    } catch (e) {
      if (e.status === 401) fail('token tidak valid / kedaluwarsa (401)');
      else fail(`${e.code} ${e.message}`);
    }
  },

  async me() {
    const me = await get('/v1/me');
    if (process.argv.includes('--json')) return console.log(JSON.stringify(me, null, 2));
    render(me);
  },

  async status() {
    const st = await miningStatus();
    if (!renderMining(st)) return;
    if (process.argv.includes('--json')) console.log(JSON.stringify(st, null, 2));
  },

  async network() {
    render(await get('/v1/network'));
  },

  async attest() {
    await attestDevice();
    render(await miningStatus(), 'STATUS SETELAH ATTEST');
  },

  async mine() {
    const res = await startMining();
    if (res) render(res);
    const st = await miningStatus().catch(() => null);
    if (st) renderMining(st);
    const endsAt = st?.session?.endsAt ? Number(st.session.endsAt) * 1000 : 0;
    if (process.argv.includes('--follow') && endsAt) {
      console.log(dim(`heartbeat tiap ${ENV.CHAIN_CHECK_MS / 1000}s sampai sesi habis`));
      await heartbeatLoop(endsAt);
      const fin = await miningStatus().catch(() => null);
      if (fin) renderMining(fin);
    } else if (endsAt) {
      warn(`sesi aktif sampai ${new Date(endsAt).toISOString().slice(11, 19)}Z — tambahkan --follow untuk heartbeat otomatis`);
    }
  },

  async check() {
    const chain = await checkChain();
    console.log(table(['FIELD', 'NILAI'], [
      ['output index', chain.index],
      ['l2 block', chain.l2Block],
      ['state root', chain.parts.stateRoot],
      ['message passer', chain.parts.messagePasserRoot],
      ['block hash', chain.parts.blockHash],
      ['cocok dengan L1', chain.match ? green('ya') : red('tidak')],
    ]));
    await post('/v1/mining/check', { index: chain.index, parts: chain.parts });
    ok('bukti terkirim ke server');
  },

  async balance() {
    const [me, net, st] = await Promise.all([
      get('/v1/me'),
      get('/v1/network').catch(() => null),
      miningStatus().catch(() => null),
    ]);
    const addr = walletAddressOf(me);
    const rewardAddr = net?.rewardToken?.address;

    const rows = [];
    const claimable = st?.claimable ?? st?.pending;
    if (claimable !== undefined && claimable !== null) {
      rows.push(['bisa diklaim', `${fmtAmount(claimable)} ${net?.rewardToken?.symbol || 'LONG'}`, 'hasil mining']);
    }
    if (st?.rewards && typeof st.rewards === 'object') {
      for (const [k, v] of Object.entries(st.rewards)) {
        if (v !== null && typeof v !== 'object') rows.push([`mining ${k}`, fmt(v), 'akun']);
      }
    }

    if (!addr) {
      warn('wallet belum ditautkan ke akun — buat/link dulu di menu Wallet pada situs');
      if (rows.length) console.log(table(['SALDO', 'JUMLAH', 'SUMBER'], rows, ['l', 'r', 'l']));
      return;
    }

    console.log(`${dim('wallet ')} ${cyan(addr)}${walletFromEnv(me) ? dim(' (dari .env — pantau saja, bukan tujuan payout)') : ''}`);
    const reads = [
      ['BNB (BSC)', rpcCall(ENV.L1_RPC, 'eth_getBalance', [addr, 'latest']).then((v) => fmt(BigInt(v))), 'BSC'],
      ['BNB (LONGYU)', rpcCall(ENV.L2_RPC, 'eth_getBalance', [addr, 'latest']).then((v) => fmt(BigInt(v))), 'L2'],
    ];
    if (rewardAddr) {
      reads.push([
        net?.rewardToken?.symbol || 'LONG',
        tokenBalance(ENV.L2_RPC, rewardAddr, addr).then((v) => fmt(v)),
        'L2',
      ]);
      reads.push([
        `${net?.rewardToken?.symbol || 'LONG'} (BSC)`,
        tokenBalance(ENV.L1_RPC, rewardAddr, addr).then((v) => fmt(v)).catch(() => '0'),
        'BSC',
      ]);
    }

    for (const [label, promise, chain] of reads) {
      const value = await promise.catch(() => null);
      rows.push([label, value === null ? dim('gagal dibaca') : value, chain]);
    }
    console.log(table(['SALDO', 'JUMLAH', 'CHAIN'], rows, ['l', 'r', 'l']));
    if (process.argv.includes('--json')) console.log(JSON.stringify({ address: addr, me, mining: st }, null, 2));
  },

  async dashboard() {
    const [me, net, st, tasksData, rewards] = await Promise.all([
      get('/v1/me'),
      get('/v1/network').catch(() => null),
      miningStatus().catch(() => null),
      get('/v1/tasks').catch(() => null),
      get('/v1/rewards').catch(() => null),
    ]);

    console.log('');
    accountLine(me);
    console.log('');
    sessionBlock(st);

    const { list, meta } = tasksOf(tasksData || {});
    if (list.length) {
      const done = list.filter((t) => t.done).length;
      console.log(`${bold('TASK')} ${dim(`${done}/${list.length} selesai`)}`);
    }

    console.log('');
    const rows = [];
    const claimable = st?.claimable ?? st?.pending;
    if (claimable !== undefined && claimable !== null) {
      rows.push(['bisa diklaim', fmtAmount(claimable) + ' ' + (net?.rewardToken?.symbol || 'LONG'), 'mining']);
    }
    const addr = walletAddressOf(me);
    if (addr) {
      const rewardAddr = net?.rewardToken?.address;
      const reads = [
        ['BNB (BSC)', rpcCall(ENV.L1_RPC, 'eth_getBalance', [addr, 'latest']).then((v) => fmt(BigInt(v)))],
        ['BNB (LONGYU)', rpcCall(ENV.L2_RPC, 'eth_getBalance', [addr, 'latest']).then((v) => fmt(BigInt(v)))],
      ];
      if (rewardAddr) {
        reads.push([net?.rewardToken?.symbol || 'LONG', tokenBalance(ENV.L2_RPC, rewardAddr, addr).then((v) => fmt(v))]);
        reads.push([`${net?.rewardToken?.symbol || 'LONG'} (BSC)`, tokenBalance(ENV.L1_RPC, rewardAddr, addr).then((v) => fmt(v)).catch(() => '0')]);
      }
      for (const [label, promise] of reads) {
        rows.push([label, (await promise.catch(() => null)) ?? dim('gagal'), 'wallet']);
      }
    } else {
      warn('wallet belum ditautkan — buka menu Wallet di situs untuk membuat/menautkan');
    }
    if (rows.length) console.log(table(['SALDO', 'JUMLAH', 'SUMBER'], rows, ['l', 'r', 'l']));

    const claims = claimsOf(rewards);
    if (claims.length) {
      const last = claims[0];
      console.log(
        `${dim('klaim terakhir ')} ${statusOf(last)}` +
        (last.amount !== undefined ? ` · ${fmt(last.amount)}` : '') +
        (last.txHash ? dim(` · ${String(last.txHash).slice(0, 12)}…`) : ''),
      );
    }
    console.log('');
  },

  async demo() {
    const now = Math.floor(Date.now() / 1000);
    const me = { handle: 'contoh', wallet: { address: '0x36b3e0796335F00eB630f5B7e654858FDFb19Bf8' } };
    const st = { session: { startedAt: now - 3600, endsAt: now + 66000 }, estimatedPerHour: 12.5, power: 1, streakDays: 3, day: 4, claimable: '128421300000000000000' };
    const list = [
      { id: '1', kind: 'follow', done: true, boostEndsAt: now + 7200 },
      { id: '2', kind: 'like', done: true },
      { id: '3', kind: 'repost', done: false, opened: true },
      { id: '4', kind: 'reply', done: false },
    ];
    console.log(dim('(demo — angka palsu, hanya pratinjau tampilan)'));
    console.log('');
    accountLine(me);
    console.log('');
    sessionBlock(st);
    console.log('');
    renderTaskTable(list, { eligible: true });
    console.log('');
    console.log(table(['SALDO', 'JUMLAH', 'SUMBER'], [
      ['bisa diklaim', '128.4213 LONG', 'mining'],
      ['BNB (BSC)', '0.0421', 'wallet'],
      ['BNB (LONGYU)', '0.0100', 'wallet'],
      ['LONG', '512.8834', 'wallet'],
      ['LONG (BSC)', '0.0000', 'wallet'],
    ], ['l', 'r', 'l']));
    console.log('');
    renderClaims({ claims: [
      { claimId: 'clm_9f2a41', amount: '128421300000000000000', status: 'confirmed', txHash: '0x9ab12c44de77', at: now - 3600 },
      { claimId: 'clm_7d10bb', amount: '64210000000000000000', status: 'sent', txHash: '0x31ff0a9b21c3', at: now - 120 },
    ] });
    console.log('');
  },

  async tasks() {
    const withParam = process.argv.includes('--reply') ? '?with=reply' : '';
    const data = await get(`/v1/tasks${withParam}`);
    const { list, meta } = tasksOf(data);

    if (!process.argv.includes('--auto')) {
      renderTaskTable(list, meta);
      const todo = list.filter((t) => !t.done).length;
      if (todo) console.log(dim(`\n${todo} task belum selesai — jalankan: node longyu.js tasks --auto`));
      return;
    }

    console.log('');
    const res = await runTasksAuto();
    const fresh = await get(`/v1/tasks${withParam}`).catch(() => null);
    if (fresh) {
      const after = tasksOf(fresh);
      console.log('');
      renderTaskTable(after.list, after.meta);
    }
    if (res.failed) {
      warn(`${res.failed} task gagal — lakukan aksinya dulu di X, lalu jalankan lagi`);
      console.log(dim('  task yang sudah gagal tidak diulang di sesi ini (auto)'));
    }
  },

  async start() {
    await cmds.mine();
  },

  async claim() {
    const wait = process.argv.includes('--wait');
    const force = process.argv.includes('--force');
    const st = await miningStatus().catch(() => null);
    const claimable = st?.claimable ?? st?.pending;
    if (claimable !== undefined && claimable !== null && !isPositive(claimable)) {
      warn('belum ada yang bisa diklaim');
      renderClaims(await get('/v1/rewards').catch(() => null));
      return;
    }
    if (claimable !== undefined && claimable !== null) {
      console.log(`${dim('bisa diklaim ')} ${bold(fmtAmount(claimable))} ${dim('LONG')}`);
      // manual: jeda CLAIM_EVERY_MIN diabaikan (ini perintah eksplisit), tapi MIN_CLAIM tetap dijaga
      const amount = amountToNum(claimable);
      if (ENV.MIN_CLAIM > 0 && amount < ENV.MIN_CLAIM && !force) {
        warn(`nominal ${fmtAmount(claimable)} di bawah MIN_CLAIM ${ENV.MIN_CLAIM} — tambahkan --force kalau tetap mau klaim`);
        return;
      }
    }

    const res = await post('/v1/rewards/claim');
    const claimId = res.claimId || res.id || '-';
    if (res.claimId) saveClaimState({ lastAt: Date.now(), lastAmount: String(claimable ?? ''), lastId: String(res.claimId) });
    ok(`klaim diterima · claimId ${claimId}`);
    if (res.claim) renderClaims({ claims: [res.claim] });

    if (wait) {
      console.log(dim('menunggu payout ke wallet…'));
      const fin = await waitClaim(claimId);
      if (fin.claim) renderClaims({ claims: [fin.claim] });
      if (fin.status === 'confirmed') ok('reward sudah masuk wallet');
      else if (fin.status === 'sent') ok('transaksi sudah dikirim ke wallet');
      else warn(`status akhir: ${fin.status}`);
    } else {
      warn('payout diproses server — pakai `claim --wait` untuk memantau sampai masuk wallet');
    }
    renderClaims(await get('/v1/rewards').catch(() => null));
  },

  async rewards() {
    const data = await get('/v1/rewards');
    if (process.argv.includes('--json')) return console.log(JSON.stringify(data, null, 2));
    const list = claimsOf(data);
    if (list.length) return renderClaims(data);
    render(data);
  },

  async activity() {
    render(await get('/v1/activity'));
  },

  async invites() {
    render(await get('/v1/invites'));
  },

  async boosts() {
    render(await get('/v1/boosts'));
  },

  async leaderboard() {
    render(await get('/v1/leaderboard'));
  },

  async stats() {
    render(await get('/v1/stats'));
  },

  async auto() {
    let round = 0;
    let headerDone = false;
    let lastTasks = 0;
    let meCache = null;
    const minTxt = ENV.MIN_CLAIM > 0 ? `${ENV.MIN_CLAIM} LONG` : 'tanpa batas';
    const everyTxt = ENV.CLAIM_EVERY_MIN > 0 ? `${ENV.CLAIM_EVERY_MIN}m` : 'tanpa jeda';
    const checkEvery = checkEveryMs();
    console.log(dim(
      `mode auto · poll ${ENV.POLL_SECONDS}s · check ${checkEvery / 1000}s · ` +
      `task ${ENV.AUTO_TASKS ? 'tiap ' + ENV.TASKS_INTERVAL_MIN + 'm' : 'nonaktif'}`,
    ));
    console.log(dim(`klaim · min ${minTxt} · jeda ${everyTxt}`));
    if (ENV.CHAIN_CHECK_MS < checkEvery) {
      warn(`CHAIN_CHECK_MS ${ENV.CHAIN_CHECK_MS / 1000}s terlalu rapat — dipakai ${checkEvery / 1000}s (server membatasi request)`);
    }

    for (;;) {
      round += 1;
      try {
        const [me, st] = await Promise.all([get('/v1/me').catch(() => null), miningStatus()]);
        if (me) meCache = me;
        await refreshBalance(meCache).catch(() => null);

        if (!headerDone && me) {
          console.log('');
          accountLine(me);
          console.log('');
          headerDone = true;
        }

        const claimable = st?.claimable ?? st?.pending;
        if (isPositive(claimable)) {
          const gate = claimGate(claimable);
          if (!gate.ok) {
            const ts = new Date().toISOString().slice(11, 19);
            console.log(dim(`${ts} · tahan klaim ${fmtAmount(claimable)} — ${gate.reason}`));
          } else {
            console.log(`${dim('bisa diklaim ')} ${bold(fmtAmount(claimable))} — memproses klaim`);
            const res = await post('/v1/rewards/claim').catch((e) => ({ error: e.message }));
            if (res.claimId) {
              saveClaimState({ lastAt: Date.now(), lastAmount: String(claimable), lastId: String(res.claimId) });
              ok(`klaim diterima · claimId ${res.claimId}`);
            } else {
              warn(`klaim gagal: ${res.error || 'tanpa claimId'}`);
            }
          }
        }

        // task misi: sekali di awal, lalu tiap TASKS_INTERVAL_MIN
        if (ENV.AUTO_TASKS && Date.now() - lastTasks > ENV.TASKS_INTERVAL_MIN * 60_000) {
          lastTasks = Date.now();
          const t = await runTasksAuto({ quiet: true }).catch((e) => {
            warn(`task dilewati: ${e.code || e.message}`);
            return null;
          });
          if (t && t.done) ok(`${t.done} task selesai${t.failed ? `, ${t.failed} gagal` : ''}`);
          else if (t && t.failed) warn(`${t.failed} task gagal`);
        }

        const endsAt = st?.session?.endsAt ? Number(st.session.endsAt) * 1000 : 0;
        if (endsAt && Date.now() < endsAt) {
          // penting: poll 60s ≠ check 60s. Hormati CHAIN_CHECK_MS supaya server tidak rate limit.
          if (Date.now() - lastCheckAt >= checkEvery) {
            sessionBlock(st);
            bucketsLine(st, await refreshRewards());
            claimBalanceLine(st);
            await heartbeatLoop(endsAt, { once: true });
          }
        } else if (st?.canStart) {
          claimBalanceLine(st);
          console.log(`${dim(new Date().toISOString().slice(11, 19))} · mulai sesi baru`);
          const res = await startMining();
          const ends = res?.session?.endsAt ? Number(res.session.endsAt) * 1000 : 0;
          if (ends) await heartbeatLoop(ends, { once: true });
        } else {
          console.log(`${dim(new Date().toISOString().slice(11, 19))} · menunggu jadwal berikutnya`);
        }
        console.log(dim('─'.repeat(46)));
      } catch (e) {
        if (e.code === 'RATE_LIMIT') {
          const wait = Math.min(e.minutes || 5, 30);
          warn(`RPC kena rate limit · istirahat ${wait} menit`);
          await sleep(wait * 60_000);
          continue;
        }
        warn(`putaran ${round}: ${e.code || ''} ${e.message}`);
      }
      if (ENV.MAX_ROUNDS && round >= ENV.MAX_ROUNDS) break;
      await sleep(ENV.POLL_SECONDS * 1000 * (0.9 + Math.random() * 0.2));
    }
  },

  async debug() {
    console.log(`${dim('api            ')} ${ENV.API_URL}`);
    console.log(`${dim('l2 rpc         ')} ${ENV.L2_RPC}`);
    console.log(`${dim('l1 rpc         ')} ${ENV.L1_RPC}`);
    console.log(`${dim('output oracle  ')} ${ENV.OUTPUT_ORACLE}`);
    console.log(`${dim('access token   ')} ${AUTH.accessToken ? dim('ada') : red('kosong')}`);
    console.log(`${dim('refresh token  ')} ${AUTH.refreshToken ? dim('ada') : dim('kosong')}`);
    {
      const cs = loadClaimState();
      console.log(`${dim('min claim      ')} ${ENV.MIN_CLAIM > 0 ? ENV.MIN_CLAIM + ' LONG' : 'tanpa batas'}`);
      console.log(`${dim('jeda klaim     ')} ${ENV.CLAIM_EVERY_MIN > 0 ? ENV.CLAIM_EVERY_MIN + ' menit' : 'tanpa jeda'}`);
      console.log(`${dim('klaim terakhir ')} ${cs.lastAt ? new Date(cs.lastAt).toISOString().replace('T', ' ').slice(0, 19) + 'Z' : dim('belum ada')}`);
    }

    try {
      const net = await get('/v1/network');
      ok(`API publik OK · chain id ${net.chainId ?? '-'} · reward ${net.rewardToken?.symbol ?? net.nativeCurrency?.symbol ?? '-'}`);
    } catch (e) {
      fail(`API publik gagal · ${e.code} ${e.message}`);
    }
    try {
      const chain = await checkChain();
      ok(`chain check OK · index ${chain.index} · ${chain.match ? 'match' : 'MISMATCH'}`);
    } catch (e) {
      fail(`chain check gagal · ${e.message}`);
    }
    if (AUTH.accessToken) {
      try {
        const me = await get('/v1/me');
        ok(`auth OK · @${me.handle || me.username || '?'}`);
        try {
          const ch = await post('/v1/mining/challenge');
          ok(`challenge OK · bits ${ch.work?.bits ?? 0} · humanCheck ${ch.pulseRequired ? red('minta turnstile') : 'tidak'} · output ${ch.work?.output?.index ?? '-'}`);
          console.log(dim('  body start: { challengeId, work:{counter,parts}' + (ch.pulseRequired ? ', captchaToken' : '') + ' }'));
        } catch (e) {
          warn(`challenge gagal · ${e.code} ${e.message}`);
        }
      } catch (e) {
        if (e.status === 401) warn('token tidak valid (401) — ambil ulang dari localStorage');
        else fail(`auth gagal · ${e.code} ${e.message}`);
      }
    } else {
      warn('ACCESS_TOKEN kosong — jalankan: node longyu.js token');
    }
  },
};

// ─────────────────────────────── main ───────────────────────────────
async function main() {
  const argv = posArgs();
  const cmd = argv[0] || 'status';
  banner();
  initAuth();
  const fn = cmds[cmd];
  if (!fn) {
    console.log(`${bold('longyu.js')} ${dim('v' + VERSION)}`);
    console.log('');
    console.log(table(['PERINTAH', 'KETERANGAN'], [
      ['dashboard', 'ringkasan: akun, saldo, mining, task'],
      ['demo', 'pratinjau tampilan pakai data palsu'],
      ['token', 'cek bearer token + cara ambilnya'],
      ['me', 'profil akun'],
      ['status', 'status mining (sesi, rate, claimable)'],
      ['balance', 'saldo wallet: BNB (BSC/L2) + token LONG'],
      ['network', 'info chain & token reward'],
      ['attest', 'attest device (wajib sebelum mining)'],
      ['mine [--follow]', 'mulai sesi mining (PoW + chain check)'],
      ['start', 'alias dari mine'],
      ['check', 'kirim bukti state L2 sekarang'],
       ['claim [--wait]', 'klaim reward ke wallet (+ pantau payout)'],
       ['claim --force', 'klaim walau di bawah MIN_CLAIM'],
      ['rewards', 'riwayat reward'],
      ['activity', 'aktivitas akun'],
      ['tasks [--reply]', 'daftar task X'],
      ['tasks --auto', 'kerjakan task otomatis (open -> verify)'],
      ['invites', 'kode & statistik invite'],
      ['boosts', 'paket boost'],
      ['leaderboard', 'papan peringkat'],
      ['stats', 'statistik jaringan'],
      ['auto', 'loop otomatis: mulai sesi, check, klaim'],
      ['debug', 'tes API + chain check + token'],
    ], ['l', 'l']));
    console.log(`\n${dim('contoh:')} node longyu.js status`);
    return;
  }
  await fn();
}

main().catch((e) => {
  fail(e.code ? `[${e.code}] ${e.message}` : e.message);
  if (e.status === 401 || /invalid_token|unauthorized/i.test(String(e.code || ''))) {
    console.log(dim('  token kedaluwarsa → ambil ulang dari localStorage longyu.tokens'));
    if (!AUTH.refreshToken) console.log(dim('  isi juga REFRESH_TOKEN supaya script bisa memperpanjang sesi sendiri'));
  }
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
