import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const dist = resolve(packageRoot, 'dist');
if (dirname(dist) !== packageRoot) throw new Error('Refusing to clean outside the package');
rmSync(dist, { recursive: true, force: true });
