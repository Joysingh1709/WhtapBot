// End-to-end: real server process + a fake Google. Covers sign-in, the OAuth flow used by MCP connectors,
// and that sessions/tokens survive a restart.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = 3200 + Math.floor(Math.random() * 500), MOCK = PORT + 1000;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-auth-'));
let server, mock, nextEmail = 'me@example.com';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
before(async () => {
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = new URLSearchParams(body);
      if (p.get('client_secret') !== 'sec' || !p.get('code_verifier')) { res.writeHead(400).end('{}'); return; }
      const { nonce } = JSON.parse(Buffer.from(p.get('code'), 'base64url').toString());
      const id_token = ['x', b64({ iss: 'https://accounts.google.com', aud: 'cid', nonce, email: nextEmail, email_verified: true, exp: Date.now() / 1000 + 600 }), 'y'].join('.');
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id_token }));
    });
  }).listen(MOCK);
  await start();
});
after(() => { server?.kill(); mock?.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

async function start() {
  server?.kill();
  server = spawn(process.execPath, ['--no-warnings', 'src/server.js'], {
    env: { ...process.env, DATA_DIR: dataDir, PORT, PUBLIC_URL: BASE, GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', ALLOWED_EMAILS: 'me@example.com',
      GOOGLE_AUTH_URL: `http://127.0.0.1:${MOCK}/auth`, GOOGLE_TOKEN_URL: `http://127.0.0.1:${MOCK}/token`, DISABLE_WHATSAPP: '1', MCP_TOKEN: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/healthz')).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

const get = (p, o = {}) => fetch(BASE + p, { redirect: 'manual', ...o });
const cookieOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const hasSession = (cookie) => /wb_session=[^;]+/.test(cookie);

/** Runs the browser side of "Sign in with Google" and returns where it ended up plus any session cookie. */
async function signIn(next = '/') {
  const s = await get('/auth/google/start?next=' + encodeURIComponent(next));
  const flowCookie = cookieOf(s);
  const g = new URL(s.headers.get('location'));
  const code = Buffer.from(JSON.stringify({ nonce: g.searchParams.get('nonce') })).toString('base64url');
  const cb = await get(`/auth/google/callback?code=${code}&state=${g.searchParams.get('state')}`, { headers: { cookie: flowCookie } });
  return { loc: cb.headers.get('location'), cookie: cookieOf(cb) };
}

test('the web app and API require sign-in', async () => {
  assert.equal((await get('/healthz')).status, 200);
  const home = await get('/');
  assert.equal(home.status, 302);
  assert.match(home.headers.get('location'), /^\/login\?next=/);
  assert.equal((await get('/api/messages')).status, 401);
  assert.equal((await get('/login')).status, 200);
  assert.equal((await get('/manifest.webmanifest')).status, 200);
});

test('only allowed Google accounts get in', async () => {
  nextEmail = 'stranger@example.com';
  const bad = await signIn();
  assert.match(bad.loc, /^\/login\?error=/);
  assert.ok(!hasSession(bad.cookie));
  nextEmail = 'me@example.com';
  const ok = await signIn('/');
  assert.equal(ok.loc, '/');
  assert.ok(hasSession(ok.cookie));
  assert.equal((await get('/api/status', { headers: { cookie: ok.cookie } })).status, 200);
  assert.equal((await (await get('/auth/me', { headers: { cookie: ok.cookie } })).json()).email, 'me@example.com');
  // cross-site writes are refused even with a valid cookie
  const x = await get('/api/messages', { method: 'POST', headers: { cookie: ok.cookie, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(x.status, 403);
});

test('a forged state is rejected', async () => {
  const s = await get('/auth/google/start');
  const cb = await get('/auth/google/callback?code=abc&state=forged', { headers: { cookie: cookieOf(s) } });
  assert.match(cb.headers.get('location'), /^\/login\?error=/);
});

let tokens, session, clientId;
test('MCP connector flow: discovery, registration, consent, PKCE token exchange, refresh', async () => {
  const unauth = await get('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get('www-authenticate'), /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/);
  const prm = await (await get('/.well-known/oauth-protected-resource')).json();
  assert.equal(prm.authorization_servers[0], BASE);
  const asm = await (await get('/.well-known/oauth-authorization-server')).json();
  assert.deepEqual(asm.code_challenge_methods_supported, ['S256']);

  const redirect = 'https://connector.example/callback';
  const reg = await get('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Test', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }) });
  assert.equal(reg.status, 201);
  clientId = (await reg.json()).client_id;
  assert.equal((await get('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) })).status, 400);

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'st1', scope: 'mcp' });

  // not signed in → bounced to login, then back
  const bounce = await get('/authorize?' + q);
  assert.match(bounce.headers.get('location'), /^\/login\?next=%2Fauthorize/);
  session = (await signIn('/authorize?' + q)).cookie;
  const consent = await get('/authorize?' + q, { headers: { cookie: session } });
  assert.equal(consent.status, 200);
  const html = await consent.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];
  assert.match(html, /connector\.example/);

  const form = (decision, token = csrf) => new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'st1', scope: 'mcp', csrf: token, decision });
  const post = (f) => get('/authorize', { method: 'POST', headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' }, body: f });
  assert.equal((await post(form('allow', 'wrong'))).status, 400); // CSRF token required
  const denied = new URL((await post(form('deny'))).headers.get('location'));
  assert.equal(denied.searchParams.get('error'), 'access_denied');
  const allowed = new URL((await post(form('allow'))).headers.get('location'));
  assert.equal(allowed.searchParams.get('state'), 'st1');
  const code = allowed.searchParams.get('code');

  const tokenReq = (extra) => get('/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, ...extra }) });
  // a wrong PKCE verifier fails, and burns the code
  assert.equal((await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: 'wrong-verifier' })).status, 400);
  assert.equal((await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier })).status, 400);

  const allowed2 = new URL((await post(form('allow'))).headers.get('location'));
  const ok = await tokenReq({ grant_type: 'authorization_code', code: allowed2.searchParams.get('code'), redirect_uri: redirect, code_verifier: verifier });
  assert.equal(ok.status, 200);
  tokens = await ok.json();
  assert.ok(tokens.access_token && tokens.refresh_token);
  assert.equal((await tokenReq({ grant_type: 'authorization_code', code: allowed2.searchParams.get('code'), redirect_uri: redirect, code_verifier: verifier })).status, 400);

  const rpc = (t) => get('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  const list = await rpc(tokens.access_token);
  assert.equal(list.status, 200);
  assert.ok((await list.json()).result.tools.length >= 7);
  assert.equal((await rpc('nope')).status, 401);

  const refreshed = await tokenReq({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  assert.equal(refreshed.status, 200);
  const old = tokens; tokens = await refreshed.json();
  assert.notEqual(tokens.refresh_token, old.refresh_token);
  assert.equal((await tokenReq({ grant_type: 'refresh_token', refresh_token: old.refresh_token })).status, 400); // rotated away
});

test('sign-ins and tokens survive a restart', async () => {
  await start();
  assert.equal((await get('/api/status', { headers: { cookie: session } })).status, 200);
  const r = await get('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tokens.access_token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
  assert.equal(r.status, 200);
});

test('signing out ends the session', async () => {
  const out = await get('/auth/logout', { method: 'POST', headers: { cookie: session } });
  assert.equal(out.status, 200);
  assert.equal((await get('/api/status', { headers: { cookie: session } })).status, 401);
});
