// End-to-end tests for the hook and the Codex runner: real processes, real stdin, a stub `codex` on PATH.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const here = import.meta.dirname;

function guard(input) {
  const res = spawnSync('node', [join(here, 'push-guard.mjs')], { input, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trim() ? JSON.parse(res.stdout) : null;
}

const bash = (command, agentType) =>
  JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...(agentType && { agent_type: agentType }) });

test('push guard denies a push from a dev-team subagent other than the releaser', () => {
  const out = guard(bash('git push origin main', 'dev-team:_coder'));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /dev-team:_releaser/);
});

test('push guard stays silent for the releaser, the main session and ordinary commands', () => {
  assert.equal(guard(bash('git push', 'dev-team:_releaser')), null);
  assert.equal(guard(bash('git push')), null);
  assert.equal(guard(bash('npm test', 'dev-team:_coder')), null);
});

test('push guard fails closed on input it cannot parse', () => {
  const out = guard('not json');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /push guard failed/);
});

test('push guard fails closed when its logic module cannot load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dt-guard-'));
  copyFileSync(join(here, 'push-guard.mjs'), join(dir, 'push-guard.mjs'));
  const res = spawnSync('node', [join(dir, 'push-guard.mjs')], { input: bash('git push', 'dev-team:_coder'), encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /push guard failed/);
});

/** A PATH holding node, git and (unless omitted) a stub codex whose behaviour STUB_MODE selects. */
function stubPath({ withCodex = true } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'dt-bin-'));
  symlinkSync(process.execPath, join(bin, 'node'));
  if (withCodex) {
    const stub = join(bin, 'codex');
    writeFileSync(
      stub,
      `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('codex-cli 9.9.9'); process.exit(0); }
fs.writeFileSync(process.env.STUB_LOG, JSON.stringify({ argv, prompt: fs.readFileSync(0, 'utf8') }));
const out = argv[argv.indexOf('-o') + 1];
const mode = process.env.STUB_MODE;
if (mode === 'fail') { console.error('model overloaded'); process.exit(1); }
if (mode === 'sleep') { setTimeout(() => {}, 60000); return; }
const text = {
  empty: '',
  noverdict: 'I could not inspect the repository; no audit was performed.\\n',
  trailing: 'VERDICT: pass\\nI could not inspect the files; the audit is incomplete.\\n',
}[mode];
fs.writeFileSync(out, text ?? 'severity: high\\nVERDICT: fail\\n');
`,
    );
    chmodSync(stub, 0o755);
  }
  return `${bin}:/usr/bin:/bin`;
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'dt-repo-'));
  const git = (...a) => assert.equal(spawnSync('git', a, { cwd: dir }).status, 0, `git ${a.join(' ')}`);
  git('init', '-q');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  writeFileSync(join(dir, 'plan.md'), '# plan\n');
  return dir;
}

function audit(args, { path = stubPath(), mode = 'ok', cwd = repo() } = {}) {
  const log = join(mkdtempSync(join(tmpdir(), 'dt-log-')), 'stub.json');
  const res = spawnSync(process.execPath, [join(here, 'codex-audit.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: path, HOME: process.env.HOME, STUB_MODE: mode, STUB_LOG: log },
  });
  let stub = null;
  try {
    stub = JSON.parse(readFileSync(log, 'utf8'));
  } catch {}
  return { ...res, stub };
}

test('codex audit runs codex read-only with the refute prompt on stdin and prints its final message', () => {
  const res = audit(['--plan', 'plan.md']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^engine: codex \(codex-cli 9\.9\.9\) · diff against HEAD, plan plan\.md/);
  assert.match(res.stdout, /VERDICT: fail/);
  assert.deepEqual(res.stub.argv.slice(0, 3), ['exec', '-s', 'read-only']);
  assert.equal(res.stub.argv.at(-1), '-');
  assert.match(res.stub.prompt, /git diff HEAD/);
});

test('codex audit fails loudly when codex is missing, fails, times out or says nothing', () => {
  const missing = audit([], { path: stubPath({ withCodex: false }) });
  assert.equal(missing.status, 3);
  assert.match(missing.stderr, /not found on PATH/);

  const failed = audit([], { mode: 'fail' });
  assert.equal(failed.status, 4);
  assert.match(failed.stderr, /exited 1: model overloaded/);

  const empty = audit([], { mode: 'empty' });
  assert.equal(empty.status, 4);
  assert.match(empty.stderr, /no final message/);

  for (const mode of ['noverdict', 'trailing']) {
    const unfinished = audit([], { mode });
    assert.equal(unfinished.status, 4, mode);
    assert.match(unfinished.stderr, /does not end with a VERDICT line/, mode);
  }

  const slow = audit(['--timeout', '1'], { mode: 'sleep' });
  assert.equal(slow.status, 4);
  assert.match(slow.stderr, /within 1s/);
});

test('codex audit rejects a bad base, a missing plan and a directory outside git, before calling codex', () => {
  for (const [args, cwd, pattern] of [
    [['--base', 'no-such-ref'], undefined, /not a commit/],
    [['--plan', 'missing.md'], undefined, /plan file not found/],
    [[], mkdtempSync(join(tmpdir(), 'dt-nogit-')), /not inside a git repository/],
  ]) {
    const res = audit(args, cwd ? { cwd } : {});
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, pattern);
    assert.equal(res.stub, null, 'codex must not run');
  }
});
