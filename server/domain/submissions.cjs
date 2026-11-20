'use strict';
const { randomUUID } = require('node:crypto');
const EXT_MAP = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_FILES = 12;
const MAX_FILE_BYTES = 10_000_000;
const MAX_TOTAL_BYTES = 25_000_000;
const MAX_NOTE_LENGTH = 1000;

function cleanName(rawName, fallbackExt, index) {
 const trimmed = String(rawName || '').replace(/[\u0000-\u001f\u007f/\\"']/g, ' ').replace(/\s+/g, ' ').trim();
 if (!trimmed) return `bai-lam-${index + 1}.${fallbackExt}`;
 return trimmed.slice(0, 80);
}

// Repository data and permissions MUST be server-owned. Reservations preserve
// an audit trail when storage succeeds but the database confirmation fails.
function createSubmissionService({repository,storage,authorize,clock=Date.now,makeId=randomUUID}) {
 if (!repository || !storage || typeof authorize !== 'function' || typeof repository.getAssignment !== 'function' || typeof repository.reserve !== 'function' || typeof repository.markStored !== 'function' || typeof repository.markFailed !== 'function' || typeof storage.upload !== 'function') throw new TypeError('Submission configuration missing');
 const idOk = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
 return {async submit({actor,assignmentId,bytes,contentType,files,note=''}) {
  if (!actor || !idOk(actor.uid) || !idOk(assignmentId)) throw new Error('Unavailable');
  const assignment=await repository.getAssignment(assignmentId),now=clock();
  if (!assignment || assignment.status!=='published' || !Number.isSafeInteger(now) || !Number.isSafeInteger(assignment.opensAt) || !Number.isSafeInteger(assignment.closesAt) || now<assignment.opensAt || now>=assignment.closesAt || !await authorize(actor,assignment)) throw new Error('Unavailable');
  if (typeof note !== 'string') throw new TypeError('Invalid note');
  const cleanNote = note.trim();
  if (cleanNote.length > MAX_NOTE_LENGTH) throw new TypeError('Invalid note');
  const rawEntries = Array.isArray(files) ? files : [{ bytes, contentType, name: '' }];
  if (rawEntries.length < 1 || rawEntries.length > MAX_FILES) throw new TypeError('Invalid files');
  const id=makeId(); if(!idOk(id)) throw new TypeError('Invalid identifier');
  const normalized=[]; let totalSize=0;
  for (let i=0; i<rawEntries.length; i++) {
   const entry=rawEntries[i];
   const ext=EXT_MAP[entry && entry.contentType];
   if(!ext || !entry || !(entry.bytes instanceof Uint8Array) || entry.bytes.byteLength===0 || entry.bytes.byteLength>MAX_FILE_BYTES) throw new TypeError('Invalid file');
   totalSize+=entry.bytes.byteLength;
   if(totalSize>MAX_TOTAL_BYTES) throw new RangeError('File too large');
   normalized.push({
    bytes: entry.bytes,
    contentType: entry.contentType,
    ext,
    name: cleanName(entry.name, ext, i),
    path: `${assignmentId}/${actor.uid}/${id}${rawEntries.length > 1 ? `_${i + 1}` : ''}.${ext}`
   });
  }
  const primaryPath=normalized[0].path;
  const reserved=await repository.reserve({id,assignmentId,uid:actor.uid,path:primaryPath,status:'pending',createdAt:now});
  if(!reserved) throw new Error('Submission already exists');
  const uploadedPaths=[];
  const storedFiles=[];
  try {
   for (let i=0; i<normalized.length; i++) {
    const item=normalized[i];
    const result=await storage.upload({
     bucket:'ltch-submissions',
     path:item.path,
     bytes:item.bytes,
     contentType:item.contentType,
     actor,
     assignment,
     submissionId:id,
     ext:item.ext,
     fileName:item.name,
     fileIndex:i,
     fileCount:normalized.length
    });
    const actualPath=result.objectPath || item.path;
    uploadedPaths.push(actualPath);
    storedFiles.push({
     name: item.name,
     contentType: item.contentType,
     size: Number(result.size) || item.bytes.byteLength,
     objectPath: actualPath
    });
   }
  } catch(err) {
   await repository.markFailed(id);
   if (uploadedPaths.length && typeof storage.trash === 'function') {
    try { await storage.trash({objectPaths: uploadedPaths}); } catch {}
   }
   throw new Error('Upload failed');
  }
  const primaryStored=storedFiles[0];
  const hasCustomObjectPath=Boolean(primaryStored && primaryStored.objectPath && primaryStored.objectPath !== primaryPath);
  // Do not claim success when recording the storage result fails. The pending
  // record contains the object path for later reconciliation.
  await repository.markStored(id,{
   size: totalSize,
   contentType: primaryStored.contentType,
   storedAt: clock(),
   ...(hasCustomObjectPath ? {objectPath: primaryStored.objectPath} : {}),
   note: cleanNote,
   files: storedFiles
  });
  return {
   id,
   status:'submitted',
   note: cleanNote,
   fileCount: storedFiles.length,
   files: storedFiles.map((f, index) => ({index, name: f.name, content_type: f.contentType, size: f.size}))
  };
 }};
}
module.exports={createSubmissionService};
