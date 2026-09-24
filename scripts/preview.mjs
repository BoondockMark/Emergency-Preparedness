import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const code=(process.argv[2]||'').toUpperCase();
if(!code){ console.error('Usage: npm run preview -- COM-03'); process.exit(2); }
const root=path.resolve(import.meta.dirname,'..');
const file=path.join(root,'build/html',`${code}.html`);
try{await fs.access(file)}catch{console.error(`Missing ${file}. Run npm run build first.`);process.exit(1)}
const port=4173; console.log(`Preview ${code}: http://127.0.0.1:${port}/html/${code}.html`); console.log('Press Ctrl+C to stop.');
spawn(process.execPath,['-e',`const http=require('http'),fs=require('fs'),path=require('path');const root=${JSON.stringify(path.join(root,'build'))};http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!f.startsWith(root)){r.writeHead(403);return r.end()}fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);return r.end('Not found')}r.end(d)})}).listen(${port},'127.0.0.1')`],{stdio:'inherit'});
