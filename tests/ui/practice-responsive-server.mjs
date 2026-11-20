// Isolated visual QA: real room components, synthetic attempts, no cloud writes.
import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {build} from 'esbuild';

const root = process.cwd();
const buildCurrent = () => build({
  stdin: {contents: `import * as rooms from './client/practice-rooms.mjs'; window.rooms = rooms;`, resolveDir: root},
  bundle: true, format: 'esm', write: false
});
let bundle = await buildCurrent();
let sourceMtime = (await stat('client/practice-rooms.mjs')).mtimeMs;
let baselineBundle = null;
try {
  const originalSource = await readFile('.local/practice-responsive/practice-rooms.before.mjs','utf8');
  baselineBundle = await build({
    stdin: {contents: originalSource + '\nwindow.rooms={mountExamTakingOverlay,mountResultReviewOverlay,renderPracticeRoomsPortal};', resolveDir:resolve(root,'client')},
    bundle:true, format:'esm', write:false
  });
} catch {
  baselineBundle = null;
}
const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/qa-fonts/fonts.css"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/scrollbars.css"><body><div id="qa-portal" style="max-width:1280px;margin:auto;padding:16px"></div><script type="module" src="/qa.js"></script><script type="module">
await import('/qa.js');
const access = {displayName:'Nguyễn Minh Anh', birthDate:'15/06/2009', studentCode:'LTCH001', activeGrades:[12], allowedRooms:['thptqg','hsa','tsa'], examYear:2027};
const title = '[LTCH] Đề thi thử năm 2027 – Mã đề 001 – Luyện tập và đánh giá năng lực';
const passage = 'Đọc ngữ liệu sau và trả lời các câu hỏi.\\n\\n' + ('Một nhóm học sinh khảo sát sự thay đổi của nhiệt độ và ghi lại kết quả để phân tích dữ liệu. Hãy đối chiếu thông tin trong văn bản với các phương án trả lời.\\n\\n').repeat(8);
const types = ['single','multiple','true_false','short','fill_blank','drag_drop'];
const stress = new URL(location.href).searchParams.has('stress');
const stressPrompt = 'Đọc bảng và công thức dài sau đây.\\n<table><tr>'+Array.from({length:8},(_,i)=>'<th>Cột dữ liệu '+(i+1)+'</th>').join('')+'</tr><tr>'+Array.from({length:8},()=>'<td>12345678901234567890</td>').join('')+'</tr></table>\\n$'+Array.from({length:30},(_,i)=>'a_{'+i+'}').join('+')+'$';
function questions(type) {
  return Array.from({length:type==='thptqg'?22:50}, (_,i)=>({
    id:'qa-q-'+i, questionCode:'LTCH-'+(i+1), displayNumber:i+1,
    section:type==='thptqg'?(i<12?'part_1':i<16?'part_2':'part_3'):'part_2',
    type:type==='thptqg'?(i<12?'single':i<16?'true_false':'short'):types[i%6],
    prompt:i%6===4?'Điền vào chỗ trống: giá trị thứ nhất {{1}}, giá trị thứ hai {{2}}.':i%6===5?'Ghép đáp án phù hợp: {{1}} và {{2}}.':'Cho hàm số $f(x)=x^2-2x+1$. Dựa vào dữ kiện, chọn đáp án phù hợp với yêu cầu của câu hỏi.',
    options:['Hàm số đồng biến trên khoảng đã cho','Giá trị nhỏ nhất bằng 0','Hàm số luôn nhận giá trị âm','Không có đáp án phù hợp'],
    statements:['Giá trị của hàm số tại điểm x = 1 bằng 0.','Đồ thị hàm số có trục đối xứng x = 1.','Hàm số đồng biến trên toàn bộ tập số thực.','Giá trị nhỏ nhất của hàm số là một số dương.'],
    blankCount:2, cards:['Đồng biến','Nghịch biến','Không đổi'],
    ...(stress&&i===0?{prompt:stressPrompt,media:[{id:'qa-image',path:'/practice-covers/tsa.png',width:1800}]}:{}),
    ...(type!=='thptqg'?{passageContent:passage, passageId:'qa-passage', clusterId:'qa-cluster'}:{})
  }));
}
let attempt;
let cleanupRoom;
const result = type => ({examId:'qa-exam', attemptId:'qa-result',examType:type,examTitle:title,score:7,max:10,timeSpentSeconds:1234,questions:questions(type),results:questions(type).map((q,i)=>({id:q.id,answered:i%3!==0,correct:i%2===0,earned:i%2===0?1:0,points:1,max:1,response:'A',correctAnswer:'B',solution:'Đối chiếu dữ kiện, đáp án đúng là B.'})), sectionSummary:['part_1','part_2','part_3'].map(section=>({section,total:50,earned:30,max:50}))});
const status = message => { if(message) console.info(message); };
const api = async (url, options) => {
  if(url.includes('/rooms')) return {access,exams:Array.from({length:4},(_,i)=>({id:'qa-exam-'+i,title:title+' '+(i+1),examType:window.qaType||'tsa',questionCount:100,year:2027,status:'published',durationMinutes:150,sections:[{key:'part_1',label:'Tư duy Toán học',durationMinutes:60},{key:'part_2',label:'Đọc hiểu',durationMinutes:30},{key:'part_3',label:'Khoa học',durationMinutes:60}]}))};
  if(url.includes('/exams') && (!options || options.method==='GET')) return {exams:Array.from({length:4},(_,i)=>({id:'qa-exam-'+i,title:title+' '+(i+1),examType:window.qaType||'tsa',questionCount:100,year:2027,status:'published',durationMinutes:150,sections:[{key:'part_1',label:'Tư duy Toán học',durationMinutes:60},{key:'part_2',label:'Đọc hiểu',durationMinutes:30},{key:'part_3',label:'Khoa học',durationMinutes:60}]}))};
  if(url.endsWith('/start')) return attempt;
  if(url.endsWith('/submit')) return result(attempt.examType);
  if(url.endsWith('/section')) {attempt.sectionStates[attempt.currentSection].status='in_progress';return {...attempt};}
  return {serverNow:Date.now()};
};
window.qa = async (type='tsa', screen='room') => {
  cleanupRoom?.();
  cleanupRoom = null;
  document.querySelector('#ltch-practice-fullscreen-root')?.remove();
  document.querySelectorAll('.ltch-modal-backdrop').forEach(el=>el.remove());
  document.querySelector('#qa-portal').replaceChildren();
  document.body.classList.remove('ltch-exam-body-lock');
  window.qaType=type;
  const cur = screen==='combo'?'part_3':type==='thptqg'?'all':'part_2';
  attempt = {examId:'qa-exam',attemptId:'qa-'+type+'-'+Date.now(),examType:type,examTitle:title,activeDeviceToken:'synthetic-device',currentSection:cur,serverNow:Date.now(),deadlineAt:Date.now()+3600000,sectionStates:{[cur]:{status:['wait','combo'].includes(screen)?'waiting':'in_progress',durationMinutes:60,deadlineAt:Date.now()+3600000,waitEndsAt:Date.now()+120000}},visibleQuestions:questions(type),responses:{},draftMeta:{}};
  const onCloseToLobby=()=>window.qa(type,'lobby');
  if(screen==='result'||screen==='summary')return window.rooms.mountResultReviewOverlay({resultData:result(type), access, api, status, onCloseToLobby, onRetakeExam:()=>window.qa(type),showHsaSummaryFirst:screen==='summary'});
  if(screen==='lobby'||screen==='hub')return window.rooms.renderPracticeRoomsPortal({container:document.querySelector('#qa-portal'),api,status,initialExamType:screen==='hub'?null:type});
  cleanupRoom = window.rooms.mountExamTakingOverlay({initialAttempt:attempt,access,api,status,onSubmitted:data=>window.rooms.mountResultReviewOverlay({resultData:data,access,api,status,onCloseToLobby}),onExitLobby:onCloseToLobby,onSwitchMode:onCloseToLobby});
};
await window.qa(new URL(location.href).searchParams.get('type')||'tsa',new URL(location.href).searchParams.get('screen')||'room');
</script></body></html>`;

http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://127.0.0.1:5182');
  if(url.pathname.startsWith('/qa-fonts/')){
    const name=url.pathname.slice('/qa-fonts/'.length);
    if(!/^(?:fonts\.css|[a-f0-9]{16}\.woff2)$/.test(name)){res.writeHead(403);res.end();return;}
    res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css':'font/woff2'});
    res.end(await readFile(resolve(root,'.local/practice-responsive/fonts',name)));return;
  }
  if(url.pathname==='/qa.js'){
    const mtime=(await stat('client/practice-rooms.mjs')).mtimeMs;
    if(mtime!==sourceMtime){bundle=await buildCurrent();sourceMtime=mtime;}
    res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bundle.outputFiles[0].text);return;
  }
  if(url.pathname==='/baseline-qa.js'){if(!baselineBundle){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/javascript'});res.end(baselineBundle.outputFiles[0].text);return;}
  if(url.pathname==='/baseline.css'){try{const css=await readFile('.local/practice-responsive/app.before.css');res.writeHead(200,{'Content-Type':'text/css'});res.end(css);}catch{res.writeHead(404);res.end();}return;}
  if(url.pathname==='/' ){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end(url.searchParams.has('baseline')?html.replaceAll('/qa.js','/baseline-qa.js').replace('/app.css','/baseline.css'):html);
    return;
  }
  const file = resolve(root,'public','.'+url.pathname);
  if(!file.startsWith(resolve(root,'public')+ '\\')){res.writeHead(403);res.end();return;}
  try { const data=await readFile(file);res.writeHead(200,{'Content-Type':({'.css':'text/css','.png':'image/png','.webp':'image/webp','.js':'text/javascript','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});res.end(data); }
  catch{res.writeHead(404);res.end();}
}).listen(5182,'127.0.0.1',()=>console.log('Practice visual QA http://127.0.0.1:5182'));
