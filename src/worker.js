/**
 * Gnosis website Worker
 *
 * Serves the static site from ./public and adds a small analytics API backed by D1:
 *   POST /api/event               page views, heartbeats, downloads, demo-chat use and form use
 *   GET  /api/admin/summary       live and historical usage for the dashboard (Bearer ADMIN_TOKEN)
 *   GET  /api/admin/events.csv    recent events as CSV (Bearer ADMIN_TOKEN)
 *
 * Bindings: DB (D1 database), ASSETS (static files). Secret: ADMIN_TOKEN.
 * No names, emails, form contents or IP addresses are stored.
 */

const LIVE_WINDOW_MS = 90 * 1000;
const RETENTION_MS = 400 * 24 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;

const EVENT_TYPES = new Set(['pageview', 'heartbeat', 'download', 'tryit', 'lead']);
const NO_EVENT_ROW = new Set(['heartbeat']);
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const META_RE = /^[a-z0-9-]{0,40}$/;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS visitors (
     vid TEXT PRIMARY KEY, country TEXT, city TEXT, device TEXT,
     first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, last_type TEXT, last_path TEXT,
     pageviews INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS events (
     id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL,
     vid TEXT NOT NULL, sid TEXT, country TEXT, device TEXT,
     path TEXT, ref TEXT, meta TEXT)`,
  `CREATE INDEX IF NOT EXISTS events_ts ON events(ts)`,
  `CREATE INDEX IF NOT EXISTS events_type_ts ON events(type, ts)`,
  `CREATE INDEX IF NOT EXISTS visitors_last_seen ON visitors(last_seen)`,
];

let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

function deviceOf(ua = '') {
  if (/bot|crawl|spider|slurp|preview|monitor|headless/i.test(ua)) return 'Bot';
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'Tablet';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'Mobile';
  return 'Desktop';
}

// Keep only the referring site's host name, and drop our own.
function refHost(ref, ownHost) {
  if (!ref) return null;
  try {
    const h = new URL(ref).hostname.replace(/^www\./, '');
    return h && h !== ownHost.replace(/^www\./, '') ? h.slice(0, 100) : null;
  } catch { return null; }
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a || ''), y = enc.encode(b || '');
  if (x.byteLength !== y.byteLength || x.byteLength === 0) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

async function isAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return safeEqual(token, env.ADMIN_TOKEN);
}

/* ------------------------------ ingestion ------------------------------ */

async function handleEvent(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return json({ error: 'Cross-site events are not accepted.' }, 403);

  let body;
  try {
    const text = await request.text();
    if (text.length > 4096) return json({ error: 'Event too large.' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Send a JSON body.' }, 400);
  }

  const type = clip(body.type, 20);
  const vid = clip(body.vid, 64);
  if (!EVENT_TYPES.has(type) || !ID_RE.test(vid)) return json({ error: 'Unknown event or visitor id.' }, 400);

  const ua = request.headers.get('user-agent') || '';
  const device = deviceOf(ua);
  if (device === 'Bot') return new Response(null, { status: 204 }); // crawlers are not counted

  const sid = ID_RE.test(clip(body.sid, 64)) ? body.sid : null;
  const meta = META_RE.test(clip(body.meta, 40)) ? clip(body.meta, 40) || null : null;
  const path = clip(body.path, 120).replace(/[^A-Za-z0-9/._-]/g, '') || '/';
  const cf = request.cf || {};
  const now = Date.now();
  const country = clip(cf.country, 2) || null;
  const city = clip(cf.city, 80) || null;
  const ref = type === 'pageview' ? refHost(clip(body.ref, 300), url.hostname) : null;

  await ensureSchema(env.DB);
  const stmts = [
    env.DB.prepare(
      `INSERT INTO visitors (vid, country, city, device, first_seen, last_seen, last_type, last_path, pageviews)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8)
       ON CONFLICT(vid) DO UPDATE SET
         country = COALESCE(excluded.country, visitors.country),
         city = COALESCE(excluded.city, visitors.city),
         device = excluded.device, last_seen = excluded.last_seen,
         last_type = excluded.last_type, last_path = excluded.last_path,
         pageviews = visitors.pageviews + excluded.pageviews`
    ).bind(vid, country, city, device, now, type, path, type === 'pageview' ? 1 : 0),
  ];
  if (!NO_EVENT_ROW.has(type)) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO events (ts, type, vid, sid, country, device, path, ref, meta) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      ).bind(now, type, vid, sid, country, device, path, ref, meta)
    );
  }
  await env.DB.batch(stmts);
  return new Response(null, { status: 204 });
}

/* ------------------------------ admin API ------------------------------ */

async function handleSummary(env) {
  await ensureSchema(env.DB);
  const now = Date.now();
  const db = env.DB;
  const [live, totals, daily, countries, devices, pages, refs, downloads, recent] = await db.batch([
    db.prepare(`SELECT country, city, device, last_type, last_path, last_seen FROM visitors WHERE last_seen > ?1 ORDER BY last_seen DESC LIMIT 200`).bind(now - LIVE_WINDOW_MS),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM events WHERE type = 'pageview' AND ts > ?1) AS visits24,
         (SELECT COUNT(DISTINCT vid) FROM events WHERE ts > ?1) AS visitors24,
         (SELECT COUNT(*) FROM events WHERE type = 'pageview' AND ts > ?2) AS visits7,
         (SELECT COUNT(DISTINCT vid) FROM events WHERE ts > ?2) AS visitors7,
         (SELECT COUNT(*) FROM events WHERE type = 'pageview' AND ts > ?3) AS visits30,
         (SELECT COUNT(DISTINCT vid) FROM events WHERE ts > ?3) AS visitors30,
         (SELECT COUNT(*) FROM events WHERE type = 'download' AND ts > ?2) AS downloads7,
         (SELECT COUNT(*) FROM events WHERE type = 'download' AND ts > ?3) AS downloads30,
         (SELECT COUNT(*) FROM events WHERE type = 'lead' AND meta = 'demo' AND ts > ?3) AS demos30,
         (SELECT COUNT(*) FROM events WHERE type = 'lead' AND meta = 'contact' AND ts > ?3) AS contacts30,
         (SELECT COUNT(DISTINCT vid) FROM events WHERE type = 'tryit' AND ts > ?3) AS tryit30,
         (SELECT COUNT(*) FROM events WHERE type = 'pageview') AS visitsAll`
    ).bind(now - DAY, now - 7 * DAY, now - 30 * DAY),
    db.prepare(
      `SELECT date(ts / 1000, 'unixepoch') AS day, SUM(type = 'pageview') AS visits, COUNT(DISTINCT vid) AS visitors,
              SUM(type = 'download') AS downloads
         FROM events WHERE ts > ?1 GROUP BY day ORDER BY day`
    ).bind(now - 30 * DAY),
    db.prepare(`SELECT COALESCE(country, '??') AS country, COUNT(DISTINCT vid) AS visitors FROM events WHERE ts > ?1 GROUP BY country ORDER BY visitors DESC LIMIT 8`).bind(now - 30 * DAY),
    db.prepare(`SELECT device, COUNT(DISTINCT vid) AS visitors FROM events WHERE ts > ?1 GROUP BY device ORDER BY visitors DESC`).bind(now - 30 * DAY),
    db.prepare(`SELECT path, COUNT(*) AS n FROM events WHERE type = 'pageview' AND ts > ?1 GROUP BY path ORDER BY n DESC LIMIT 10`).bind(now - 30 * DAY),
    db.prepare(`SELECT ref, COUNT(DISTINCT vid) AS visitors FROM events WHERE type = 'pageview' AND ref IS NOT NULL AND ts > ?1 GROUP BY ref ORDER BY visitors DESC LIMIT 8`).bind(now - 30 * DAY),
    db.prepare(`SELECT meta AS kind, COUNT(*) AS n FROM events WHERE type = 'download' AND ts > ?1 GROUP BY meta ORDER BY n DESC`).bind(now - 30 * DAY),
    db.prepare(`SELECT ts, type, country, device, path, ref, meta FROM events ORDER BY id DESC LIMIT 60`),
  ]);
  db.prepare('DELETE FROM events WHERE ts < ?1').bind(now - RETENTION_MS).run().catch(() => {});
  return json({
    generatedAt: now, liveWindowSeconds: LIVE_WINDOW_MS / 1000,
    live: live.results, totals: totals.results[0], daily: daily.results,
    countries: countries.results, devices: devices.results, pages: pages.results,
    referrers: refs.results, downloads: downloads.results, recent: recent.results,
  });
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function handleEventsCsv(env) {
  await ensureSchema(env.DB);
  const { results } = await env.DB.prepare(`SELECT ts, type, country, device, path, ref, meta FROM events ORDER BY id DESC LIMIT 20000`).all();
  const rows = [['Time (UTC)', 'Event', 'Country', 'Device', 'Page', 'Referrer', 'Detail']];
  for (const e of results) rows.push([new Date(e.ts).toISOString(), e.type, e.country, e.device, e.path, e.ref, e.meta]);
  return new Response('﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="gnosis-events-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

/* ------------------------------ router ------------------------------ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.DB) return json({ error: 'Analytics database is not connected. Add the D1 binding named DB.' }, 503);
    try {
      if (url.pathname === '/api/event') return await handleEvent(request, env);
      if (url.pathname.startsWith('/api/admin/')) {
        if (!env.ADMIN_TOKEN) return json({ error: 'ADMIN_TOKEN is not set on this Worker.' }, 503);
        if (!(await isAdmin(request, env))) return json({ error: 'Wrong or missing admin token.' }, 401);
        if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
        if (url.pathname === '/api/admin/summary') return await handleSummary(env);
        if (url.pathname === '/api/admin/events.csv') return await handleEventsCsv(env);
      }
      return json({ error: 'Not found.' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'Server error.' }, 500);
    }
  },
};
