import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const code=(process.argv[2]||'').toUpperCase();
if(!code){ console.error('Usage: npm run preview -- COM-001'); process.exit(2); }
const root=path.resolve(import.meta.dirname,'..');
if(process.argv.includes('--private')&&!process.env.BINDER_PRIVATE_DIR) throw Error('Private preview requires BINDER_PRIVATE_DIR');
const output=process.argv.includes('--private')?path.resolve(root,process.env.BINDER_PRIVATE_DIR,'build/binder'):path.join(root,'build');
const file=path.join(output,'html',`${code}.html`);
try{await fs.access(file)}catch{console.error(`Missing ${file}. Run npm run build first.`);process.exit(1)}
const port=4173; console.log(`Preview ${code}: http://127.0.0.1:${port}/html/${code}.html`); console.log('Press Ctrl+C to stop.');
spawn(process.execPath,['-e',`const http=require('http'),fs=require('fs'),path=require('path');const root=${JSON.stringify(output)};http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!f.startsWith(root)){r.writeHead(403);return r.end()}fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);return r.end('Not found')}r.end(d)})}).listen(${port},'127.0.0.1')`],{stdio:'inherit'});
