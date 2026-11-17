// Runs the AI service's virtualenv Python inside ai/, on any OS:  node scripts/ai.mjs -m pytest -q
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const win = process.platform === 'win32';
const py = resolve('ai', '.venv', win ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(py)) {
  console.error('ai/.venv not found. Set it up with:\n  python -m venv ai/.venv\n  ai/.venv/Scripts/pip install -r ai/requirements.txt   (bin/pip on macOS/Linux)');
  process.exit(1);
}
const r = spawnSync(py, process.argv.slice(2), { cwd: 'ai', stdio: 'inherit' });
process.exit(r.status ?? 1);
