import {ApiError,demand} from './policy.mjs';

// A Drive link is deliberately shareable. Never accept a broader permission
// such as public search, edit access, or a separately shared user/group.
function sharing(permissions){
 demand(Array.isArray(permissions)&&permissions.length>0,503,'Không xác minh được quyền chia sẻ tệp.');
 const active=permissions.filter(p=>p?.deleted!==true);
 demand(active.some(p=>p.type==='user'&&p.role==='owner')&&active.every(p=>(p.type==='user'&&p.role==='owner')||(p.type==='anyone'&&p.role==='reader'&&p.allowFileDiscovery!==true)),503,'Quyền chia sẻ tệp không đúng cấu hình.');
 const links=active.filter(p=>p.type==='anyone');
 demand(links.length<=1,503,'Quyền chia sẻ tệp không đúng cấu hình.');
 return links.length===1;
}

export function matchesDriveFile(meta,record,parentId){
 const isVideo=/^video\//i.test(String(record.content_type||''));
 const mimeMatches=meta?.mimeType===record.content_type||(isVideo&&/^video\//i.test(String(meta?.mimeType||'')));
 const sizeMatches=String(meta?.size)===String(record.file_size)||(record.file_size===10_000_000&&typeof meta?.appProperties?.ltchSize==='string'&&String(meta?.size)===meta.appProperties.ltchSize);
 return meta?.id===record.drive_file_id&&meta.name===record.name&&mimeMatches&&sizeMatches&&meta.appProperties?.ltchSha256===record.sha256&&meta.trashed===false&&meta.ownedByMe===true&&(!parentId||(Array.isArray(meta.parents)&&meta.parents.length===1&&meta.parents[0]===parentId));
}

export async function requireAllowedSharing(drive,meta,record,{parentId,allowLink=false,requireLink=false}={}){
 demand(matchesDriveFile(meta,record,parentId),503,'Tệp Drive không khớp dữ liệu đã lưu.');
 if(meta.shared===false){demand(!requireLink,409,'Tệp chưa được bật xem bằng liên kết.');return false;}
 demand(allowLink&&meta.shared===true,503,'Tệp Drive không còn riêng tư hoặc không khớp dữ liệu.');
 demand(sharing(await drive.permissions({id:record.drive_file_id})),503,'Tệp Drive chưa có quyền xem phù hợp.');
 return true;
}

// Call only after an authorized upload or an explicit administrator action.
export async function enableLinkSharing(drive,meta,record,{parentId}={}){
 if(await requireAllowedSharing(drive,meta,record,{parentId,allowLink:true}))return;
 demand(!sharing(await drive.permissions({id:record.drive_file_id})),503,'Quyền chia sẻ tệp không đúng cấu hình.');
 try{await drive.shareWithLink({id:record.drive_file_id});}catch(error){if(error?.code!=='conflict')throw error;}
 const updated=await drive.metadata({id:record.drive_file_id});
 await requireAllowedSharing(drive,updated,record,{parentId,allowLink:true,requireLink:true});
}

export function drivePreviewUrl(fileId){
 if(typeof fileId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(fileId))throw new ApiError(503,'Không xác định được tài liệu Drive.');
 return `https://drive.google.com/file/d/${fileId}/preview`;
}
