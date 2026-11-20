'use strict';
// Server-only Storage adapter. The caller MUST authorize the actor and resource
// before calling; a Supabase secret key bypasses row-level security.
function createSupabaseStorage({ projectUrl, secretKey, fetchImpl = fetch }) {
  const base = new URL(projectUrl);
  if (base.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(base.hostname) || base.pathname !== '/' || base.search || base.hash || base.username || base.password || typeof secretKey !== 'string' || !secretKey) throw new TypeError('Invalid Supabase configuration');
  // Modern sb_secret keys are opaque, not JWTs. Only legacy keys use Bearer.
  const headers = { apikey: secretKey, ...(!secretKey.startsWith('sb_secret_') ? {authorization: `Bearer ${secretKey}`} : {}) };
  function target(bucket, path) {
    if (!['ltch-submissions','ltch-materials'].includes(bucket) || typeof path !== 'string' || path.length > 400 || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) || path.split('/').some(x => x === '.' || x === '..')) throw new TypeError('Invalid storage path');
    return `${base.origin}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
  async function upload({ bucket, path, bytes, contentType }) {
    const uri = target(bucket,path);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > (bucket === 'ltch-submissions' ? 10_000_000 : 50_000_000) || !['application/pdf','image/jpeg','image/png'].includes(contentType)) throw new TypeError('Invalid file');
    const signature = { 'application/pdf':[0x25,0x50,0x44,0x46,0x2d], 'image/jpeg':[0xff,0xd8,0xff], 'image/png':[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a] }[contentType];
    if (bytes.length < signature.length || !signature.every((byte,index)=>bytes[index]===byte)) throw new TypeError('File content does not match type');
    // Workers supports manual/follow only. Reject redirects without forwarding keys.
    const response = await fetchImpl(uri, { method:'POST', headers:{...headers,'content-type':contentType,'x-upsert':'false'}, body:bytes, redirect:'manual' });
    if (!response.ok) throw new Error('Storage upload failed');
    return { bucket, path, size:bytes.byteLength, contentType };
  }
  async function download({ bucket,path }) {
    const uri = target(bucket,path).replace('/object/','/object/authenticated/');
    const response = await fetchImpl(uri,{method:'GET',headers,redirect:'manual'});
    if (!response.ok) throw new Error('Storage download failed');
    return response;
  }
  async function remove({ bucket,path }) {
    const response = await fetchImpl(target(bucket,path),{method:'DELETE',headers,redirect:'manual'});
    if (!response.ok) throw new Error('Storage cleanup failed');
  }
  return {upload, download, remove};
}
module.exports = {createSupabaseStorage};


