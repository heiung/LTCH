'use strict';
const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { createApp } = require('./server/app.cjs');
const { createOtpService } = require('./server/domain/otp.cjs');
const { createAuthFlow } = require('./server/domain/auth-flow.cjs');
const { createFirestoreOtpStore } = require('./server/integrations/firestore-otp-store.cjs');
const { createFirestoreSessionStore } = require('./server/integrations/firestore-session-store.cjs');
const { createRateLimiter } = require('./server/integrations/firestore-rate-limit.cjs');
const { createRepository } = require('./server/integrations/firestore-repository.cjs');
const { sendOtpEmail } = require('./server/integrations/apps-script-mail.cjs');
const otpSecret = defineSecret('LTCH_OTP_SECRET');
const mailSecret = defineSecret('LTCH_MAIL_SECRET');
const mailEndpoint = defineSecret('LTCH_MAIL_ENDPOINT');
exports.api = onRequest({ region: 'asia-southeast1', secrets: [otpSecret, mailSecret, mailEndpoint], maxInstances: 3 }, (req, res) => {
  if (!getApps().length) initializeApp();
  const db = getFirestore();
  const otp = createOtpService({ store: createFirestoreOtpStore(db), secret: otpSecret.value(), send: ({ email, code }) => sendOtpEmail({ email, code, endpoint: mailEndpoint.value(), secret: mailSecret.value() }) });
  const authFlow = createAuthFlow({ otp, sessions: createFirestoreSessionStore(db), verifyIdentity: async token => {
    const decoded = await getAuth().verifyIdToken(token, true);
    const user = await getAuth().getUser(decoded.uid);
    if (user.disabled || !user.email || user.email !== decoded.email) throw new Error('Authentication required');
    return { uid: user.uid, email: user.email };
  } });
  const app = createApp({ authFlow, repository: createRepository(db), limit: createRateLimiter(db), allowedOrigin: process.env.ALLOWED_ORIGIN || 'https://ltch.example.com' });
  // Cloud Run terminates TLS; configure one proxy hop only after testing trusted IP behavior.
  return app(req, res);
});

