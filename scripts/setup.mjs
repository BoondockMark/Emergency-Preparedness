import path from 'node:path';
import { linkPrivateCheckout } from './lib/local-setup.mjs';

const root = path.resolve(import.meta.dirname, '..');
console.log(await linkPrivateCheckout(root));
