import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import puppeteer from 'puppeteer';
import { inspectSheetGeometry, formatLayoutIssue } from './lib/layout-validation.mjs';
import { inspectAccessibility, formatAccessibilityIssue } from './lib/accessibility-validation.mjs';
import { getPdfPageCount, inspectEmbeddedFonts } from './lib/pdf-validation.mjs';
import { compareFixture, VISUAL_TOLERANCE } from './lib/visual-regression.mjs';
import { createCalibrationPdf } from './lib/calibration-pdf.mjs';
const root=path.resolve(import.meta.dirname,'..');
const updateVisuals=process.argv.includes('--update-visuals');
if(updateVisuals)await fs.copyFile(path.join(root,'assets/styles/print.css'),path.join(root,'test/fixtures/baseline.css'));
const sections=['Start Here','Alerts & Communication','Evacuation & Shelter','Water, Food & Cooking','Home & Utilities','Hands-On Skills','Hazard Guides','Plans & Records'];
const statuses=['draft','under-review','approved'];
const required=['code','title','section','sectionNumber','status','version','lastReviewed','pageCount','reviewers','sources'];
const PRINT_PPI=200;
const FONT_HASHES={
  'DejaVuSans.ttf':'ae7b7855e115a5966d8b1b3f80f254ccc117ec86f9965e202ee2940453837280',
  'DejaVuSans-Bold.ttf':'5c1247acef7f2b8522a31742c76d6adcb5569bacc0be7ceaa4dc39dd252ce895'
};
const assetRoot=path.join(root,'assets/handouts');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function walk(d){return (await Promise.all((await fs.readdir(d,{withFileTypes:true})).map(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]))).flat()}
function parseScalar(v){v=v.trim();if(/^\d+$/.test(v))return Number(v);return v.replace(/^['"]|['"]$/g,'')}
function frontMatter(raw,file){const match=raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);if(!match)throw Error(`${file}: missing YAML front matter`);const data={};let parent=null;for(const line of match[1].split('\n')){if(!line.trim())continue;const list=line.match(/^\s+-\s+(.*)$/);if(list){if(!Array.isArray(data[parent]))data[parent]=[];data[parent].push(parseScalar(list[1]));continue}const kv=line.match(/^(\s*)([\w]+):\s*(.*)$/);if(!kv)throw Error(`${file}: unsupported metadata line: ${line}`);const [,indent,key,value]=kv;if(indent){if(!parent||Array.isArray(data[parent]))throw Error(`${file}: invalid nested metadata`);data[parent][key]=parseScalar(value)}else{parent=key;data[key]=value?parseScalar(value):key==='reviewers'?{}:[]}}return{data,content:match[2]}}
function inline(s){return s.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>')}
function markdown(src){let out='',list=null;for(const raw of src.split('\n')){const s=raw.trim();if(!s){if(list){out+=`</${list}>`;list=null}continue}if(s.startsWith('<')||s.startsWith('</')){out+=raw+'\n';continue}const h=s.match(/^(#{2,3})\s+(.*)$/);if(h){if(list){out+=`</${list}>`;list=null}const n=h[1].length;out+=`<h${n}>${inline(h[2])}</h${n}>`;continue}const li=s.match(/^[-*]\s+(.*)$/);if(li){if(list!=='ul'){if(list)out+=`</${list}>`;out+='<ul>';list='ul'}out+=`<li>${inline(li[1])}</li>`;continue}out+=`<p>${inline(s)}</p>`}if(list)out+=`</${list}>`;return out}
function imageReferences(html,label){return [...html.matchAll(/<img\b([^>]*)>/gi)].map(match=>{const attrs=Object.fromEntries([...match[1].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(([,key,,value])=>[key.toLowerCase(),value]));if(!('src' in attrs))throw Error(`${label}: image is missing src`);if('srcset' in attrs)throw Error(`${label}: srcset is not supported; use one validated local print asset`);if(!('alt' in attrs))throw Error(`${label}: image ${attrs.src} must have alt (use alt="" only for a manifest-declared decorative image)`);return attrs})}
function safeAssetPath(src,label){if(/^(?:[a-z]+:|\/|\\|[a-z]:[\\/])/i.test(src))throw Error(`${label}: image paths must be repository-relative, not absolute or remote: ${src}`);const match=src.match(/^\.\.\/assets\/handouts\/([^/]+)\/([^?#]+)$/);if(!match||match[2].includes('..'))throw Error(`${label}: images must use ../assets/handouts/<CODE>/<file>: ${src}`);return{code:match[1],file:match[2]}}
function pngSize(buffer){if(buffer.length<24||buffer.toString('hex',0,8)!=='89504e470d0a1a0a')return null;return{width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)}}
function jpegSize(buffer){if(buffer[0]!==0xff||buffer[1]!==0xd8)return null;for(let offset=2;offset+9<buffer.length;){if(buffer[offset]!==0xff){offset++;continue}const marker=buffer[offset+1],length=buffer.readUInt16BE(offset+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return{height:buffer.readUInt16BE(offset+5),width:buffer.readUInt16BE(offset+7)};if(length<2)break;offset+=2+length}return null}
function sanitizeSvg(source,label){if(!/^\s*<svg\b/i.test(source)||/<!DOCTYPE|<!ENTITY/i.test(source)||/<\/?(?:script|foreignObject|iframe|object|embed|audio|video)\b/i.test(source)||/\son[a-z]+\s*=/i.test(source)||/(?:href|src)\s*=\s*["'](?!#)[^"']+/i.test(source)||/url\s*\(\s*["']?(?!#)/i.test(source))throw Error(`${label}: SVG contains disallowed active or external content`);return source}
async function loadManifests(){const manifests=new Map();try{for(const dirent of await fs.readdir(assetRoot,{withFileTypes:true})){if(!dirent.isDirectory())throw Error(`assets/handouts may contain only <CODE> directories: ${dirent.name}`);const code=dirent.name,dir=path.join(assetRoot,code),manifestFile=path.join(dir,'manifest.json');let manifest;try{manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'))}catch(error){throw Error(`${path.relative(root,manifestFile)}: missing or invalid manifest (${error.message})`)}if(!Array.isArray(manifest.assets))throw Error(`${code}: manifest must contain an assets array`);const entries=new Map();for(const entry of manifest.assets){for(const field of ['file','type','creator','source','license','decorative'])if(entry[field]===undefined||entry[field]==='')throw Error(`${code}/${entry.file||'?'}: missing asset metadata '${field}'`);if(typeof entry.decorative!=='boolean')throw Error(`${code}/${entry.file}: decorative must be true or false`);if(entry.decorative){if(entry.alt!=='')throw Error(`${code}/${entry.file}: decorative assets must set alt to an empty string`)}else if(typeof entry.alt!=='string'||!entry.alt.trim())throw Error(`${code}/${entry.file}: non-decorative assets require useful alt text`);if(!['photograph','illustration','diagram'].includes(entry.type))throw Error(`${code}/${entry.file}: invalid asset type`);if(entries.has(entry.file)||path.basename(entry.file)!==entry.file)throw Error(`${code}: asset file names must be unique and cannot contain directories`);const ext=path.extname(entry.file).toLowerCase();if(!['.svg','.png','.jpg','.jpeg'].includes(ext))throw Error(`${code}/${entry.file}: unsuitable print format; use SVG, PNG, or JPEG`);const full=path.join(dir,entry.file);let bytes;try{bytes=await fs.readFile(full)}catch{throw Error(`${code}: manifest asset is missing: ${entry.file}`)}if(entry.type==='diagram'&&ext!=='.svg')throw Error(`${code}/${entry.file}: diagrams must use sanitized SVG`);if(ext==='.svg')sanitizeSvg(bytes.toString('utf8'),`${code}/${entry.file}`);else if(!(ext==='.png'?pngSize(bytes):jpegSize(bytes)))throw Error(`${code}/${entry.file}: file contents do not match its supported extension`);entries.set(entry.file,entry)}manifests.set(code,entries)}}catch(error){if(error.code!=='ENOENT')throw error}return manifests}
const manifests=await loadManifests();
const files=(await walk(path.join(root,'handouts'))).filter(f=>f.endsWith('.md')).sort(),docs=[],codes=new Set();for(const file of files){const {data:d,content}=frontMatter(await fs.readFile(file,'utf8'),path.relative(root,file));for(const k of required)if(d[k]===undefined||d[k]==='')throw Error(`${file}: missing metadata '${k}'`);if(codes.has(d.code))throw Error(`duplicate code ${d.code}`);codes.add(d.code);if(!sections.includes(d.section)||d.sectionNumber!==sections.indexOf(d.section)+1)throw Error(`${d.code}: invalid section metadata`);if(!statuses.includes(d.status))throw Error(`${d.code}: invalid status`);const chunks=content.split(/\n<!--\s*pagebreak\s*-->\n/i);if(![1,2].includes(d.pageCount)||chunks.length!==d.pageCount)throw Error(`${d.code}: wrong page count`);if(!d.reviewers.editor||!d.reviewers.subjectMatter||!d.sources.length)throw Error(`${d.code}: incomplete review/source metadata`);for(const attrs of imageReferences(content,d.code)){const ref=safeAssetPath(attrs.src,d.code);if(ref.code!==d.code)throw Error(`${d.code}: image assets must be stored in their own code directory, not ${ref.code}`);const entry=manifests.get(ref.code)?.get(ref.file);if(!entry)throw Error(`${d.code}: ${ref.file} is not declared in assets/handouts/${d.code}/manifest.json`);if(attrs.alt!==entry.alt)throw Error(`${d.code}/${ref.file}: HTML alt text must exactly match manifest alt text`)}docs.push({meta:d,chunks})}
await fs.rm(path.join(root,'build'),{recursive:true,force:true});for(const d of ['build/html','build/assets/fonts','build/diagnostics','build/calibration','docs/pdfs','docs/previews'])await fs.mkdir(path.join(root,d),{recursive:true});
await fs.copyFile(path.join(root,'assets/styles/print.css'),path.join(root,'build/assets/print.css'));
await fs.mkdir(path.join(root,'build/assets/handouts'),{recursive:true});
for(const [code,entries] of manifests){const destination=path.join(root,'build/assets/handouts',code);await fs.mkdir(destination,{recursive:true});for(const file of entries.keys()){const source=path.join(assetRoot,code,file),target=path.join(destination,file);if(path.extname(file).toLowerCase()==='.svg')await fs.writeFile(target,sanitizeSvg(await fs.readFile(source,'utf8'),`${code}/${file}`));else await fs.copyFile(source,target)}}
for(const [font,expectedHash] of Object.entries(FONT_HASHES)){const encoded=await fs.readFile(path.join(root,'assets/fonts',font+'.gz.base64'),'ascii');const decoded=gunzipSync(Buffer.from(encoded.replace(/\s/g,''),'base64'));const actualHash=createHash('sha256').update(decoded).digest('hex');if(actualHash!==expectedHash)throw Error(`${font}: decoded font hash ${actualHash} does not match the reviewed font ${expectedHash}`);await fs.writeFile(path.join(root,'build/assets/fonts',font),decoded);}
const tpl=await fs.readFile(path.join(root,'templates/handout.html'),'utf8');for(const {meta:m,chunks} of docs){const pages=chunks.map((c,i)=>`<article class="sheet ${i?'back':'front'}"><div class="edge">${esc(m.section.toUpperCase())} · ${String(m.sectionNumber).padStart(2,'0')}</div><main class="content"><header class="kicker">La Habra Heights Fire Watch · Emergency Preparedness Binder <span class="status">${esc(m.status.toUpperCase())}</span></header><h1>${esc(i?m.title+' — continued':m.title)}</h1>${markdown(c)}<footer class="footer"><span>${m.code} · v${m.version}</span><span>Last reviewed: ${m.lastReviewed}</span><span>${i+1} of ${m.pageCount}</span></footer></main></article>`).join('');const html=tpl.replace('{{title}}',esc(m.title)).replace('{{cssPath}}','../assets/print.css').replace('{{pages}}',pages);for(const x of html.matchAll(/(?:href|src)="([^"]+)"/g)){if(/^(https?:|#|mailto:|data:)/.test(x[1]))continue;try{await fs.access(path.resolve(root,'build/html',x[1]))}catch{throw Error(`${m.code}: broken local link ${x[1]}`)}}await fs.writeFile(path.join(root,'build/html',m.code+'.html'),html);}
const fixtureSource=await fs.readFile(path.join(root,'test/fixtures/components.html'),'utf8');
for(const attrs of imageReferences(fixtureSource,'FIX-00')){const ref=safeAssetPath(attrs.src,'FIX-00'),entry=manifests.get(ref.code)?.get(ref.file);if(!entry)throw Error(`FIX-00: ${ref.file} is not declared in its asset manifest`);if(attrs.alt!==entry.alt)throw Error(`FIX-00/${ref.file}: HTML alt text must exactly match manifest alt text`)}
const fixtureHtml=fixtureSource.replace('{{cssPath}}','../assets/print.css');
await fs.writeFile(path.join(root,'build/html/components-fixture.html'),fixtureHtml);
await fs.copyFile(path.join(root,'test/fixtures/baseline.css'),path.join(root,'build/assets/baseline.css'));
await fs.writeFile(path.join(root,'build/html/components-baseline.html'),fixtureSource.replace('{{cssPath}}','../assets/baseline.css'));
const browser=await puppeteer.launch({headless:true,args:['--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-domain-reliability','--disable-features=Translate,MediaRouter,OptimizationHints','--disable-sync','--font-render-hinting=none','--force-color-profile=srgb','--lang=en-US','--no-first-run','--no-pings','--no-sandbox'],env:{...process.env,LANG:'en_US.UTF-8',TZ:'UTC'}});
try{
  const calibrationPdf=createCalibrationPdf();
  await fs.writeFile(path.join(root,'build/calibration/printer-calibration.pdf'),calibrationPdf);
  if(await getPdfPageCount(calibrationPdf)!==2)throw Error('Printer calibration PDF must contain exactly two pages');
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
    const lowResolution=await page.$$eval('img', (images,minimum)=>images.flatMap(image=>{if(image.currentSrc.toLowerCase().endsWith('.svg'))return[];const widthInches=image.getBoundingClientRect().width/96;const ppi=image.naturalWidth/widthInches;return ppi+0.01<minimum?[`${image.getAttribute('src')}: ${Math.floor(ppi)} PPI at ${widthInches.toFixed(2)}in wide`]:[]}),PRINT_PPI);
    if(lowResolution.length)throw Error(`${m.code}: raster image below ${PRINT_PPI} PPI: ${lowResolution.join('; ')}`);
    const sheetCount=await page.$$eval('.sheet',sheets=>sheets.length);
    if(sheetCount!==m.pageCount)throw Error(`${m.code}: HTML page count ${sheetCount}, expected ${m.pageCount}`);
    const layoutIssues=await inspectSheetGeometry(page,m.code);
    if(layoutIssues.length){
      await fs.writeFile(path.join(root,'build/diagnostics',`${m.code}-layout.json`),JSON.stringify(layoutIssues,null,2));
      await page.screenshot({path:path.join(root,'build/diagnostics',`${m.code}-layout.png`),fullPage:true});
      throw Error(`Layout validation failed:\n${layoutIssues.map(formatLayoutIssue).join('\n')}`);
    }
    const accessibilityIssues=await inspectAccessibility(page,m.code);
    if(accessibilityIssues.length)throw Error(`Accessibility validation failed:\n${accessibilityIssues.map(formatAccessibilityIssue).join('\n')}`);
    const pdf=await page.pdf({width:'8.5in',height:'11in',margin:{top:0,right:0,bottom:0,left:0},printBackground:true,preferCSSPageSize:true,tagged:false,outline:false});
    await fs.writeFile(path.join(root,'docs/pdfs',m.code+'.pdf'),pdf);
    const count=await getPdfPageCount(pdf);
    if(count!==m.pageCount)throw Error(`${m.code}: PDF page count ${count}, expected ${m.pageCount}`);
    const fonts=inspectEmbeddedFonts(pdf);
    if(!fonts.embeddedPrograms)throw Error(`${m.code}: generated PDF has no embedded font program (${fonts.fontNames.join(', ')||'no fonts found'})`);
    if(!fonts.fontNames.some(name=>name.includes('DejaVuSans')))throw Error(`${m.code}: generated PDF does not identify the bundled DejaVu Sans family (${fonts.fontNames.join(', ')||'no fonts found'})`);
    const sheets=await page.$$('.sheet');
    for(let i=0;i<sheets.length;i++)await sheets[i].screenshot({path:path.join(root,'docs/previews',`${m.code}-page-${i+1}.png`),type:'png',omitBackground:false});
    await page.close();
  }
  const fixturePage=await browser.newPage();
  await fixturePage.setViewport({width:816,height:1056,deviceScaleFactor:1});
  await fixturePage.emulateMediaType('print');
  await fixturePage.goto(pathToFileURL(path.join(root,'build/html/components-fixture.html')).href,{waitUntil:'load'});
  await fixturePage.evaluate(async()=>document.fonts.ready);
  const fixtureLowResolution=await fixturePage.$$eval('img', (images,minimum)=>images.flatMap(image=>image.currentSrc.toLowerCase().endsWith('.svg')?[]:image.naturalWidth/(image.getBoundingClientRect().width/96)+0.01<minimum?[image.getAttribute('src')]:[]),PRINT_PPI);
  if(fixtureLowResolution.length)throw Error(`FIX-00: raster image below ${PRINT_PPI} PPI: ${fixtureLowResolution.join(', ')}`);
  const fixtureIssues=await inspectSheetGeometry(fixturePage,'FIX-00');
  if(fixtureIssues.length)throw Error(`Component fixture layout failed:\n${fixtureIssues.map(formatLayoutIssue).join('\n')}`);
  const fixtureAccessibilityIssues=await inspectAccessibility(fixturePage,'FIX-00');
  if(fixtureAccessibilityIssues.length)throw Error(`Component fixture accessibility failed:\n${fixtureAccessibilityIssues.map(formatAccessibilityIssue).join('\n')}`);
  const fixtureActual=path.join(root,'build/diagnostics/components-actual.png');
  await fixturePage.screenshot({path:fixtureActual,type:'png',omitBackground:false,fullPage:true});
  const baselinePage=await browser.newPage();
  await baselinePage.setViewport({width:816,height:1056,deviceScaleFactor:1});
  await baselinePage.emulateMediaType('print');
  await baselinePage.goto(pathToFileURL(path.join(root,'build/html/components-baseline.html')).href,{waitUntil:'load'});
  await baselinePage.evaluate(async()=>document.fonts.ready);
  const fixtureBaseline=path.join(root,'build/diagnostics/components-baseline.png');
  await baselinePage.screenshot({path:fixtureBaseline,type:'png',omitBackground:false,fullPage:true});
  await compareFixture(fixturePage,fixtureActual,fixtureBaseline,path.join(root,'build/diagnostics'));
  await baselinePage.close();
  await fixturePage.close();
}finally{await browser.close()}
for(const {meta:m} of docs){
  if(m.status!=='approved')continue;
  if(!m.proofRecord)throw Error(`${m.code}: approved handouts require proofRecord metadata`);
  const recordPath=path.resolve(root,m.proofRecord);
  if(!recordPath.startsWith(path.join(root,'docs/publishing/proofs')+path.sep))throw Error(`${m.code}: proofRecord must be under docs/publishing/proofs/`);
  const record=await fs.readFile(recordPath,'utf8');
  const field=name=>record.match(new RegExp(`^${name}:\\s*["']?([^\\n"']+)["']?\\s*$`,'m'))?.[1].trim();
  const expected={handoutCode:m.code,pdfPath:`docs/pdfs/${m.code}.pdf`};
  for(const [name,value] of Object.entries(expected))if(field(name)!==value)throw Error(`${m.code}: proof record ${name} must be ${value}`);
  for(const name of ['sourceCommit','pdfSha256','printerModel','driverOrApplication','paperSize','scaling','duplex','reviewer','date','grayscaleOutcome','punchClearanceOutcome','measuredAlignment'])if(!field(name))throw Error(`${m.code}: proof record is missing ${name}`);
  if(!/^[0-9a-f]{40}$/.test(field('sourceCommit')))throw Error(`${m.code}: proof record sourceCommit must be a full Git commit SHA`);
  const pdf=await fs.readFile(path.join(root,expected.pdfPath));
  const checksum=createHash('sha256').update(pdf).digest('hex');
  if(field('pdfSha256')!==checksum)throw Error(`${m.code}: proof record checksum does not match ${expected.pdfPath}`);
  if(!/^pass\b/i.test(field('grayscaleOutcome'))||!/^pass\b/i.test(field('punchClearanceOutcome')))throw Error(`${m.code}: approved proof outcomes must begin with PASS`);
}
const groups=sections.map((s,i)=>`## ${i+1}. ${s}\n\n| Code | Title | Status | Version | Last reviewed | Pages |\n|---|---|---|---|---|---:|\n`+(docs.filter(d=>d.meta.section===s).map(d=>`| ${d.meta.code} | ${d.meta.title} | ${d.meta.status} | ${d.meta.version} | ${d.meta.lastReviewed} | ${d.meta.pageCount} |`).join('\n')||'| — | _No handouts yet_ | — | — | — | — |')).join('\n\n');await fs.writeFile(path.join(root,'BINDER_INDEX.md'),`# Binder index\n\nGenerated by \`npm run build\`. Only approved documents may be published to Moodle.\n\n${groups}\n`);const approved=docs.filter(d=>d.meta.status==='approved');await fs.writeFile(path.join(root,'docs/moodle-index.html'),'<!-- Generated; approved handouts only. Replace PDF_URL after Moodle upload. -->\n<div class="lhhfw-binder"><h1>Emergency Preparedness Binder</h1>'+sections.map(s=>`<section><h2>${esc(s)}</h2>${approved.some(d=>d.meta.section===s)?'<ul>'+approved.filter(d=>d.meta.section===s).map(d=>`<li><a href="PDF_URL/${d.meta.code}.pdf">${esc(d.meta.title)}</a> (${d.meta.code}, reviewed ${d.meta.lastReviewed})</li>`).join('')+'</ul>':'<p><em>No approved handouts currently published.</em></p>'}</section>`).join('')+'</div>\n');console.log(`Built and checked ${docs.length} handouts / ${docs.reduce((n,d)=>n+d.meta.pageCount,0)} PDF pages. Visual fixture tolerance: ${VISUAL_TOLERANCE.maxDifferentPixelRatio*100}%.`)
