import {backupChunk, backupConfirmedOffset, backupMaxBytes} from './backup-drive-ranges.mjs';

// Low-level Drive adapter. Callers must authorize the classroom first and keep
// tokens and generated IDs in trusted server-side storage. Not wired to routes.
const apiOrigin = 'https://www.googleapis.com';
const folderType = 'application/vnd.google-apps.folder';
const maxFileBytes = 10_000_000;

export class DriveError extends Error {
  constructor(code) { super('Google Drive request failed'); this.name = 'DriveError'; this.code = code; }
}

export function validateDriveResumableSessionUrl(value) {
  let url;
  try {
    if (typeof value !== 'string' || value.length > 4096) throw Error();
    url = new URL(value);
  } catch {
    throw new DriveError('invalid_session');
  }
  if (
    url.origin !== apiOrigin ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== '/upload/drive/v3/files' ||
    url.searchParams.getAll('uploadType').length !== 1 ||
    url.searchParams.get('uploadType') !== 'resumable' ||
    url.searchParams.getAll('upload_id').length !== 1 ||
    !url.searchParams.get('upload_id')
  ) {
    throw new DriveError('invalid_session');
  }
  return url.href;
}

function fileId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new DriveError('invalid_id');
  return value;
}
function fileName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 250 || /[\u0000-\u001f\u007f]/.test(value)) throw new DriveError('invalid_name');
  return value.trim();
}

export function createGoogleDrive({accessToken, fetchImpl = fetch, ownerEmail = 'admin@example.com'}) {
  if (typeof accessToken !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(accessToken)) throw new DriveError('invalid_token');
  let verifiedOwner = false;
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetchImpl(apiOrigin + path, {...options, headers: {...options.headers, authorization: `Bearer ${accessToken}`}, redirect: 'manual'});
    } catch { throw new DriveError('network'); }
    if (!response.ok) throw new DriveError(response.status === 409 ? 'conflict' : response.status === 404 ? 'not_found' : response.status === 401 ? 'authorization' : 'upstream');
    return response;
  }
  async function json(path, options) {
    const response = await request(path, options);
    try {return await response.json();} catch {throw new DriveError('invalid_response');}
  }
  function verifiedId(result, expected) {
    if (!result || result.id !== expected) throw new DriveError('invalid_response');
    return result.id;
  }
  return {
    async verifyOwner() {
      verifiedOwner = false;
      const result = await json('/drive/v3/about?fields=user%28emailAddress%29');
      if (typeof result?.user?.emailAddress !== 'string' || result.user.emailAddress.toLowerCase() !== String(ownerEmail || 'admin@example.com').trim().toLowerCase()) throw new DriveError('wrong_account');
      verifiedOwner = true;
    },
    async reserveIds(count) {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      if (!Number.isInteger(count) || count < 1 || count > 100) throw new DriveError('invalid_count');
      const result = await json(`/drive/v3/files/generateIds?count=${count}&space=drive`);
      if (!Array.isArray(result?.ids) || result.ids.length !== count) throw new DriveError('invalid_response');
      return result.ids.map(id => fileId(id));
    },
    async reserveId() {
      const ids = await this.reserveIds(1);
      return ids[0];
    },
    async rootId() {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      // drive.file may not grant metadata access to the root folder itself.
      return 'root';
    },
    async isRootChild({id, name}) {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      fileId(id);fileName(name);
      const escaped=name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      let pageToken;
      for(let page=0;page<10;page++){
        const params=new URLSearchParams({q:`'root' in parents and name = '${escaped}' and trashed = false`,fields:'nextPageToken,files(id)',pageSize:'100'});
        if(pageToken)params.set('pageToken',pageToken);
        const result=await json(`/drive/v3/files?${params}`);
        if(!Array.isArray(result?.files))throw new DriveError('invalid_response');
        if(result.files.some(file=>file?.id===id))return true;
        if(!result.nextPageToken)return false;
        if(typeof result.nextPageToken!=='string'||result.nextPageToken.length>2048)throw new DriveError('invalid_response');
        pageToken=result.nextPageToken;
      }
      throw new DriveError('too_many_pages');
    },
    async createFolder({id, parentId, name}) {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      fileId(id); fileId(parentId); fileName(name);
      const result = await json('/drive/v3/files?fields=id', {method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({id, name: fileName(name), mimeType: folderType, parents: [parentId]})});
      return verifiedId(result, id);
    },
    async rename({id, name}) {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      fileId(id); fileName(name);
      const result = await json(`/drive/v3/files/${id}?fields=id%2Cname`, {
        method: 'PATCH',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({name: fileName(name)})
      });
      return verifiedId(result, id);
    },
    async moveFile({id, addParentId, removeParentId}) {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      fileId(id); fileId(addParentId); fileId(removeParentId);
      const params = new URLSearchParams({
        addParents: addParentId,
        removeParents: removeParentId,
        fields: 'id,parents'
      });
      const result = await json(`/drive/v3/files/${id}?${params}`, { method: 'PATCH' });
      return verifiedId(result, id);
    },
    async listFolderChildren({parentId}) {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      fileId(parentId);
      const files = [];
      let pageToken;
      for (let page = 0; page < 5; page++) {
        const params = new URLSearchParams({
          q: `'${parentId}' in parents and trashed = false`,
          fields: 'nextPageToken,files(id,name,mimeType,size,parents,trashed,shared,ownedByMe,appProperties)',
          pageSize: '100'
        });
        if (pageToken) params.set('pageToken', pageToken);
        const result = await json(`/drive/v3/files?${params}`);
        if (!Array.isArray(result?.files)) throw new DriveError('invalid_response');
        files.push(...result.files);
        if (!result.nextPageToken) return files;
        if (typeof result.nextPageToken !== 'string' || result.nextPageToken.length > 2048) throw new DriveError('invalid_response');
        pageToken = result.nextPageToken;
      }
      return files;
    },
    async metadata({id}) {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      fileId(id);
      return json(`/drive/v3/files/${id}?fields=id%2Cname%2CmimeType%2Cparents%2Csize%2Ctrashed%2Cshared%2CownedByMe%2CappProperties`);
    },
    async permissions({id}) {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      fileId(id);
      const permissions=[];let pageToken;
      for(let page=0;page<10;page++){
        const params=new URLSearchParams({fields:'nextPageToken,permissions(id,type,role,allowFileDiscovery,deleted)',pageSize:'100'});
        if(pageToken)params.set('pageToken',pageToken);
        const result=await json(`/drive/v3/files/${id}/permissions?${params}`);
        if(!Array.isArray(result?.permissions))throw new DriveError('invalid_response');
        permissions.push(...result.permissions);
        if(!result.nextPageToken)return permissions;
        if(typeof result.nextPageToken!=='string'||result.nextPageToken.length>2048)throw new DriveError('invalid_response');
        pageToken=result.nextPageToken;
      }
      throw new DriveError('too_many_pages');
    },
    async shareWithLink({id}) {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      fileId(id);
      const result=await json(`/drive/v3/files/${id}/permissions?fields=id%2Ctype%2Crole%2CallowFileDiscovery`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'anyone',role:'reader',allowFileDiscovery:false})});
      if(result?.type!=='anyone'||result.role!=='reader'||result.allowFileDiscovery===true)throw new DriveError('invalid_response');
    },
    async upload({id, parentId, name, contentType, bytes, sha256}) {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      fileId(id); fileId(parentId); fileName(name);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maxFileBytes) throw new DriveError('invalid_size');
      if (sha256!==undefined && (typeof sha256!=='string' || !/^[a-f0-9]{64}$/.test(sha256))) throw new DriveError('invalid_hash');
      if (typeof contentType !== 'string' || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(contentType) || contentType.length > 127 || contentType.toLowerCase().startsWith('application/vnd.google-apps.')) throw new DriveError('invalid_type');
      const isVideo = /^video\//i.test(contentType);
      const boundary = `ltch_${crypto.randomUUID().replaceAll('-', '')}`;
      const metadata = JSON.stringify({id, name: fileName(name), parents: [parentId], mimeType: contentType, copyRequiresWriterPermission: !isVideo, ...(sha256?{appProperties:{ltchSha256:sha256}}:{})});
      const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`, bytes, `\r\n--${boundary}--\r\n`]);
      const result = await json('/upload/drive/v3/files?uploadType=multipart&fields=id', {method:'POST', headers:{'content-type':`multipart/related; boundary=${boundary}`}, body});
      return verifiedId(result, id);
    },
    async startResumableUpload({id, parentId, name, contentType, total, sha256, origin}) {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      fileId(id); fileId(parentId); fileName(name);
      if (!Number.isSafeInteger(total) || total < 1 || total > backupMaxBytes) throw new DriveError('invalid_size');
      if (sha256 !== undefined && (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256))) throw new DriveError('invalid_hash');
      if (typeof contentType !== 'string' || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(contentType) || contentType.length > 127 || contentType.toLowerCase().startsWith('application/vnd.google-apps.')) throw new DriveError('invalid_type');
      const isVideo = /^video\//i.test(contentType);
      const body = JSON.stringify({
        id,
        name: fileName(name),
        parents: [parentId],
        mimeType: contentType,
        copyRequiresWriterPermission: !isVideo,
        appProperties: {...(sha256 ? {ltchSha256: sha256} : {}), ltchSize: String(total)}
      });
      const headers = {
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': contentType,
        'x-upload-content-length': String(total)
      };
      if (typeof origin === 'string' && /^https:\/\/[a-z0-9.-]+$/i.test(origin)) {
        headers.origin = origin;
      }
      const response = await request('/upload/drive/v3/files?uploadType=resumable&fields=id', {
        method: 'POST',
        headers,
        body
      });
      const location = response.headers.get('location');
      try { await response.body?.cancel(); } catch {}
      return validateDriveResumableSessionUrl(location);
    },
    async uploadResumableChunk({sessionUrl, total, id, offset = 0, bytes = null, contentType = 'application/octet-stream'}) {
      fileId(id);
      if (!Number.isSafeInteger(total) || total < 1 || total > backupMaxBytes) throw new DriveError('invalid_size');
      const validUrl = validateDriveResumableSessionUrl(sessionUrl);
      let response;
      let maxOffset = total;
      if (bytes === null || bytes === undefined) {
        try {
          response = await fetchImpl(validUrl, {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${accessToken}`,
              'content-range': `bytes */${total}`,
              'content-length': '0'
            },
            redirect: 'manual'
          });
        } catch {
          throw new DriveError('network');
        }
      } else {
        let chunk;
        try {
          chunk = backupChunk(total, offset);
        } catch {
          throw new DriveError('invalid_offset');
        }
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== chunk.length) throw new DriveError('invalid_size');
        maxOffset = offset + chunk.length;
        try {
          response = await fetchImpl(validUrl, {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${accessToken}`,
              'content-type': contentType,
              'content-length': String(chunk.length),
              'content-range': chunk.contentRange
            },
            body: bytes,
            redirect: 'manual'
          });
        } catch {
          throw new DriveError('network');
        }
      }
      if (response.status === 308) {
        const rangeHeader = response.headers.get('range');
        try { await response.body?.cancel(); } catch {}
        let confirmed;
        try {
          confirmed = backupConfirmedOffset(total, rangeHeader);
        } catch {
          throw new DriveError('invalid_response');
        }
        if (confirmed > maxOffset) throw new DriveError('invalid_response');
        return {state: 'uploading', offset: confirmed};
      }
      if (response.status === 200 || response.status === 201) {
        if (maxOffset !== total) {
          try { await response.body?.cancel(); } catch {}
          throw new DriveError('invalid_response');
        }
        let result;
        try {
          result = await response.json();
        } catch {
          throw new DriveError('invalid_response');
        }
        if (!result || result.id !== id) throw new DriveError('invalid_response');
        return {state: 'uploaded', id: result.id, offset: total};
      }
      try { await response.body?.cancel(); } catch {}
      if (response.status === 409) throw new DriveError('conflict');
      if (response.status === 404) throw new DriveError('not_found');
      if (response.status === 401) throw new DriveError('authorization');
      throw new DriveError('upstream');
    },
    async download({id, range}) {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      fileId(id);
      if (range !== undefined && (typeof range !== 'string' || !/^bytes=\d+-\d*$/.test(range))) throw new DriveError('invalid_range');
      // Stream the body to the authorized caller; response headers from Drive
      // must not be forwarded as executable content without validation.
      return request(`/drive/v3/files/${id}?alt=media`, range ? {headers:{range}} : {});
    },
    async trash({id}) {
      if (!verifiedOwner) throw new DriveError('owner_unverified');
      fileId(id);
      const result = await json(`/drive/v3/files/${id}?fields=id%2Ctrashed`, {
        method: 'PATCH', headers: {'content-type':'application/json'}, body: JSON.stringify({trashed: true})
      });
      if (result?.id !== id || result.trashed !== true) throw new DriveError('invalid_response');
    }
  };
}
