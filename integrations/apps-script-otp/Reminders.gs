/** Minute scheduler. Uses the existing mail secret; no student data is logged. */
const REMINDER_LEASE_MS_ = 110000;
const DRIVE_SYNC_INTERVAL_MS_ = 30 * 60 * 1000;
const MAX_TRANSIENT_REMINDER_FAILURES_ = 5;

function acquireReminderLease_(properties, now) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return null;
  try {
    const leaseUntil = Number(properties.getProperty('LTCH_REMINDER_LEASE_UNTIL') || '0');
    if (leaseUntil > now) return null;
    const owner = now + '-' + Math.random().toString(36).slice(2, 10);
    properties.setProperty('LTCH_REMINDER_LEASE_UNTIL', String(now + REMINDER_LEASE_MS_));
    properties.setProperty('LTCH_REMINDER_LEASE_OWNER', owner);
    return owner;
  } finally {
    lock.releaseLock();
  }
}

function releaseReminderLease_(properties, owner) {
  if (!owner) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  try {
    if (properties.getProperty('LTCH_REMINDER_LEASE_OWNER') === owner) {
      properties.deleteProperty('LTCH_REMINDER_LEASE_OWNER');
      properties.deleteProperty('LTCH_REMINDER_LEASE_UNTIL');
    }
  } finally {
    lock.releaseLock();
  }
}

function isTransientReminderStatus_(code) {
  return code === 429 || code === 502 || code === 503 || code === 504;
}

function postLessonReminders_(secret, syncDrive) {
  const apiBase = ((typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties().getProperty('LTCH_API_BASE_URL')) || 'https://api.ltch.example.com').replace(/\/+$/, '');
  const timestamp = Date.now();
  const signature = Utilities.computeHmacSha256Signature(timestamp + '|ltch:lesson-reminders:v1', secret)
    .map(x => ('0' + (x & 255).toString(16)).slice(-2))
    .join('');
  return UrlFetchApp.fetch(apiBase + '/api/internal/lesson-reminders', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({timestamp, signature, syncDrive}),
    muteHttpExceptions: true
  });
}

function callLessonRemindersWithRetry_(secret, syncDrive) {
  let response = null;
  let networkError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) Utilities.sleep(1500);
    response = null;
    networkError = null;
    try {
      response = postLessonReminders_(secret, syncDrive);
      if (!isTransientReminderStatus_(response.getResponseCode())) break;
    } catch (error) {
      networkError = error;
    }
  }
  return {response, networkError};
}

function sendLessonReminders() {
  const properties = PropertiesService.getScriptProperties();
  const secret = properties.getProperty('LTCH_MAIL_SECRET');
  if (!secret || secret.length < 32) throw new Error('Chưa cấu hình gửi thư.');

  const leaseOwner = acquireReminderLease_(properties, Date.now());
  if (!leaseOwner) {
    console.log('Bỏ qua lượt nhắc học vì lượt trước vẫn đang xử lý.');
    return;
  }

  try {
    try { processAttendanceMail_(properties, secret); }
    catch (error) { console.error('LTCH_ATTENDANCE_MAIL_TICK_FAILED ' + String(error && error.name || 'Error')); }

    const lastDriveSync = Number(properties.getProperty('LTCH_DRIVE_SYNC_LAST_RUN') || '0');
    const hasBacklog = properties.getProperty('LTCH_DRIVE_SYNC_BACKLOG') === '1';
    const syncDrive = hasBacklog || (Date.now() - lastDriveSync >= DRIVE_SYNC_INTERVAL_MS_);

    const {response, networkError} = callLessonRemindersWithRetry_(secret, syncDrive);
    const code = response ? response.getResponseCode() : 0;

    if (networkError || isTransientReminderStatus_(code)) {
      const failures = Number(properties.getProperty('LTCH_REMINDER_TRANSIENT_FAILURES') || '0') + 1;
      properties.setProperty('LTCH_REMINDER_TRANSIENT_FAILURES', String(failures));
      const reason = networkError
        ? String(networkError && networkError.message || networkError)
        : ('HTTP ' + code);
      if (failures < MAX_TRANSIENT_REMINDER_FAILURES_) {
        console.warn('Nhắc học tạm gián đoạn (' + failures + '/' + MAX_TRANSIENT_REMINDER_FAILURES_ + '): ' + reason);
        return;
      }
      throw new Error('Nhắc học chưa xử lý được sau ' + failures + ' lần thử: ' + reason);
    }

    if (code !== 200) throw new Error('Nhắc học chưa xử lý được: HTTP ' + code);

    const result = JSON.parse(response.getContentText());
    const finishedAt = Date.now();
    if (properties.getProperty('LTCH_REMINDER_TRANSIENT_FAILURES')) {
      properties.deleteProperty('LTCH_REMINDER_TRANSIENT_FAILURES');
    }
    if (syncDrive) {
      properties.setProperty('LTCH_DRIVE_SYNC_LAST_RUN', String(finishedAt));
    }
    if (result && result.driveBacklog) {
      properties.setProperty('LTCH_DRIVE_SYNC_BACKLOG', '1');
    } else if (properties.getProperty('LTCH_DRIVE_SYNC_BACKLOG')) {
      properties.deleteProperty('LTCH_DRIVE_SYNC_BACKLOG');
    }
    properties.setProperty('LTCH_REMINDER_LAST_RUN', String(finishedAt));
    properties.setProperty('LTCH_REMINDER_LAST_RESULT', JSON.stringify(result));
    console.log('Đã kiểm tra lịch học: ' + result.processed + ' thư; đã gửi ' + result.sent + ', chờ gửi ' + result.pending + '.');
  } finally {
    releaseReminderLease_(properties, leaseOwner);
  }
}

function installLessonReminderTrigger() {
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'sendLessonReminders')) {
    ScriptApp.newTrigger('sendLessonReminders').timeBased().everyMinutes(1).create();
  }
  sendLessonReminders();
}
