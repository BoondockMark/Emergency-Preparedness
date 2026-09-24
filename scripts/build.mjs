import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import puppeteer from 'puppeteer';
import { inspectSheetGeometry, formatLayoutIssue } from './lib/layout-validation.mjs';
import { getPdfPageCount } from './lib/pdf-validation.mjs';
import { compareFixture, VISUAL_TOLERANCE } from './lib/visual-regression.mjs';
const root=path.resolve(import.meta.dirname,'..');
const updateVisuals=process.argv.includes('--update-visuals');
if(updateVisuals)await fs.copyFile(path.join(root,'assets/styles/print.css'),path.join(root,'test/fixtures/baseline.css'));
const sections=['Start Here','Alerts & Communication','Evacuation & Shelter','Water, Food & Cooking','Home & Utilities','Hands-On Skills','Hazard Guides','Plans & Records'];
const statuses=['draft','under-review','approved'];
const required=['code','title','section','sectionNumber','status','version','lastReviewed','pageCount','reviewers','sources'];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function walk(d){return (await Promise.all((await fs.readdir(d,{withFileTypes:true})).map(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]))).flat()}
function parseScalar(v){v=v.trim();if(/^\d+$/.test(v))return Number(v);return v.replace(/^['"]|['"]$/g,'')}
function frontMatter(raw,file){const match=raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);if(!match)throw Error(`${file}: missing YAML front matter`);const data={};let parent=null;for(const line of match[1].split('\n')){if(!line.trim())continue;const list=line.match(/^\s+-\s+(.*)$/);if(list){if(!Array.isArray(data[parent]))data[parent]=[];data[parent].push(parseScalar(list[1]));continue}const kv=line.match(/^(\s*)([\w]+):\s*(.*)$/);if(!kv)throw Error(`${file}: unsupported metadata line: ${line}`);const [,indent,key,value]=kv;if(indent){if(!parent||Array.isArray(data[parent]))throw Error(`${file}: invalid nested metadata`);data[parent][key]=parseScalar(value)}else{parent=key;data[key]=value?parseScalar(value):key==='reviewers'?{}:[]}}return{data,content:match[2]}}
function inline(s){return s.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>')}
function markdown(src){let out='',list=null;for(const raw of src.split('\n')){const s=raw.trim();if(!s){if(list){out+=`</${list}>`;list=null}continue}if(s.startsWith('<')||s.startsWith('</')){out+=raw+'\n';continue}const h=s.match(/^(#{2,3})\s+(.*)$/);if(h){if(list){out+=`</${list}>`;list=null}const n=h[1].length;out+=`<h${n}>${inline(h[2])}</h${n}>`;continue}const li=s.match(/^[-*]\s+(.*)$/);if(li){if(list!=='ul'){if(list)out+=`</${list}>`;out+='<ul>';list='ul'}out+=`<li>${inline(li[1])}</li>`;continue}out+=`<p>${inline(s)}</p>`}if(list)out+=`</${list}>`;return out}
const files=(await walk(path.join(root,'handouts'))).filter(f=>f.endsWith('.md')).sort(),docs=[],codes=new Set();for(const file of files){const {data:d,content}=frontMatter(await fs.readFile(file,'utf8'),path.relative(root,file));for(const k of required)if(d[k]===undefined||d[k]==='')throw Error(`${file}: missing metadata '${k}'`);if(codes.has(d.code))throw Error(`duplicate code ${d.code}`);codes.add(d.code);if(!sections.includes(d.section)||d.sectionNumber!==sections.indexOf(d.section)+1)throw Error(`${d.code}: invalid section metadata`);if(!statuses.includes(d.status))throw Error(`${d.code}: invalid status`);const chunks=content.split(/\n<!--\s*pagebreak\s*-->\n/i);if(![1,2].includes(d.pageCount)||chunks.length!==d.pageCount)throw Error(`${d.code}: wrong page count`);if(!d.reviewers.editor||!d.reviewers.subjectMatter||!d.sources.length)throw Error(`${d.code}: incomplete review/source metadata`);docs.push({meta:d,chunks})}
await fs.rm(path.join(root,'build'),{recursive:true,force:true});for(const d of ['build/html','build/assets/fonts','build/diagnostics','docs/pdfs','docs/previews'])await fs.mkdir(path.join(root,d),{recursive:true});
await fs.copyFile(path.join(root,'assets/styles/print.css'),path.join(root,'build/assets/print.css'));
for(const font of ['DejaVuSans.ttf','DejaVuSans-Bold.ttf']){const encoded=await fs.readFile(path.join(root,'assets/fonts',font+'.gz.base64'),'ascii');await fs.writeFile(path.join(root,'build/assets/fonts',font),gunzipSync(Buffer.from(encoded.replace(/\s/g,''),'base64')));}
const tpl=await fs.readFile(path.join(root,'templates/handout.html'),'utf8');for(const {meta:m,chunks} of docs){const pages=chunks.map((c,i)=>`<article class="sheet ${i?'back':'front'}"><div class="edge">${esc(m.section.toUpperCase())} · ${String(m.sectionNumber).padStart(2,'0')}</div><main class="content"><header class="kicker">La Habra Heights Fire Watch · Emergency Preparedness Binder <span class="status">${esc(m.status.toUpperCase())}</span></header><h1>${esc(i?m.title+' — continued':m.title)}</h1>${markdown(c)}<footer class="footer"><span>${m.code} · v${m.version}</span><span>Last reviewed: ${m.lastReviewed}</span><span>${i+1} of ${m.pageCount}</span></footer></main></article>`).join('');const html=tpl.replace('{{title}}',esc(m.title)).replace('{{cssPath}}','../assets/print.css').replace('{{pages}}',pages);for(const x of html.matchAll(/(?:href|src)="([^"]+)"/g)){if(/^(https?:|#|mailto:|data:)/.test(x[1]))continue;try{await fs.access(path.resolve(root,'build/html',x[1]))}catch{throw Error(`${m.code}: broken local link ${x[1]}`)}}await fs.writeFile(path.join(root,'build/html',m.code+'.html'),html);}
const fixtureSource=await fs.readFile(path.join(root,'test/fixtures/components.html'),'utf8');
const fixtureHtml=fixtureSource.replace('{{cssPath}}','../assets/print.css');
await fs.writeFile(path.join(root,'build/html/components-fixture.html'),fixtureHtml);
await fs.copyFile(path.join(root,'test/fixtures/baseline.css'),path.join(root,'build/assets/baseline.css'));
await fs.writeFile(path.join(root,'build/html/components-baseline.html'),fixtureSource.replace('{{cssPath}}','../assets/baseline.css'));
const browser=await puppeteer.launch({headless:true,args:['--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-domain-reliability','--disable-features=Translate,MediaRouter,OptimizationHints','--disable-sync','--font-render-hinting=none','--force-color-profile=srgb','--lang=en-US','--no-first-run','--no-pings','--no-sandbox'],env:{...process.env,LANG:'en_US.UTF-8',TZ:'UTC'}});
try{
  for(const {meta:m} of docs){
    const page=await browser.newPage();
    await page.setViewport({width:816,height:1056,deviceScaleFactor:1});
    await page.setRequestInterception(true);
    page.on('request',request=>{const url=request.url();if(url.startsWith('file:')||url.startsWith('data:'))request.continue();else request.abort('blockedbyclient')});
    await page.emulateMediaType('print');
    await page.goto(pathToFileURL(path.join(root,'build/html',m.code+'.html')).href,{waitUntil:'load'});
    await page.evaluate(async()=>document.fonts.ready);
    const fontReady=await page.evaluate(()=>document.fonts.check('12px "Binder Sans"'));
    if(!fontReady)throw Error(`${m.code}: pinned Binder Sans font did not load`);
    const sheetCount=await page.$$eval('.sheet',sheets=>sheets.length);
    if(sheetCount!==m.pageCount)throw Error(`${m.code}: HTML page count ${sheetCount}, expected ${m.pageCount}`);
    const layoutIssues=await inspectSheetGeometry(page,m.code);
    if(layoutIssues.length){
      await fs.writeFile(path.join(root,'build/diagnostics',`${m.code}-layout.json`),JSON.stringify(layoutIssues,null,2));
      await page.screenshot({path:path.join(root,'build/diagnostics',`${m.code}-layout.png`),fullPage:true});
      throw Error(`Layout validation failed:\n${layoutIssues.map(formatLayoutIssue).join('\n')}`);
    }
    const pdf=await page.pdf({width:'8.5in',height:'11in',margin:{top:0,right:0,bottom:0,left:0},printBackground:true,preferCSSPageSize:true,tagged:false,outline:false});
    await fs.writeFile(path.join(root,'docs/pdfs',m.code+'.pdf'),pdf);
    const count=await getPdfPageCount(pdf);
    if(count!==m.pageCount)throw Error(`${m.code}: PDF page count ${count}, expected ${m.pageCount}`);
    const sheets=await page.$$('.sheet');
    for(let i=0;i<sheets.length;i++)await sheets[i].screenshot({path:path.join(root,'docs/previews',`${m.code}-page-${i+1}.png`),type:'png',omitBackground:false});
    await page.close();
  }
  const fixturePage=await browser.newPage();
  await fixturePage.setViewport({width:816,height:1056,deviceScaleFactor:1});
  await fixturePage.emulateMediaType('print');
  await fixturePage.goto(pathToFileURL(path.join(root,'build/html/components-fixture.html')).href,{waitUntil:'load'});
  await fixturePage.evaluate(async()=>document.fonts.ready);
  const fixtureIssues=await inspectSheetGeometry(fixturePage,'FIX-00');
  if(fixtureIssues.length)throw Error(`Component fixture layout failed:\n${fixtureIssues.map(formatLayoutIssue).join('\n')}`);
  const fixtureActual=path.join(root,'build/diagnostics/components-actual.png');
  await (await fixturePage.$('.sheet')).screenshot({path:fixtureActual,type:'png',omitBackground:false});
  const baselinePage=await browser.newPage();
  await baselinePage.setViewport({width:816,height:1056,deviceScaleFactor:1});
  await baselinePage.emulateMediaType('print');
  await baselinePage.goto(pathToFileURL(path.join(root,'build/html/components-baseline.html')).href,{waitUntil:'load'});
  await baselinePage.evaluate(async()=>document.fonts.ready);
  const fixtureBaseline=path.join(root,'build/diagnostics/components-baseline.png');
  await (await baselinePage.$('.sheet')).screenshot({path:fixtureBaseline,type:'png',omitBackground:false});
  await compareFixture(fixturePage,fixtureActual,fixtureBaseline,path.join(root,'build/diagnostics'));
  await baselinePage.close();
  await fixturePage.close();
}finally{await browser.close()}
const groups=sections.map((s,i)=>`## ${i+1}. ${s}\n\n| Code | Title | Status | Version | Last reviewed | Pages |\n|---|---|---|---|---|---:|\n`+(docs.filter(d=>d.meta.section===s).map(d=>`| ${d.meta.code} | ${d.meta.title} | ${d.meta.status} | ${d.meta.version} | ${d.meta.lastReviewed} | ${d.meta.pageCount} |`).join('\n')||'| — | _No handouts yet_ | — | — | — | — |')).join('\n\n');await fs.writeFile(path.join(root,'BINDER_INDEX.md'),`# Binder index\n\nGenerated by \`npm run build\`. Only approved documents may be published to Moodle.\n\n${groups}\n`);const approved=docs.filter(d=>d.meta.status==='approved');await fs.writeFile(path.join(root,'docs/moodle-index.html'),'<!-- Generated; approved handouts only. Replace PDF_URL after Moodle upload. -->\n<div class="lhhfw-binder"><h1>Emergency Preparedness Binder</h1>'+sections.map(s=>`<section><h2>${esc(s)}</h2>${approved.some(d=>d.meta.section===s)?'<ul>'+approved.filter(d=>d.meta.section===s).map(d=>`<li><a href="PDF_URL/${d.meta.code}.pdf">${esc(d.meta.title)}</a> (${d.meta.code}, reviewed ${d.meta.lastReviewed})</li>`).join('')+'</ul>':'<p><em>No approved handouts currently published.</em></p>'}</section>`).join('')+'</div>\n');console.log(`Built and checked ${docs.length} handouts / ${docs.reduce((n,d)=>n+d.meta.pageCount,0)} PDF pages. Visual fixture tolerance: ${VISUAL_TOLERANCE.maxDifferentPixelRatio*100}%.`)
