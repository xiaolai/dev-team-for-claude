// Runs a refute-mode audit through the Codex CLI, read-only, and prints Codex's final message.
// node codex-audit.mjs [--target diff|plan] [--base <ref>] [--plan <path>] [--timeout <sec>] [--cwd <dir>]
//
// Exit codes: 0 audit printed, 2 bad arguments or repository state, 3 codex not installed, 4 codex failed.
// No fallback to another engine: a caller that asked for Codex gets Codex or a loud failure.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { codexAuditPrompt, parseAuditArgs } from './lib.mjs';

function fail(code, message) {
  process.stderr.write(`codex-audit: ${message}\n`);
  process.exit(code);
}

let args;
try {
  args = parseAuditArgs(process.argv.slice(2));
} catch (err) {
  fail(2, err.message);
}
const cwd = resolve(args.cwd ?? process.cwd());

const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
if (git('rev-parse', '--is-inside-work-tree').stdout?.trim() !== 'true') fail(2, `${cwd} is not inside a git repository`);
if (args.target === 'diff' && git('rev-parse', '--verify', '--quiet', `${args.base}^{commit}`).status !== 0) {
  fail(2, `--base ${args.base} is not a commit in this repository`);
}
if (args.plan && !existsSync(resolve(cwd, args.plan))) fail(2, `plan file not found: ${args.plan}`);

const version = spawnSync('codex', ['--version'], { encoding: 'utf8' });
if (version.error?.code === 'ENOENT') fail(3, 'codex CLI not found on PATH. Install it, or audit with engine: claude.');
if (version.status !== 0) fail(4, `codex --version failed: ${(version.stderr || '').trim()}`);

/** Run Codex and return its final message, or an error. Never exits, so the caller's cleanup always runs. */
function runCodex(outFile) {
  const res = spawnSync('codex', ['exec', '-s', 'read-only', '-C', cwd, '--ephemeral', '-o', outFile, '-'], {
    input: codexAuditPrompt(args),
    encoding: 'utf8',
    timeout: args.timeoutSec * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error?.code === 'ETIMEDOUT') return { error: `codex did not finish within ${args.timeoutSec}s` };
  if (res.error) return { error: `codex could not run: ${res.error.message}` };
  if (res.status !== 0) return { error: `codex exited ${res.status}: ${(res.stderr || '').trim().split('\n').slice(-5).join('\n')}` };
  const message = existsSync(outFile) ? readFileSync(outFile, 'utf8').trim() : '';
  if (!message) return { error: 'codex exited 0 but wrote no final message, so there is no audit to report' };
  // The brief requires the verdict as the closing line; anything else is not a finished audit.
  if (!/^VERDICT: (?:pass|fail)$/.test(message.split('\n').at(-1).trim())) {
    return { error: `codex's reply does not end with a VERDICT line, so the audit did not complete. It said: ${message.slice(0, 300)}` };
  }
  return { message };
}

const outDir = mkdtempSync(join(tmpdir(), 'dev-team-audit-'));
let result;
try {
  result = runCodex(join(outDir, 'last-message.md'));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
if (result.error) fail(4, result.error);

const scope = args.target === 'plan' ? `plan ${args.plan}` : `diff against ${args.base}${args.plan ? `, plan ${args.plan}` : ''}`;
process.stdout.write(`engine: codex (${version.stdout.trim()}) · ${scope}\n\n${result.message}\n`);
