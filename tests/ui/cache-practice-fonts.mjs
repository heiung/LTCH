// Cache the website's public Google Fonts for deterministic, offline visual QA.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const html=await readFile('public/app.html','utf8');
const url=html.match(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"\n]+)"/)[1];
const folder='.local/practice-responsive/fonts';
await mkdir(folder,{recursive:true});
const cssResponse=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'}});
if(!cssResponse.ok)throw new Error(`Fonts CSS: ${cssResponse.status}`);
let css=await cssResponse.text();
const urls=[...new Set([...css.matchAll(/https:\/\/fonts\.gstatic\.com\/[^\s)]+/g)].map(match=>match[0]))];
for(const source of urls){
  const response=await fetch(source);
  if(!response.ok)throw new Error(`Font download: ${response.status}`);
  const name=createHash('sha256').update(source).digest('hex').slice(0,16)+'.woff2';
  await writeFile(`${folder}/${name}`,Buffer.from(await response.arrayBuffer()));
  css=css.replaceAll(source,`/qa-fonts/${name}`);
}
await writeFile(`${folder}/fonts.css`,css);
console.log(`Cached ${urls.length} public font files for local QA.`);
