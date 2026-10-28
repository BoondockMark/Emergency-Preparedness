import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolvePrivateDirectory } from './lib/local-setup.mjs';
const code=(process.argv[2]||'').toUpperCase();
if(!code){ console.error('Usage: npm run preview -- COM-001'); process.exit(2); }
const root=path.resolve(import.meta.dirname,'..');
const privateDirectory=process.argv.includes('--private')?await resolvePrivateDirectory(root):undefined;
if(process.argv.includes('--private')&&!privateDirectory) throw Error('Private preview needs a linked checkout; run npm run setup:private or set BINDER_PRIVATE_DIR');
const output=process.argv.includes('--private')?path.resolve(root,privateDirectory,'build/binder'):path.join(root,'build');
const file=path.join(output,'html',`${code}.html`);
try{await fs.access(file)}catch{console.error(`Missing ${file}. Run npm run build first.`);process.exit(1)}
const port=4173; console.log(`Preview ${code}: http://127.0.0.1:${port}/html/${code}.html`); console.log('Press Ctrl+C to stop.');
spawn(process.execPath,['-e',`const http=require('http'),fs=require('fs'),path=require('path');const root=${JSON.stringify(output)};http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!f.startsWith(root)){r.writeHead(403);return r.end()}fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);return r.end('Not found')}r.end(d)})}).listen(${port},'127.0.0.1')`],{stdio:'inherit'});
