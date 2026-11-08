// Sign-in for the web app (Google) and an OAuth 2.1 authorization server for MCP connectors.
// Everything durable (sessions, registered clients, tokens) lives in SQLite on the data volume,
// so restarts and redeploys do not sign anyone out.
import crypto from 'node:crypto';
import express from 'express';
import { db } from './db.js';
import {
  PUBLIC_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_EMAILS, AUTH_ENABLED, SESSION_DAYS,
  GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL,
} from './config.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY, secret_hash TEXT, name TEXT, redirect_uris TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL,
    email TEXT NOT NULL, scope TEXT, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT NOT NULL, email TEXT NOT NULL,
    scope TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
`);

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const eq = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const q = {
  sessAdd: db.prepare('INSERT INTO sessions (id_hash, email, created_at, expires_at) VALUES (?,?,?,?)'),
  sessGet: db.prepare('SELECT * FROM sessions WHERE id_hash=? AND expires_at > ?'),
  sessDel: db.prepare('DELETE FROM sessions WHERE id_hash=?'),
  clientAdd: db.prepare('INSERT INTO oauth_clients (client_id, secret_hash, name, redirect_uris, created_at) VALUES (?,?,?,?,?)'),
  clientGet: db.prepare('SELECT * FROM oauth_clients WHERE client_id=?'),
  clientCount: db.prepare('SELECT COUNT(*) AS n FROM oauth_clients'),
  clientPrune: db.prepare('DELETE FROM oauth_clients WHERE client_id IN (SELECT client_id FROM oauth_clients ORDER BY created_at ASC LIMIT ?)'),
  codeAdd: db.prepare('INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, challenge, email, scope, expires_at) VALUES (?,?,?,?,?,?,?)'),
  codeTake: db.prepare('DELETE FROM oauth_codes WHERE code_hash=? RETURNING *'),
  tokAdd: db.prepare('INSERT INTO oauth_tokens (token_hash, kind, client_id, email, scope, created_at, expires_at) VALUES (?,?,?,?,?,?,?)'),
  tokGet: db.prepare('SELECT * FROM oauth_tokens WHERE token_hash=? AND kind=? AND expires_at > ?'),
  tokTake: db.prepare('DELETE FROM oauth_tokens WHERE token_hash=? AND kind=? RETURNING *'),
  gc: [
    db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?'),
    db.prepare('DELETE FROM oauth_tokens WHERE expires_at < ?'),
  ],
};
setInterval(() => q.gc.forEach((s) => s.run(Date.now())), 3600_000).unref();

/* ---------- cookies ---------- */
const SESSION_COOKIE = 'wb_session', FLOW_COOKIE = 'wb_flow';
const parseCookies = (req) => Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
const secure = PUBLIC_URL.startsWith('https://');
const setCookie = (res, name, value, maxAgeSec) =>
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
const clearCookie = (res, name) => setCookie(res, name, '', 0);

export function sessionFrom(req) {
  const id = parseCookies(req)[SESSION_COOKIE];
  return id ? q.sessGet.get(sha(id), Date.now()) ?? null : null;
}
function startSession(res, email) {
  const id = rand(32);
  q.sessAdd.run(sha(id), email, Date.now(), Date.now() + SESSION_DAYS * 86400_000);
  setCookie(res, SESSION_COOKIE, id, SESSION_DAYS * 86400);
}
const csrfFor = (session) => crypto.createHmac('sha256', session.id_hash).update('consent').digest('base64url');

/* ---------- tiny rate limiter (per client IP) ---------- */
const hits = new Map();
const limit = (max, windowMs = 60_000) => (req, res, next) => {
  const key = `${req.path}|${req.ip}`, now = Date.now();
  const h = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (h.length >= max) return res.status(429).json({ error: 'too_many_requests' });
  h.push(now); hits.set(key, h);
  if (hits.size > 5000) hits.clear();
  next();
};

/* ---------- pages ---------- */
const PAGE_CSS = `:root{color-scheme:light dark;--bg:#f5f8fc;--fg:#101820;--card:#fff;--mut:#5b6b7a;--acc:#128c4a;--bd:#d9e1ea}
@media(prefers-color-scheme:dark){:root{--bg:#0f141a;--fg:#e8eef4;--card:#18212b;--mut:#9fb0c0;--acc:#25d366;--bd:#2a3744}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
main{background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:28px;max-width:420px;width:100%}
h1{font-size:22px;margin:0 0 6px}p{color:var(--mut);margin:8px 0 18px}.btn{display:block;width:100%;box-sizing:border-box;text-align:center;padding:14px;border-radius:12px;border:1px solid var(--bd);background:var(--card);color:var(--fg);font:600 16px system-ui;text-decoration:none;cursor:pointer;min-height:48px}
.btn.go{background:var(--acc);color:#fff;border-color:var(--acc)}.row{display:flex;gap:10px}.row>*{flex:1}code{background:var(--bg);padding:2px 6px;border-radius:6px;word-break:break-all}.err{color:#d93025}`;
const page = (title, body, status = 200) => ({ status, html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body><main>${body}</main></body></html>` });
const send = (res, p) => res.status(p.status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).send(p.html);

const safeNext = (n) => (typeof n === 'string' && /^\/(?![\/\\])/.test(n) ? n : '/');

/* ---------- router ---------- */
export const authRouter = express.Router();
authRouter.use(express.urlencoded({ extended: false, limit: '20kb' }));

authRouter.get('/login', (req, res) => {
  const next = safeNext(req.query.next);
  const msg = req.query.error ? `<p class="err">${esc(req.query.error)}</p>` : '';
  send(res, page('Sign in – WhtapBot', `<h1>WhtapBot</h1><p>Sign in to manage your scheduled WhatsApp messages.</p>${msg}<a class="btn go" href="/auth/google/start?next=${encodeURIComponent(next)}">Sign in with Google</a>`));
});

authRouter.get('/auth/google/start', limit(20), (req, res) => {
  const flow = { state: rand(16), verifier: rand(32), nonce: rand(16), next: safeNext(req.query.next) };
  setCookie(res, FLOW_COOKIE, JSON.stringify(flow), 600);
  const u = new URL(GOOGLE_AUTH_URL);
  u.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: `${PUBLIC_URL}/auth/google/callback`, response_type: 'code',
    scope: 'openid email', state: flow.state, nonce: flow.nonce, prompt: 'select_account',
    code_challenge: crypto.createHash('sha256').update(flow.verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString();
  res.redirect(u.toString());
});

authRouter.get('/auth/google/callback', limit(20), async (req, res) => {
  const fail = (m) => res.redirect('/login?error=' + encodeURIComponent(m));
  let flow;
  try { flow = JSON.parse(parseCookies(req)[FLOW_COOKIE] ?? ''); } catch { return fail('Sign-in expired. Please try again.'); }
  clearCookie(res, FLOW_COOKIE);
  if (req.query.error) return fail('Google sign-in was cancelled.');
  if (!flow?.state || !eq(String(req.query.state ?? ''), flow.state)) return fail('Sign-in could not be verified. Please try again.');
  try {
    const r = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code ?? ''), client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${PUBLIC_URL}/auth/google/callback`, grant_type: 'authorization_code', code_verifier: flow.verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) return fail('Google refused the sign-in.');
    // The ID token arrives straight from Google over TLS in exchange for our secret, so its claims can be trusted (OIDC Core 3.1.3.7).
    const claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString());
    const issOk = ['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) || GOOGLE_AUTH_URL !== 'https://accounts.google.com/o/oauth2/v2/auth';
    const email = String(claims.email ?? '').toLowerCase();
    if (claims.aud !== GOOGLE_CLIENT_ID || !issOk || claims.nonce !== flow.nonce || claims.exp * 1000 < Date.now() || claims.email_verified !== true) {
      return fail('Google sign-in could not be verified.');
    }
    if (!ALLOWED_EMAILS.includes(email)) return fail(`${email} is not allowed to use this app.`);
    startSession(res, email);
    res.redirect(flow.next);
  } catch (err) {
    console.error('[auth] google callback failed', err.message);
    fail('Sign-in failed. Please try again.');
  }
});

authRouter.post('/auth/logout', (req, res) => {
  const id = parseCookies(req)[SESSION_COOKIE];
  if (id) q.sessDel.run(sha(id));
  clearCookie(res, SESSION_COOKIE);
  res.json({ ok: true });
});
authRouter.get('/auth/me', (req, res) => {
  const s = sessionFrom(req);
  s ? res.json({ email: s.email }) : res.status(401).json({ error: 'Not signed in.' });
});

/* ---------- OAuth authorization server for MCP connectors ---------- */
const SCOPE = 'mcp';
const ACCESS_TTL = 3600_000, REFRESH_TTL = 90 * 86400_000, CODE_TTL = 120_000;
const metaUrl = `${PUBLIC_URL}/.well-known/oauth-protected-resource`;
export const wwwAuthenticate = `Bearer resource_metadata="${metaUrl}"`;

const protectedResource = (_req, res) => res.json({
  resource: `${PUBLIC_URL}/mcp`, authorization_servers: [PUBLIC_URL], bearer_methods_supported: ['header'], scopes_supported: [SCOPE],
  resource_name: 'WhtapBot',
});
authRouter.get('/.well-known/oauth-protected-resource', protectedResource);
authRouter.get('/.well-known/oauth-protected-resource/mcp', protectedResource);
authRouter.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({
  issuer: PUBLIC_URL,
  authorization_endpoint: `${PUBLIC_URL}/authorize`,
  token_endpoint: `${PUBLIC_URL}/token`,
  registration_endpoint: `${PUBLIC_URL}/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  scopes_supported: [SCOPE],
}));

const validRedirect = (u) => {
  try {
    const x = new URL(u);
    if (x.hash) return false;
    if (x.protocol === 'https:') return true;
    return x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname);
  } catch { return false; }
};

// Dynamic client registration (RFC 7591): connectors register themselves before asking you to sign in.
authRouter.post('/register', limit(10), express.json({ limit: '20kb' }), (req, res) => {
  const b = req.body ?? {};
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  if (!uris.length || uris.length > 10 || !uris.every((u) => typeof u === 'string' && validRedirect(u))) {
    return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Provide 1–10 https (or localhost) redirect URIs.' });
  }
  if (q.clientCount.get().n >= 200) q.clientPrune.run(50);
  const wantsSecret = b.token_endpoint_auth_method === 'client_secret_post';
  const id = rand(18), secret = wantsSecret ? rand(32) : null;
  q.clientAdd.run(id, secret ? sha(secret) : null, String(b.client_name ?? 'MCP client').slice(0, 80), JSON.stringify(uris), Date.now());
  res.status(201).json({
    client_id: id, ...(secret ? { client_secret: secret } : {}), client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: String(b.client_name ?? 'MCP client').slice(0, 80), redirect_uris: uris,
    token_endpoint_auth_method: secret ? 'client_secret_post' : 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
  });
});

function authzParams(src) {
  const p = Object.fromEntries(['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope'].map((k) => [k, typeof src[k] === 'string' ? src[k] : '']));
  const client = p.client_id ? q.clientGet.get(p.client_id) : null;
  if (!client) return { fatal: 'Unknown application. Remove and re-add the connector, then try again.' };
  if (!JSON.parse(client.redirect_uris).includes(p.redirect_uri)) return { fatal: 'This application used a redirect address it did not register.' };
  return { p, client };
}
const redirectBack = (res, uri, params) => { const u = new URL(uri); for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v); res.redirect(u.toString()); };

authRouter.get('/authorize', (req, res) => {
  const { p, client, fatal } = authzParams(req.query);
  if (fatal) return send(res, page('Cannot continue', `<h1>Cannot continue</h1><p class="err">${esc(fatal)}</p>`, 400));
  if (p.response_type !== 'code') return redirectBack(res, p.redirect_uri, { error: 'unsupported_response_type', state: p.state });
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return redirectBack(res, p.redirect_uri, { error: 'invalid_request', error_description: 'PKCE with S256 is required.', state: p.state });

  const session = sessionFrom(req);
  if (!session) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));

  const host = new URL(p.redirect_uri).host;
  const hidden = Object.entries(p).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('');
  send(res, page('Allow access – WhtapBot', `<h1>Allow access?</h1>
    <p><b>${esc(client.name)}</b> (returns to <code>${esc(host)}</code>) wants to schedule, edit, send and cancel WhatsApp messages from your number, signed in as <b>${esc(session.email)}</b>.</p>
    <form method="post" action="/authorize">${hidden}<input type="hidden" name="csrf" value="${csrfFor(session)}">
      <div class="row"><button class="btn" name="decision" value="deny">Deny</button><button class="btn go" name="decision" value="allow">Allow</button></div></form>`));
});

authRouter.post('/authorize', limit(30), (req, res) => {
  const { p, fatal } = authzParams(req.body ?? {});
  if (fatal) return send(res, page('Cannot continue', `<h1>Cannot continue</h1><p class="err">${esc(fatal)}</p>`, 400));
  const session = sessionFrom(req);
  if (!session || !eq(req.body?.csrf ?? '', csrfFor(session))) return send(res, page('Session expired', '<h1>Session expired</h1><p>Please start the connection again.</p>', 400));
  if (req.body.decision !== 'allow') return redirectBack(res, p.redirect_uri, { error: 'access_denied', state: p.state });
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return redirectBack(res, p.redirect_uri, { error: 'invalid_request', state: p.state });
  const code = rand(32);
  q.codeAdd.run(sha(code), p.client_id, p.redirect_uri, p.code_challenge, session.email, SCOPE, Date.now() + CODE_TTL);
  redirectBack(res, p.redirect_uri, { code, state: p.state });
});

function issueTokens(client_id, email) {
  const access = rand(32), refresh = rand(32), now = Date.now();
  q.tokAdd.run(sha(access), 'access', client_id, email, SCOPE, now, now + ACCESS_TTL);
  q.tokAdd.run(sha(refresh), 'refresh', client_id, email, SCOPE, now, now + REFRESH_TTL);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: SCOPE };
}

authRouter.post('/token', limit(60), (req, res) => {
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  const b = req.body ?? {};
  const err = (e, d, s = 400) => res.status(s).json({ error: e, error_description: d });

  // Client authentication (public clients send only client_id; confidential ones add the secret).
  let clientId = b.client_id, secret = b.client_secret;
  const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '');
  if (basic) { const [i, ...s] = Buffer.from(basic[1], 'base64').toString().split(':'); clientId ||= decodeURIComponent(i); secret ||= decodeURIComponent(s.join(':')); }
  const client = clientId ? q.clientGet.get(clientId) : null;
  if (!client) return err('invalid_client', 'Unknown client.', 401);
  if (client.secret_hash && !(secret && eq(sha(secret), client.secret_hash))) return err('invalid_client', 'Bad client secret.', 401);

  if (b.grant_type === 'authorization_code') {
    const row = q.codeTake.get(sha(b.code ?? ''));
    if (!row || row.client_id !== client.client_id || row.expires_at < Date.now() || row.redirect_uri !== b.redirect_uri) return err('invalid_grant', 'Code is invalid or expired.');
    const challenge = crypto.createHash('sha256').update(String(b.code_verifier ?? '')).digest('base64url');
    if (!b.code_verifier || !eq(challenge, row.challenge)) return err('invalid_grant', 'PKCE verification failed.');
    return res.json(issueTokens(client.client_id, row.email));
  }
  if (b.grant_type === 'refresh_token') {
    const row = q.tokTake.get(sha(b.refresh_token ?? ''), 'refresh');
    if (!row || row.client_id !== client.client_id || row.expires_at < Date.now()) return err('invalid_grant', 'Refresh token is invalid or expired.');
    return res.json(issueTokens(client.client_id, row.email)); // refresh tokens rotate
  }
  err('unsupported_grant_type', 'Use authorization_code or refresh_token.');
});

/** Valid OAuth access token → { email } (used by /mcp). */
export function verifyAccessToken(token) {
  const row = token ? q.tokGet.get(sha(token), 'access', Date.now()) : null;
  return row ? { email: row.email, clientId: row.client_id } : null;
}

/* ---------- gate for the web app and its API ---------- */
const PUBLIC_PATHS = [/^\/login$/, /^\/auth\//, /^\/\.well-known\//, /^\/register$/, /^\/authorize$/, /^\/token$/, /^\/mcp$/, /^\/manifest\.webmanifest$/, /^\/icons\//];

export function requireSignIn(req, res, next) {
  if (!AUTH_ENABLED || PUBLIC_PATHS.some((r) => r.test(req.path))) return next();
  // Browsers only; stops cross-site pages from driving the API with your cookie.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && origin !== new URL(PUBLIC_URL).origin) return res.status(403).json({ error: 'Cross-site request blocked.' });
  }
  const s = sessionFrom(req);
  if (s) { req.user = s; return next(); }
  if (req.path.startsWith('/api/') || req.method !== 'GET') return res.status(401).json({ error: 'Please sign in again.' });
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

export { AUTH_ENABLED };
