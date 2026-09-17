import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const root = new URL('../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');
const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text, { mode: 'transform', disableExperimentalWarning: true })).toString('base64')}`;
const coreUrl = moduleUrl(await source('app/onedrive-core.ts'));
const core = await import(coreUrl);

test('OneDrive API restricts actions to an authenticated Admin and matching origin', async () => {
  let session = null, operations = 0;
  globalThis.__odApi = {
    currentSession: async () => session,
    oneDriveSameOrigin: request => request.headers.get('Origin') === 'https://example.test',
    oneDriveStatus: async () => ({ connected: false }),
    beginOneDrive: async () => { operations++; return 'https://login.microsoftonline.com/test'; },
    disconnectOneDrive: async () => { operations++; },
    drainOneDrive: async () => { operations++; },
    retryOneDrive: async () => { operations++; },
    setBackupMode: async () => { operations++; },
  };
  const code = (await source('app/api/onedrive/route.ts'))
    .replace(/^import .*onedrive-server";$/m, 'const { beginOneDrive, disconnectOneDrive, drainOneDrive, oneDriveSameOrigin, oneDriveStatus, retryOneDrive, setBackupMode } = globalThis.__odApi;')
    .replace(/^import .*server-auth";$/m, 'const { currentSession } = globalThis.__odApi;');
  const api = await import(moduleUrl(code));
  const request = (origin = 'https://example.test') => new Request('https://example.test/api/onedrive', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'authorize' }) });
  try {
    assert.equal((await api.POST(request())).status, 401);
    for (const role of ['Tehnician', 'Manager', 'Coordonator']) {
      session = { sessionId: 'session', account: { role, passwordResetRequired: false } };
      assert.equal((await api.POST(request())).status, 403);
      assert.equal((await api.GET(new Request('https://example.test/api/onedrive'))).status, 403);
    }
    session.account = { role: 'Admin', passwordResetRequired: true };
    assert.equal((await api.POST(request())).status, 401);
    session.account.passwordResetRequired = false;
    assert.equal((await api.POST(request('https://evil.test'))).status, 403);
    assert.equal(operations, 0);
    const allowed = await api.POST(request());
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('Cache-Control'), 'no-store');
    assert.equal(operations, 1);
  } finally { delete globalThis.__odApi; }
});

test('provider selection, fixed origin, unique safe names, and retry delays', async () => {
  assert.equal(core.validMode('both'), true);
  assert.equal(core.validMode('arbitrary'), false);
  assert.equal(core.usesGoogle('onedrive'), false);
  assert.equal(core.usesOneDrive('google'), false);
  assert.equal(core.fixedOrigin('https://example.test/'), 'https://example.test');
  for (const origin of ['http://example.test', 'https://user:password@example.test', 'https://example.test/path']) assert.throws(() => core.fixedOrigin(origin));
  const a = await core.safeName('a/b:test?.jpg', 'file-a');
  assert.doesNotMatch(a, /[\\/:?]/);
  assert.match(a, /\.jpg$/);
  assert.equal(a, await core.safeName('a/b:test?.jpg', 'file-a'));
  assert.notEqual(a, await core.safeName('a/b:test?.jpg', 'file-b'));
  assert.equal(core.retryDelay(0, '120'), 120000);
  assert.ok(core.retryDelay(4) > core.retryDelay(1));
  assert.equal(core.retryDelay(100, '99999999'), 86400000);
});

test('OneDrive server with isolated SQLite, fake Microsoft responses and fake R2', async t => {
  const db = new DatabaseSync(':memory:');
  db.exec(await source('drizzle/0005_onedrive_backup.sql'));
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY, client TEXT, activity_type TEXT);
    CREATE TABLE project_files(id TEXT PRIMARY KEY, project_id TEXT, section TEXT, category TEXT, original_name TEXT, content_type TEXT, storage_key TEXT, geolocation TEXT, captured_at INTEGER, uploaded_by TEXT);
    CREATE TABLE project_reports(project_id TEXT, content_json TEXT);
    CREATE TABLE project_field_documentation(project_id TEXT, content_json TEXT);
    INSERT INTO projects VALUES ('RID-1', 'Test client', 'Instalare');
    INSERT INTO project_files VALUES ('f-1','RID-1','client','grounding','photo.jpg','image/jpeg','object-1','44,26',1,'tech');`);
  const env = {};
  const raw = { prepare(sql) { let values = []; return {
    bind(...args) { values = args; return this; },
    async first() { return db.prepare(sql).get(...values) ?? null; },
    async all() { return { results: db.prepare(sql).all(...values) }; },
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } }; },
  }; }, async batch(statements) { db.exec('BEGIN'); try { const r = []; for (const s of statements) r.push(await s.run()); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  globalThis.__od = {
    env,
    getRawDb: () => raw,
    getFileRow: async id => db.prepare('SELECT * FROM project_files WHERE id = ?').get(id),
    bucket: () => ({ get: async () => ({ body: new Blob(['photo']).stream() }) }),
    buildAcceptanceReportDocx: async () => new Uint8Array(),
    buildSpliceSheetXlsx: async () => new Uint8Array(),
    buildMaterialSheetPdf: async () => new Uint8Array(),
    buildOrangeQafXlsx: async () => new Uint8Array(),
  };
  let text = await source('app/onedrive-server.ts');
  text = text.replace('import { env } from "cloudflare:workers";', 'const { env } = globalThis.__od;')
    .replace('import { getRawDb } from "../db";', 'const { getRawDb } = globalThis.__od;')
    .replace('import { bucket, getFileRow } from "./project-server";', 'const { bucket, getFileRow } = globalThis.__od;')
    .replace('import { buildAcceptanceReportDocx } from "./report-docx";', 'const { buildAcceptanceReportDocx } = globalThis.__od;')
    .replace('import { buildSpliceSheetXlsx } from "./splice-xlsx";', 'const { buildSpliceSheetXlsx } = globalThis.__od;')
    .replace('import { buildMaterialSheetPdf } from "./material-pdf";', 'const { buildMaterialSheetPdf } = globalThis.__od;')
    .replace('import { buildOrangeQafXlsx } from "./orange-qaf";', 'const { buildOrangeQafXlsx } = globalThis.__od;')
    .replace('"./onedrive-core"', JSON.stringify(coreUrl));
  const server = await import(moduleUrl(text));
  const originalFetch = globalThis.fetch;
  let uploads = 0, tokenCalls = 0, failUpload = false, driveId = 'drive-1', onUpload;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).includes('/oauth2/v2.0/token')) {
      tokenCalls++;
      return Response.json({ access_token: 'fake-access', refresh_token: `fake-refresh-${tokenCalls}`, expires_in: 3600 });
    }
    assert.ok(String(url).startsWith('https://graph.microsoft.com/v1.0/me/drive'));
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer fake-access');
    if (String(url).endsWith('/me/drive')) return Response.json({ id: driveId, driveType: 'business', owner: { user: { id: 'owner', displayName: 'Test Microsoft' } } });
    if (String(url).endsWith('/content')) {
      uploads++;
      if (onUpload) { const callback = onUpload; onUpload = null; await callback(); }
      if (failUpload) return new Response('', { status: 429, headers: { 'Retry-After': '120' } });
      return Response.json({ id: 'uploaded-file' });
    }
    return Response.json({ id: 'folder', folder: {}, webUrl: 'https://example.sharepoint.com/folder' });
  };
  try {
    await t.test('missing configuration leaves Google unchanged', async () => {
      assert.equal(await server.backupMode(), 'google');
      assert.equal((await server.oneDriveStatus()).configured, false);
      await server.queueOneDrive('file', 'f-1');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM onedrive_jobs').get().n, 0);
    });
    Object.assign(env, { PROCONECT_APP_URL: 'https://example.test', ONEDRIVE_CLIENT_ID: '11111111-1111-1111-1111-111111111111', ONEDRIVE_TENANT_ID: '22222222-2222-2222-2222-222222222222', ONEDRIVE_CLIENT_SECRET: 'fake-test-secret', ONEDRIVE_ENCRYPTION_KEY: 'ab'.repeat(32) });
    await t.test('origin check does not trust the request host', () => {
      assert.equal(server.oneDriveSameOrigin(new Request('https://evil.test', { headers: { Origin: 'https://evil.test' } })), false);
      assert.equal(server.oneDriveSameOrigin(new Request('https://example.test', { headers: { Origin: 'https://example.test' } })), true);
    });
    let state;
    await t.test('OAuth uses PKCE, encrypted verifier, exact callback and session-bound one-use state', async () => {
      const url = new URL(await server.beginOneDrive('session-1')); state = url.searchParams.get('state');
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(url.searchParams.get('redirect_uri'), 'https://example.test/api/onedrive/callback');
      assert.equal(url.searchParams.get('scope'), 'offline_access https://graph.microsoft.com/Files.ReadWrite');
      assert.ok(db.prepare('SELECT verifier FROM onedrive_oauth_states').get().verifier.includes('.'));
      await assert.rejects(server.finishOneDrive('other-session', state, 'code'));
      assert.equal(tokenCalls, 0);
      await server.finishOneDrive('session-1', state, 'code');
      await assert.rejects(server.finishOneDrive('session-1', state, 'code'));
      const c = db.prepare('SELECT * FROM onedrive_connection').get();
      assert.equal(c.mode, 'google');
      assert.ok(!c.access_token.includes('fake-access'));
      assert.ok(!c.refresh_token.includes('fake-refresh'));
      assert.equal((await server.oneDriveStatus()).connected, true);
      assert.ok(!JSON.stringify(await server.oneDriveStatus()).includes('fake-access'));
    });
    await t.test('expired state rejected before token exchange', async () => {
      const u = new URL(await server.beginOneDrive('session-2'));
      db.exec('UPDATE onedrive_oauth_states SET expires_at = 0');
      await assert.rejects(server.finishOneDrive('session-2', u.searchParams.get('state'), 'code'));
      assert.equal(tokenCalls, 1);
    });
    await t.test('both destinations seed backlog; concurrent drains do not duplicate upload', async () => {
      await assert.rejects(server.setBackupMode('invalid'));
      await server.setBackupMode('both');
      assert.equal(await server.backupMode(), 'both');
      assert.equal((await server.oneDriveStatus()).pending, 1);
      await Promise.all([server.drainOneDrive(), server.drainOneDrive()]);
      assert.equal(uploads, 1);
      await server.drainOneDrive();
      assert.equal((await server.oneDriveStatus()).pending, 0);
      const decodedCalls = calls.map(value => decodeURIComponent(value));
      assert.ok(decodedCalls.some(value => value.includes(":/Instalări")));
      assert.ok(decodedCalls.some(value => value.includes(":/RID-1")));
      assert.ok(decodedCalls.some(value => value.includes(":/03_Client")));
      assert.ok(decodedCalls.every(value => !value.includes("Date_lucrare.json")));
      assert.ok(decodedCalls.every(value => !value.includes("RID-1--")));
    });
    await t.test('project metadata is not exported to OneDrive', async () => {
      await server.queueOneDrive('project', 'RID-1');
      assert.equal((await server.oneDriveStatus()).pending, 0);
      assert.ok(calls.every(value => !value.includes('Date_lucrare.json')));
    });
    await t.test('an edit during upload remains pending after the old revision finishes', async () => {
      await server.queueOneDrive('file', 'f-1');
      onUpload = () => server.queueOneDrive('file', 'f-1');
      await server.drainOneDrive();
      assert.equal((await server.oneDriveStatus()).pending, 1);
      await server.drainOneDrive();
      assert.equal((await server.oneDriveStatus()).pending, 0);
    });
    await t.test('rate limits persist error and retry time, then recover without duplicate job', async () => {
      await server.queueOneDrive('file', 'f-1'); failUpload = true;
      await server.drainOneDrive();
      const job = db.prepare("SELECT * FROM onedrive_jobs WHERE id = 'file:f-1'").get();
      assert.match(job.last_error, /429/);
      assert.ok(job.next_at > Date.now() + 110000);
      const before = uploads; await server.drainOneDrive(); assert.equal(uploads, before);
      failUpload = false; await server.retryOneDrive(); await server.drainOneDrive();
      await server.drainOneDrive();
      assert.equal((await server.oneDriveStatus()).errors.length, 0);
    });
    await t.test('expired tokens rotate refresh token securely', async () => {
      const before = db.prepare('SELECT refresh_token FROM onedrive_connection').get().refresh_token;
      db.exec('UPDATE onedrive_connection SET expires_at = 0');
      await server.queueOneDrive('file', 'f-1'); await server.drainOneDrive();
      assert.equal(tokenCalls, 2);
      assert.notEqual(db.prepare('SELECT refresh_token FROM onedrive_connection').get().refresh_token, before);
    });
    await t.test('switching Microsoft drive requires explicit disconnect', async () => {
      driveId = 'other-drive';
      const u = new URL(await server.beginOneDrive('session-3'));
      await assert.rejects(server.finishOneDrive('session-3', u.searchParams.get('state'), 'code'), /alt OneDrive/);
      assert.equal(db.prepare('SELECT drive_id FROM onedrive_connection').get().drive_id, 'drive-1');
    });
    await t.test('Google-only stops OneDrive; disconnect keeps remote copies', async () => {
      await server.setBackupMode('google');
      const before = uploads;
      await server.queueOneDrive('file', 'f-1'); await server.drainOneDrive();
      assert.equal(uploads, before);
      await server.setBackupMode('both');
      assert.equal((await server.oneDriveStatus()).pending, 1, 'reenabling refreshes project exports changed while paused');
      const callsBefore = calls.length;
      await server.disconnectOneDrive();
      assert.equal(calls.length, callsBefore);
      assert.equal((await server.oneDriveStatus()).connected, false);
      assert.equal(await server.backupMode(), 'google');
    });
  } finally { globalThis.fetch = originalFetch; delete globalThis.__od; db.close(); }
});
