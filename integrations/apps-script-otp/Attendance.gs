const ATTENDANCE_QUEUE_PREFIX_ = 'attendance_queue_';
const ATTENDANCE_SENT_PREFIX_ = 'attendance_sent_';
const ATTENDANCE_QUEUE_WINDOW_ = 2 * 86400000;

function attendanceMailSignature_(secret, purpose, timestamp, payload) {
  return Utilities.computeHmacSha256Signature(
    ['ltch:attendance-mail:v1', purpose, timestamp, payload].join('\n'), secret, Utilities.Charset.UTF_8
  ).map(byte => ('0' + (byte & 255).toString(16)).slice(-2)).join('');
}

function enqueueAttendanceMail_(envelope, secret, properties, reply) {
  const {timestamp, payload, signature} = envelope;
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 120000
    || typeof payload !== 'string' || payload.length > 700 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) {
    return reply({ok: false, reason: 'invalid_envelope'});
  }
  const expected = attendanceMailSignature_(secret, 'enqueue', timestamp, payload);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (difference) return reply({ok: false, reason: 'invalid_signature'});
  const job = JSON.parse(payload);
  const id = /^[A-Za-z0-9_-]{1,128}$/;
  if (!job || typeof job.classId !== 'string' || !id.test(job.classId) || typeof job.studentUid !== 'string' || !id.test(job.studentUid)
    || typeof job.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(job.date)
    || typeof job.key !== 'string' || !/^[a-f0-9]{64}$/.test(job.key) || !Number.isSafeInteger(job.revision)
    || !['present', 'absent', 'late', 'excused'].includes(job.status)) return reply({ok: false, reason: 'invalid_job'});
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3500)) return reply({ok: false, reason: 'busy'});
  try {
    const key = ATTENDANCE_QUEUE_PREFIX_ + job.key;
    const previous = properties.getProperty(key);
    if (!previous || JSON.parse(previous).job.revision < job.revision) {
      properties.setProperty(key, JSON.stringify({job, queuedAt: Date.now(), nextAttempt: 0, failures: 0}));
    }
    return reply({ok: true});
  } finally { lock.releaseLock(); }
}

function resolveAttendanceMail_(secret, jobs) {
  const apiBase = ((typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties().getProperty('LTCH_API_BASE_URL')) || 'https://api.ltch.example.com').replace(/\/+$/, '');
  const timestamp = Date.now();
  const payload = JSON.stringify(jobs);
  const signature = attendanceMailSignature_(secret, 'resolve', timestamp, payload);
  const response = UrlFetchApp.fetch(apiBase + '/api/internal/attendance-mail', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({timestamp, payload, signature}), muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('Attendance lookup unavailable');
  return JSON.parse(response.getContentText()).items;
}

function processAttendanceMail_(properties, secret) {
  const now = Date.now();
  const all = properties.getProperties();
  Object.keys(all).filter(key => key.indexOf(ATTENDANCE_SENT_PREFIX_) === 0 && Number(all[key]) < now - ATTENDANCE_QUEUE_WINDOW_)
    .forEach(key => properties.deleteProperty(key));
  const queued = Object.keys(all).filter(key => key.indexOf(ATTENDANCE_QUEUE_PREFIX_) === 0)
    .map(key => ({key, entry: JSON.parse(all[key])}));
  const expired = queued.filter(row => now - row.entry.queuedAt >= ATTENDANCE_QUEUE_WINDOW_);
  if (expired.length) console.warn('LTCH_ATTENDANCE_MAIL_EXPIRED ' + expired.length);
  for (const row of expired) updateAttendanceMail_(properties, row, true);
  const due = queued.filter(row => now - row.entry.queuedAt < ATTENDANCE_QUEUE_WINDOW_ && row.entry.nextAttempt <= now)
    .sort((a, b) => a.entry.nextAttempt - b.entry.nextAttempt || a.entry.queuedAt - b.entry.queuedAt).slice(0, 12);
  if (!due.length || MailApp.getRemainingDailyQuota() <= 5) return;
  const results = new Map(resolveAttendanceMail_(secret, due.map(row => row.entry.job)).map(result => [result.key, result.messages]));
  for (const row of due) {
    const messages = results.get(row.entry.job.key);
    let complete = Array.isArray(messages);
    if (complete) {
      for (const mail of messages) {
        try {
          if (!sendAttendanceMail_(properties, row, mail)) {
            complete = false;
            break;
          }
        } catch (error) {
          console.warn('LTCH_ATTENDANCE_MAIL_PENDING ' + String(error && error.name || 'Error'));
          complete = false;
          break;
        }
      }
    }
    updateAttendanceMail_(properties, row, complete);
  }
}

function sendAttendanceMail_(properties, row, mail) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return false;
  try {
    const current = properties.getProperty(row.key);
    if (!current || JSON.parse(current).job.revision !== row.entry.job.revision) return true;
    const sentKey = ATTENDANCE_SENT_PREFIX_ + mail.eventId;
    if (properties.getProperty(sentKey)) return true;
    if (MailApp.getRemainingDailyQuota() <= 5) return false;
    MailApp.sendEmail({to: mail.email, name: 'Lớp Toán cô Hạnh', subject: mail.subject, body: mail.body, htmlBody: mail.htmlBody});
    properties.setProperty(sentKey, String(Date.now()));
    return true;
  } finally { lock.releaseLock(); }
}

function verifyAttendanceMailConnection() {
  const secret = PropertiesService.getScriptProperties().getProperty('LTCH_MAIL_SECRET');
  if (!secret || resolveAttendanceMail_(secret, []).length !== 0) throw new Error('Không xác minh được kết nối email điểm danh.');
  console.log('Đã xác minh kết nối email điểm danh, 0 thư được gửi.');
}

function updateAttendanceMail_(properties, row, complete) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const value = properties.getProperty(row.key);
    if (!value) return;
    const latest = JSON.parse(value);
    if (latest.job.revision !== row.entry.job.revision) return;
    if (complete) properties.deleteProperty(row.key);
    else {
      latest.failures++;
      latest.nextAttempt = Date.now() + Math.min(3600000, 60000 * Math.pow(2, Math.min(latest.failures - 1, 6)));
      properties.setProperty(row.key, JSON.stringify(latest));
    }
  } finally { lock.releaseLock(); }
}
