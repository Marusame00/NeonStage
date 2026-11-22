import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

for (const script of ['build:main', 'build:editor', 'build:overlay']) {
  const result = spawnSync(npmCmd, ['run', script], { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const electronPath = require('electron');
const child = spawn(electronPath, [root, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
