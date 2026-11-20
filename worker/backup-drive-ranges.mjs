// Preparation only: these functions do not encrypt or upload data. Do not use
// with real backups until the complete encrypted backup/restore flow is tested.
export const backupChunkBytes = 8 * 1024 * 1024;
export const backupMaxBytes = 100 * 1024 * 1024 * 1024;

function checkSize(total) {
 if(!Number.isSafeInteger(total)||total<1||total>backupMaxBytes)throw new RangeError('Invalid backup size');
}

export function backupChunk(total,offset) {
 checkSize(total);
 if(!Number.isSafeInteger(offset)||offset<0||offset>=total)throw new RangeError('Invalid backup offset');
 const length=Math.min(backupChunkBytes,total-offset);
 return {offset,length,contentRange:`bytes ${offset}-${offset+length-1}/${total}`};
}

// Range comes from Drive, not from a browser. Only an incomplete upload can
// return 308; a complete upload must return its validated file metadata.
export function backupConfirmedOffset(total,range) {
 checkSize(total);
 if(range===null||range==='')return 0;
 if(typeof range!=='string')throw new RangeError('Invalid Drive range');
 const match=/^bytes=0-(\d+)$/.exec(range);
 if(!match)throw new RangeError('Invalid Drive range');
 const end=Number(match[1]);
 if(!Number.isSafeInteger(end)||end>=total-1)throw new RangeError('Invalid Drive range');
 return end+1;
}
