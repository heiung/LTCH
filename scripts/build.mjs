import {build} from 'esbuild';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
await build({entryPoints:['client/app.js'],bundle:true,minify:true,format:'esm',target:'es2022',outfile:'public/app.js'});
const [jsBytes,cssBytes,appHtmlRaw]=await Promise.all([readFile('public/app.js'),readFile('public/app.css'),readFile('public/app.html','utf8')]);
const jsHash=createHash('sha256').update(jsBytes).digest('hex').slice(0,10);
const cssHash=createHash('sha256').update(cssBytes).digest('hex').slice(0,10);
const updatedAppHtml=appHtmlRaw
  .replace(/\/app\.css(?:\?v=[^"']+)?/g,`/app.css?v=${cssHash}`)
  .replace(/\/app\.js(?:\?v=[^"']+)?/g,`/app.js?v=${jsHash}`);
if(updatedAppHtml!==appHtmlRaw)await writeFile('public/app.html',updatedAppHtml);
await mkdir('public/mathlive',{recursive:true});
await cp('node_modules/mathlive/fonts', 'public/mathlive/fonts', {recursive:true});
await mkdir('public/pdfjs',{recursive:true});
await cp('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs','public/pdfjs/pdf.worker.min.mjs');
for(const dir of ['cmaps','standard_fonts','wasm','iccs'])await cp(`node_modules/pdfjs-dist/${dir}`,`public/pdfjs/${dir}`,{recursive:true});
await mkdir('.deploy/api',{recursive:true});
await build({entryPoints:['worker/index.mjs'],bundle:true,minify:true,format:'esm',platform:'browser',mainFields:['browser','module','main'],target:'es2022',external:['node:*'],banner:{js:"import * as ltchCrypto from 'node:crypto'; import {Buffer} from 'node:buffer'; const require = name => { if(name === 'node:crypto') return ltchCrypto; throw new Error('Unsupported dependency'); };"},outfile:'.deploy/api/_worker.js'});
await writeFile('.deploy/api/_routes.json',JSON.stringify({version:1,include:['/*'],exclude:[]}));
// Advanced Mode provides only the API. The website stays on Firebase Hosting.
await writeFile('.deploy/api/index.html','<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="color-scheme" content="only light"><title>LTCH API</title><p>Dịch vụ LTCH</p></html>');
await writeFile('.deploy/api/package.json','{"type":"module"}');
const {default:runtime}=await import(pathToFileURL(resolve('.deploy/api/_worker.js')).href+'?build='+Date.now());
const check=await runtime.fetch(new Request('https://test/api/health'),{});
if(check.status!==200||(await check.json()).ready!==false)throw Error('Bản đóng gói không khởi động đúng.');
process.stdout.write('Đã đóng gói giao diện và API. Không chứa bí mật máy chủ.\n');
