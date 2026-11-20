'use strict';
const express = require('express');
const helmet = require('helmet');
const { canAccess } = require('./domain/access.cjs');

// Dependencies are server-owned; browser data never supplies roles or memberships.
function createApp({ authFlow, repository, limit, allowedOrigin }) {
  if (!authFlow || !repository || typeof limit !== 'function' || typeof allowedOrigin !== 'string') throw new TypeError('Server configuration missing');
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== allowedOrigin) return res.status(403).json({ error: 'Yêu cầu không hợp lệ.' });
    next();
  });
  const bearer = req => /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '')?.[1];
  const session = req => /(?:^|;\s*)__session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.get('cookie') || '')?.[1];
  const secureCookie = token => `__session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`;
  const attempt = operation => async (req, res, next) => { try { await operation(req, res, next); } catch (e) { next(e); } };
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.post('/api/auth/begin', attempt(async (req, res) => {
    if (!await limit(req, 'otp-begin')) return res.status(429).json({ error: 'Vui lòng thử lại sau.' });
    const result = await authFlow.begin(bearer(req));
    res.json(result);
  }));
  app.post('/api/auth/complete', attempt(async (req, res) => {
    if (!await limit(req, 'otp-complete')) return res.status(429).json({ error: 'Vui lòng thử lại sau.' });
    const result = await authFlow.complete(bearer(req), req.body?.challengeId, req.body?.code);
    res.set('Set-Cookie', secureCookie(result.token));
    res.json({ ok: true, expiresAt: result.expiresAt });
  }));
  app.post('/api/auth/logout', attempt(async (req, res) => {
    await authFlow.logout(session(req));
    res.set('Set-Cookie', '__session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    res.json({ ok: true });
  }));
  app.use('/api', attempt(async (req, res, next) => {
    const verified = await authFlow.authenticate(session(req));
    if (!verified) return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
    const actor = await repository.actor(verified.uid);
    if (!actor || actor.status !== 'active') return res.status(403).json({ error: 'Tài khoản chưa được cấp quyền.' });
    req.actor = actor;
    next();
  }));
  app.get('/api/me', (req, res) => res.json({ uid: req.actor.uid, name: req.actor.name || '', roles: req.actor.roles }));
  app.get('/api/classes', attempt(async (req, res) => { res.json({ items: await repository.classesFor(req.actor) }); }));
  app.get('/api/classes/:classId', attempt(async (req, res) => {
    const item = await repository.getClass(req.params.classId);
    if (!item || !canAccess(req.actor, 'class.read', { classId: req.params.classId, studentId: req.actor.studentId })) return res.status(404).json({ error: 'Không tìm thấy lớp học.' });
    res.json({ item });
  }));
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Dữ liệu quá lớn.' });
    if (err instanceof SyntaxError && err.status === 400) return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
    res.status(400).json({ error: 'Không thể xử lý yêu cầu. Vui lòng kiểm tra thông tin và thử lại.' });
  });
  return app;
}
module.exports = { createApp };

