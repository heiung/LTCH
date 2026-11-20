export function applicationSession(request) {
 return /^Session ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') || '')?.[1];
}
export async function readJson(request, max = 65536) {
 if (!request.headers.get('content-type')?.startsWith('application/json')) throw new TypeError('JSON required');
 if (!request.body) throw new TypeError('Body required');
 const reader = request.body.getReader(); const chunks=[]; let size=0;
 try { while (true) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>max){await reader.cancel();throw new RangeError('Body too large');} chunks.push(value); } }
 finally { reader.releaseLock(); }
 const bytes = new Uint8Array(size); let offset=0; for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
export function json(data,status=200) {return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});}
export function withCors(response,origin){
 const h=new Headers(response.headers);
 h.set('cache-control','no-store');h.set('x-content-type-options','nosniff');h.set('referrer-policy','no-referrer');
 const vary=(h.get('vary')||'').split(',').map(v=>v.trim()).filter(Boolean);
 if(!vary.some(v=>v.toLowerCase()==='origin'))vary.push('Origin');
 h.set('vary',vary.join(', '));
 if(origin)h.set('access-control-allow-origin',origin);
 return new Response(response.body,{status:response.status,headers:h});
}
export async function readBytes(request,max){
 if(!request.body)throw new TypeError('Body required');const reader=request.body.getReader();const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new RangeError('Body too large');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
}

export async function readFormData(request,max){
 const bytes=await readBytes(request,max);
 // Rebuilding from the URL avoids reusing a consumed Request body on Workers.
 return new Request(request.url,{method:'POST',headers:{'content-type':request.headers.get('content-type')||''},body:bytes}).formData();
}
