/** Email delivery only. OTP issuance, verification and throttling belong to the server. */
function doPost(e) {
  const reply = value => ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
  try {
    const properties = PropertiesService.getScriptProperties();
    const secret = properties.getProperty('LTCH_MAIL_SECRET');
    if (!secret || secret.length < 32 || !e || !e.postData || !e.postData.contents || e.postData.contents.length > 1500000) return reply({ ok: false });
    const data = JSON.parse(e.postData.contents);
    if (data && data.kind === 'attendance_queue') return enqueueAttendanceMail_(data, secret, properties, reply);
    if (data && data.kind === 'notification') return deliverNotification_(data, secret, properties, reply);
    if (e.postData.contents.length > 2048) return reply({ ok: false });
    if (!data || typeof data.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email.length > 254 || typeof data.code !== 'string' || !/^\d{6}$/.test(data.code) || typeof data.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(data.nonce) || !Number.isSafeInteger(data.timestamp) || typeof data.signature !== 'string' || !/^[a-f0-9]{64}$/.test(data.signature) || Math.abs(Date.now() - data.timestamp) > 120000) return reply({ ok: false });
    const message = [data.timestamp, data.nonce, data.email, data.code].join('\n');
    const signature = Utilities.computeHmacSha256Signature(message, secret, Utilities.Charset.UTF_8).map(x => ('0' + (x & 255).toString(16)).slice(-2)).join('');
    let difference = 0;
    for (let i = 0; i < 64; i++) difference |= signature.charCodeAt(i) ^ data.signature.charCodeAt(i);
    if (difference !== 0) return reply({ ok: false });
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return reply({ ok: false });
    try {
      const nonceKey = 'otp_request_' + data.nonce;
      if (properties.getProperty(nonceKey)) return reply({ ok: false });
      // Bound storage growth while holding the lock. No recipient or code is stored.
      const now = Date.now();
      const all = properties.getProperties();
      Object.keys(all).filter(k => k.indexOf('otp_request_') === 0 && Number(all[k]) < now - 300000).forEach(k => properties.deleteProperty(k));
      properties.setProperty(nonceKey, String(now));
    } finally {
      lock.releaseLock();
    }
    const otpMail = buildOtpMail_(data.code);
    MailApp.sendEmail({
      to: data.email,
      name: 'Lớp Toán cô Hạnh',
      subject: otpMail.subject,
      body: otpMail.body,
      htmlBody: otpMail.htmlBody
    });
    return reply({ ok: true });
  } catch (error) {
    console.error('LTCH_MAIL_EXCEPTION ' + String(error && error.name || 'Error'));
    return reply({ ok: false, reason: 'delivery_exception' });
  }
}

function deliverNotification_(data, secret, properties, reply) {
  if (!Number.isSafeInteger(data.timestamp) || Math.abs(Date.now() - data.timestamp) > 120000 || typeof data.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(data.nonce) || typeof data.payload !== 'string' || data.payload.length > 250000 || typeof data.signature !== 'string' || !/^[a-f0-9]{64}$/.test(data.signature)) return reply({ ok: false, reason: 'invalid_envelope' });
  const signature = Utilities.computeHmacSha256Signature([data.timestamp, data.nonce, data.payload].join('\n'), secret, Utilities.Charset.UTF_8).map(x => ('0' + (x & 255).toString(16)).slice(-2)).join('');
  let difference = 0; for (let i = 0; i < 64; i++) difference |= signature.charCodeAt(i) ^ data.signature.charCodeAt(i); if (difference !== 0) return reply({ ok: false, reason: 'invalid_signature' });
  const mail = JSON.parse(data.payload);
  if (typeof mail.email !== 'string' || mail.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.email) || typeof mail.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(mail.eventId) || typeof mail.subject !== 'string' || mail.subject.length > 250 || !/^\[(Lớp Toán cô Hạnh|LTCH - YÊU CẦU DUYỆT GẤP)\]/.test(mail.subject) || typeof mail.body !== 'string' || mail.body.length > 26000 || (mail.htmlBody !== undefined && (typeof mail.htmlBody !== 'string' || mail.htmlBody.length > 150000))) return reply({ ok: false, reason: 'invalid_notification' });
  const lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) return reply({ ok: false, reason: 'busy' });
  try {
    const eventKey = 'sent_notification_' + mail.eventId; if (properties.getProperty(eventKey)) return reply({ ok: true });
    const message = { to: mail.email, name: 'Lớp Toán cô Hạnh', subject: mail.subject, body: mail.body };
    if (mail.htmlBody) message.htmlBody = mail.htmlBody;
    MailApp.sendEmail(message);
    properties.setProperty(eventKey, String(Date.now()));
    const all = properties.getProperties(); Object.keys(all).filter(k => k.indexOf('sent_notification_') === 0 && Number(all[k]) < Date.now() - 7 * 86400000).forEach(k => properties.deleteProperty(k));
    return reply({ ok: true });
  } finally { lock.releaseLock(); }
}
