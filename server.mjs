import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const CLIPS_DIR = path.join(DATA_DIR, 'clips');
const DB_FILE = path.join(DATA_DIR, 'workspace.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const PORT = Number(process.env.PORT || 8080);
const MAX_JSON = 4 * 1024 * 1024;
const MAX_CLIP = 512 * 1024 * 1024;
const authSessions = new Map();
const limits = new Map();
const authLimits = new Map();
const scrypt = promisify(scryptCallback);

await fs.mkdir(CLIPS_DIR, { recursive: true });
let accounts = [];
try {
  const loadedAccounts = JSON.parse(await fs.readFile(ACCOUNTS_FILE, 'utf8'));
  accounts = Array.isArray(loadedAccounts.accounts) ? loadedAccounts.accounts : [];
} catch {}
let db = { jobs: [], sessions: [] };
try {
  const loaded = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
  db = {
    jobs: Array.isArray(loaded.jobs) ? loaded.jobs.map(job => ({
      ...job,
      companyId: job.companyId || 'legacy-workspace',
      companyName: job.companyName || loaded.company && loaded.company.name || 'Interview Hub',
      companyEmail: job.companyEmail || loaded.company && loaded.company.email || ''
    })) : [],
    sessions: Array.isArray(loaded.sessions) ? loaded.sessions.map(session => {
      const job = Array.isArray(loaded.jobs) && loaded.jobs.find(item => item.id === session.jobId);
      return { ...session, companyId: session.companyId || job && (job.companyId || 'legacy-workspace') || null };
    }) : []
  };
} catch {}
async function saveDb() {
  const temp = DB_FILE + '.tmp';
  await fs.writeFile(temp, JSON.stringify(db), 'utf8');
  await fs.rename(temp, DB_FILE);
}
async function saveAccounts() {
  const temp = ACCOUNTS_FILE + '.tmp';
  await fs.writeFile(temp, JSON.stringify({ accounts }), 'utf8');
  await fs.rename(temp, ACCOUNTS_FILE);
}
function headers(res, type = 'application/json; charset=utf-8') {
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
}
function json(res, status, value) {
  headers(res);
  res.statusCode = status;
  res.end(JSON.stringify(value));
}
function cookieValue(req, key) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const item of cookies) {
    const split = item.trim().indexOf('=');
    if (split >= 0 && item.slice(0, split).trim() === key) return decodeURIComponent(item.slice(split + 1).trim());
  }
  return '';
}
function accountForRequest(req) {
  const token = cookieValue(req, 'ih_company');
  const session = authSessions.get(token);
  if (!token || !session || session.expiresAt < Date.now()) {
    if (token) authSessions.delete(token);
    return null;
  }
  return accounts.find(account => account.id === session.accountId) || null;
}
function secureCookie(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function setAuthCookie(req, res, token, maxAge) {
  const secure = secureCookie(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', 'ih_company=' + encodeURIComponent(token) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge + secure);
}
function ipKey(req) {
  return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}
function rateLimited(req, limit = 180, windowMs = 60000, bucket = limits) {
  const key = ipKey(req);
  const now = Date.now();
  let state = bucket.get(key);
  if (!state || now - state.start > windowMs) state = { start: now, count: 0 };
  state.count++;
  bucket.set(key, state);
  return state.count > limit;
}
async function readJson(req, max = MAX_JSON) {
  const length = Number(req.headers['content-length'] || 0);
  if (length > max) { req.resume(); const error = new Error('Request body is too large.'); error.status = 413; throw error; }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) { const error = new Error('Request body is too large.'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { const error = new Error('Invalid JSON request.'); error.status = 400; throw error; }
}
function safeId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function findSession(id) { return db.sessions.find(item => item.id === id); }
function notFound(res) { json(res, 404, { error: 'Not found.' }); }
function publicAccount(account) {
  return { id: account.id, companyName: account.companyName, email: account.email };
}
function publicWorkspace() {
  const jobs = db.jobs.filter(job => job.active !== false).map(job => ({
    id: job.id, title: job.title, companyName: job.companyName || '',
    seniority: job.seniority || '', domain: job.domain || '',
    description: job.description || '', competencies: job.competencies || [], active: true
  }));
  return { company: null, jobs, companyJobs: [] };
}
function recruiterWorkspace(account) {
  const jobs = db.jobs.filter(job => job.companyId === account.id);
  const sessions = db.sessions.filter(item => item.companyId === account.id && item.contactSubmitted === true && item.contactShareConsent === true);
  return {
    company: { id: account.id, name: account.companyName, email: account.email },
    jobs, companyJobs: jobs, sessions
  };
}
async function createAuthSession(req, res, account) {
  const token = randomBytes(32).toString('base64url');
  authSessions.set(token, { accountId: account.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  setAuthCookie(req, res, token, 43200);
  return { authenticated: true, account: publicAccount(account) };
}
async function storeClip(req, res, sessionId, clipId) {
  if (!safeId(sessionId) || !safeId(clipId)) return notFound(res);
  const session = findSession(sessionId);
  const signalId = String(req.headers['x-signal-id'] || '');
  if (!session || session.contactSubmitted !== true || session.contactShareConsent !== true || !session.companyId) return json(res, 403, { error: 'Candidate has not shared this application for an active company role.' });
  if (signalId === 'full-session-recording') {
    if (session.fullRecordingConsent !== true || !session.fullRecording || session.fullRecording.clipId !== clipId || session.fullRecording.status !== 'saved') return json(res, 403, { error: 'Full-session recording consent or metadata is missing.' });
  } else {
    const signal = (session.signals || []).find(item => item.id === signalId);
    if (session.clipConsent !== true || !signal || (signal.clipId && signal.clipId !== clipId)) return json(res, 403, { error: 'Review clip consent or signal metadata is missing.' });
  }
  const contentType = String(req.headers['content-type'] || 'video/webm').split(';')[0].trim().toLowerCase();
  if (!contentType.startsWith('video/')) { req.resume(); return json(res, 415, { error: 'Only video clips are accepted.' }); }
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_CLIP) { req.resume(); return json(res, 413, { error: 'Recording exceeds the 512 MB per-file limit.' }); }
  const folder = path.join(CLIPS_DIR, sessionId);
  await fs.mkdir(folder, { recursive: true });
  const target = path.join(folder, clipId + '.media');
  const temp = target + '.tmp';
  let bytes = 0;
  const meter = new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length;
    if (bytes > MAX_CLIP) return callback(Object.assign(new Error('Recording exceeds the 512 MB per-file limit.'), { status: 413 }));
    callback(null, chunk);
  }});
  try {
    await pipeline(req, meter, createWriteStream(temp, { flags: 'w' }));
    if (!bytes) { await fs.rm(temp, { force: true }); return json(res, 400, { error: 'Empty recording.' }); }
    await fs.rename(temp, target);
    const media = { clipId, signalId, type: contentType, bytes, uploadedAt: new Date().toISOString() };
    session.media = Object.assign({}, session.media || {}, { [clipId]: media });
    if (signalId === 'full-session-recording') session.fullRecording.clipStorage = 'server';
    else {
      const signal = (session.signals || []).find(item => item.id === signalId);
      if (signal) signal.clipStorage = 'server';
    }
    await saveDb();
    json(res, 201, { saved: true, bytes });
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    if (!res.headersSent && !res.destroyed) json(res, error.status || 500, { error: error.status === 413 ? error.message : 'Could not store the recording on this laptop.' });
  }
}
async function serveClip(req, res, sessionId, clipId) {
  const account = accountForRequest(req);
  if (!account) return json(res, 401, { error: 'Company login required.' });
  const session = findSession(sessionId);
  const media = session && session.media && session.media[clipId];
  if (!session || session.companyId !== account.id || !media || !safeId(sessionId) || !safeId(clipId)) return notFound(res);
  const file = path.join(CLIPS_DIR, sessionId, clipId + '.media');
  let stat;
  try { stat = await fs.stat(file); } catch { return notFound(res); }
  headers(res, media.type || 'video/webm');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', 'inline; filename="' + clipId + '.webm"');
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) { res.statusCode = 416; return res.end(); }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) { res.statusCode = 416; return res.end(); }
    res.statusCode = 206;
    res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + stat.size);
    res.setHeader('Content-Length', end - start + 1);
    return createReadStream(file, { start, end }).pipe(res);
  }
  createReadStream(file).pipe(res);
}
const server = http.createServer(async (req, res) => {
  try {
    headers(res, 'application/json; charset=utf-8');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index2.html')) {
      headers(res, 'text/html; charset=utf-8');
      res.statusCode = 200;
      return res.end(await fs.readFile(path.join(ROOT, 'index2.html')));
    }
    if (req.method === 'GET' && url.pathname === '/LEGAL_DRAFT.md') {
      headers(res, 'text/plain; charset=utf-8');
      res.statusCode = 200;
      return res.end(await fs.readFile(path.join(ROOT, 'LEGAL_DRAFT.md')));
    }
    if (!url.pathname.startsWith('/api/')) return notFound(res);
    if (rateLimited(req, req.method === 'GET' ? 360 : 180)) return json(res, 429, { error: 'Too many requests. Try again in a minute.' });

    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { aiEnabled: false, storage: 'laptop', companyAccounts: true });
    if (req.method === 'GET' && url.pathname === '/api/workspace') return json(res, 200, publicWorkspace());
    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const account = accountForRequest(req);
      return json(res, 200, { authenticated: !!account, account: account ? publicAccount(account) : null });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/signup') {
      if (rateLimited(req, 12, 60000, authLimits)) return json(res, 429, { error: 'Too many signup attempts. Try again in a minute.' });
      const body = await readJson(req, 8192);
      const companyName = String(body.companyName || '').trim().slice(0, 120);
      const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
      const password = String(body.password || '');
      if (companyName.length < 2) return json(res, 400, { error: 'Enter your company name.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Enter a valid company email address.' });
      if (password.length < 12 || password.length > 256) return json(res, 400, { error: 'Use a password between 12 and 256 characters.' });
      if (accounts.some(account => account.email === email)) return json(res, 409, { error: 'An account already exists for that email. Sign in instead.' });
      const salt = randomBytes(16).toString('hex');
      const passwordHash = Buffer.from(await scrypt(password, salt, 64)).toString('hex');
      const account = {
        id: randomBytes(16).toString('hex'),
        companyName, email, salt, passwordHash,
        createdAt: new Date().toISOString()
      };
      accounts.push(account);
      await saveAccounts();
      return json(res, 201, await createAuthSession(req, res, account));
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      if (rateLimited(req, 18, 60000, authLimits)) return json(res, 429, { error: 'Too many login attempts. Try again in a minute.' });
      const body = await readJson(req, 8192);
      const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
      const password = String(body.password || '');
      const account = accounts.find(item => item.email === email);
      if (!account || password.length > 256) return json(res, 401, { error: 'Company email or password is incorrect.' });
      const actual = Buffer.from(await scrypt(password, account.salt, 64));
      const expected = Buffer.from(account.passwordHash, 'hex');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json(res, 401, { error: 'Company email or password is incorrect.' });
      return json(res, 200, await createAuthSession(req, res, account));
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      const token = cookieValue(req, 'ih_company');
      authSessions.delete(token);
      setAuthCookie(req, res, '', 0);
      return json(res, 200, { authenticated: false });
    }
    if (req.method === 'GET' && url.pathname === '/api/recruiter/workspace') {
      const account = accountForRequest(req);
      if (!account) return json(res, 401, { error: 'Company login required.' });
      return json(res, 200, recruiterWorkspace(account));
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const account = accountForRequest(req);
      if (!account) return json(res, 401, { error: 'Company login required.' });
      const input = await readJson(req, 32 * 1024);
      if (!safeId(input.id) || !String(input.title || '').trim()) return json(res, 400, { error: 'A job title is required.' });
      const job = {
        ...input,
        id: input.id,
        companyId: account.id,
        companyName: account.companyName,
        companyEmail: account.email,
        title: String(input.title).trim().slice(0, 100),
        domain: String(input.domain || '').trim().slice(0, 180),
        description: String(input.description || '').trim().slice(0, 3000),
        competencies: Array.isArray(input.competencies) ? input.competencies.map(item => String(item).trim().slice(0, 120)).filter(Boolean).slice(0, 40) : [],
        active: input.active !== false
      };
      const index = db.jobs.findIndex(item => item.id === job.id && item.companyId === account.id);
      if (index >= 0) db.jobs[index] = job;
      else if (db.jobs.some(item => item.id === job.id)) return json(res, 409, { error: 'That job identifier is already in use.' });
      else db.jobs.unshift(job);
      await saveDb();
      return json(res, index >= 0 ? 200 : 201, { job });
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs/status') {
      const account = accountForRequest(req);
      if (!account) return json(res, 401, { error: 'Company login required.' });
      const body = await readJson(req, 4096);
      const job = db.jobs.find(item => item.id === body.id && item.companyId === account.id);
      if (!job) return notFound(res);
      job.active = body.active === true;
      await saveDb();
      return json(res, 200, { job });
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const body = await readJson(req, MAX_JSON);
      if (!safeId(body.id) || body.consentReview !== true) return json(res, 400, { error: 'Session ID and transcript-review consent are required.' });
      const old = findSession(body.id);
      const jobId = safeId(body.jobId) ? body.jobId : null;
      if (old && old.jobId !== jobId) return json(res, 409, { error: 'This interview session cannot be moved to another role.' });
      const job = jobId ? db.jobs.find(item => item.id === jobId) : null;
      if (jobId && !job) return json(res, 400, { error: 'The selected role is no longer available.' });
      const session = {
        ...body,
        jobId: old && old.jobId || job && job.id || null,
        companyId: old && old.companyId || job && job.companyId || null,
        companyName: job && job.companyName || old && old.companyName || '',
        media: old && old.media || body.media || {},
        hiringDecision: old && old.hiringDecision || ''
      };
      const index = db.sessions.findIndex(item => item.id === session.id);
      if (index >= 0) db.sessions[index] = session; else db.sessions.unshift(session);
      if (db.sessions.length > 2000) db.sessions.length = 2000;
      await saveDb();
      return json(res, 200, { saved: true });
    }
    const clipRoute = /^\/api\/sessions\/([A-Za-z0-9_-]{1,128})\/clips\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    if (clipRoute && req.method === 'POST') return await storeClip(req, res, clipRoute[1], clipRoute[2]);
    if (clipRoute && req.method === 'GET') return await serveClip(req, res, clipRoute[1], clipRoute[2]);
    const decisionRoute = /^\/api\/sessions\/([A-Za-z0-9_-]{1,128})\/decision$/.exec(url.pathname);
    if (decisionRoute && req.method === 'POST') {
      const account = accountForRequest(req);
      if (!account) return json(res, 401, { error: 'Company login required.' });
      const session = findSession(decisionRoute[1]);
      if (!session || session.companyId !== account.id) return notFound(res);
      const body = await readJson(req, 4096);
      session.hiringDecision = String(body.decision || '').slice(0, 80);
      await saveDb();
      return json(res, 200, { saved: true });
    }
    if (req.method === 'DELETE' && url.pathname === '/api/sessions') {
      const account = accountForRequest(req);
      if (!account) return json(res, 401, { error: 'Company login required.' });
      const ownedSessions = db.sessions.filter(item => item.companyId === account.id);
      db.sessions = db.sessions.filter(item => item.companyId !== account.id);
      await saveDb();
      for (const item of ownedSessions) await fs.rm(path.join(CLIPS_DIR, item.id), { recursive: true, force: true });
      return json(res, 200, { deleted: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/interview/turn') return json(res, 503, { error: 'AI service is not configured. The local role-aware interviewer can continue without AI scoring.' });
    return notFound(res);
  } catch (error) {
    if (!res.headersSent && !res.destroyed) json(res, error.status || 500, { error: error.status ? error.message : 'The laptop server could not complete this request.' });
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('Interview Hub server listening on http://127.0.0.1:' + PORT);
  console.log('Company accounts, interviews, and video files are stored under: ' + DATA_DIR);
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
