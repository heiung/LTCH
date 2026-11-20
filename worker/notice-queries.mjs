import {data} from './policy.mjs';
import {
  decodeLegacyNoticeReads,
  isMissingNoticeReadsTableError,
  mergeNoticeReads,
  stripLegacyNoticeReads,
  summarizeNoticeReads
} from '../shared/notice-reads.mjs';

export async function withNoticeFiles(db, notices, {stripReads = true} = {}) {
  if (!notices.length) return notices;
  const files = data(await db.from('ltch_notice_files')
    .select('id,notice_id,name,content_type,file_size')
    .in('notice_id', notices.map(notice => notice.id))
    .eq('status', 'stored')
    .order('created_at', {ascending: true}));
  const filesByNotice = new Map();
  for (const file of files) {
    if (!filesByNotice.has(file.notice_id)) filesByNotice.set(file.notice_id, []);
    filesByNotice.get(file.notice_id).push({id: file.id, name: file.name, content_type: file.content_type, file_size: file.file_size});
  }
  return notices.map(notice => ({
    ...notice,
    ...(stripReads ? {body: stripLegacyNoticeReads(notice.body)} : {}),
    attachments: filesByNotice.get(notice.id) || []
  }));
}

export async function loadNoticeReadRows(db, noticeIds = []) {
  if (!Array.isArray(noticeIds) || !noticeIds.length) {
    return {rows: [], missingTable: false};
  }
  const res = await db.from('ltch_notice_reads')
    .select('notice_id,uid,seen_at')
    .in('notice_id', noticeIds);
  if (res?.error && isMissingNoticeReadsTableError(res.error)) {
    return {rows: [], missingTable: true};
  }
  return {rows: data(res) || [], missingTable: false};
}

export async function withNoticeReads(
  db,
  notices,
  {actorUid = null, staff = false, studentUids = [], parentLinks = [], staffUids = []} = {}
) {
  if (!notices.length) return notices;
  const decodedByNotice = new Map();
  for (const notice of notices) {
    decodedByNotice.set(notice.id, decodeLegacyNoticeReads(notice.body));
  }
  const {rows} = await loadNoticeReadRows(db, notices.map(notice => notice.id));
  const rowsByNotice = new Map();
  for (const row of rows) {
    if (!row?.notice_id) continue;
    if (!rowsByNotice.has(row.notice_id)) rowsByNotice.set(row.notice_id, []);
    rowsByNotice.get(row.notice_id).push(row);
  }
  return notices.map(notice => {
    const decoded = decodedByNotice.get(notice.id) || {cleanBody: stripLegacyNoticeReads(notice.body), reads: {}};
    const readsMap = mergeNoticeReads(rowsByNotice.get(notice.id) || [], decoded.reads);
    const enriched = {
      ...notice,
      body: decoded.cleanBody,
      viewer_seen_at: actorUid && readsMap.has(actorUid) ? readsMap.get(actorUid) : null
    };
    if (staff) {
      enriched.read_summary = summarizeNoticeReads({
        readsMap,
        studentUids,
        parentLinks,
        allowedOtherUids: staffUids
      });
    }
    return enriched;
  });
}
