import path from 'node:path';
import { createEditorServer } from './lib/editor-server.mjs';

const root = path.resolve(import.meta.dirname, '..');
const server = await createEditorServer({ root, publicOnly: process.argv.includes('--public'), requirePrivate: process.argv.includes('--private') });
server.listen(4174, '127.0.0.1', () => console.log('Handout editor: http://127.0.0.1:4174'));
