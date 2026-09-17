import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (path.endsWith('.mjs')) { if (spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' }).status !== 0) process.exitCode = 1; }
  }
}
for (const dir of ['src', 'tests', 'examples', 'scripts']) await scan(dir);
