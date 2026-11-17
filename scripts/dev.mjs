// Starts the Python AI service and the Vite dev server together. Ctrl+C stops both.
// If the AI service cannot start, the game still runs in scripted mode.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const win = process.platform === 'win32';
const venvPy = join('ai', '.venv', win ? 'Scripts/python.exe' : 'bin/python');
const python = existsSync(venvPy) ? venvPy : win ? 'python' : 'python3';

const procs = [];
function run(name, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, ...opts });
  const tag = (line) => line && process.stdout.write(`[${name}] ${line}\n`);
  for (const s of [p.stdout, p.stderr]) s.on('data', (d) => String(d).split(/\r?\n/).forEach(tag));
  p.on('exit', (code) => tag(`exited with code ${code}`));
  procs.push(p);
  return p;
}

if (!existsSync(venvPy)) {
  console.log('[dev] ai/.venv not found. Set it up with:  python -m venv ai/.venv && ai/.venv/Scripts/pip install -r ai/requirements.txt');
}
run('ai', python, ['-m', 'uvicorn', 'app.main:app', '--port', '8000', '--app-dir', 'ai']);
run('web', process.execPath, [join('node_modules', 'vite', 'bin', 'vite.js')]);

const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
