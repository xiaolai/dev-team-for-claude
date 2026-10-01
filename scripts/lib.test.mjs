import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RELEASER, codexAuditPrompt, parseAuditArgs, publishKind, pushGuardDecision } from './lib.mjs';

test('publishKind recognises pushes and publishes, including git options before the subcommand', () => {
  for (const cmd of [
    'git push',
    'git push origin main --tags',
    'cd repo && git push',
    'git -C ../other push',
    'git -c user.name=x --no-pager push origin',
    'git subtree push --prefix dist origin gh-pages',
    'git lfs push origin main',
    'npm publish --access public',
    'pnpm publish',
    'bun publish',
    'yarn npm publish',
    'yarn publish',
    'cargo publish',
    'twine upload dist/*',
    'gem push pkg/x.gem',
    'poetry publish --build',
    'uv publish',
    'docker push org/img:1',
    'vsce publish',
    'gh pr create --fill',
    'gh pr merge 12 --squash',
    'gh release create v1.0.0',
    'gh repo create org/new --public',
    'gh api repos/o/r/issues -X POST',
    'gh api repos/o/r/labels -f name=bug',
    // global options, with and without separate values, before the subcommand
    'npm --registry=https://registry.npmjs.org publish',
    'npm --registry https://registry.npmjs.org publish',
    'pnpm -r --filter pkg publish',
    'docker --context production push org/image:1',
    'gh api repos/o/r/issues --method=POST',
    'gh api repos/o/r/issues -XPOST',
    'gh api repos/o/r/issues --field=title=x',
    // paths, prefixes, quoting and chaining
    '/usr/bin/git push',
    'sudo -E npm publish',
    'GIT_TRACE=1 git push',
    'env FOO=1 git push',
    'bash -c "git push origin main"',
    'npm test || git push',
    'echo $(git push)',
    // second audit round: wrapper option values, shell flag clusters, quoted values, quoted substitutions
    'sudo -u root git push origin main',
    'env -u CI git push',
    'bash -lc "git push origin main"',
    "sh -ec 'npm publish'",
    'git -c "user.name=First Last" push',
    'echo "$(git push)"',
    'echo `git push`',
    // gh: any action that is not known to be read-only or local
    'gh pr comment 12 --body hello',
    'gh pr close 12',
    'gh issue create --title x',
    'gh issue comment 3 -b hi',
    'gh workflow run deploy.yml',
    'gh secret set TOKEN',
    'gh gist create notes.md',
    'gh label create bug',
    // third audit round: shell keywords and groups, line continuation, attached gh field values
    'if npm test; then git push origin main; fi',
    'npm test && { git push origin main; }',
    'for r in a b; do git push $r; done',
    '! git push',
    'git \\\n push origin main',
    'gh api repos/o/r/issues -ftitle=hello',
    'gh api repos/o/r/issues -Ftitle=hello',
    // fourth audit round: plugin subcommands, quoted parentheses in substitutions, leading redirections
    'docker compose push',
    'docker buildx build --push -t org/image:latest .',
    `echo "$(printf ')'; git push)"`,
    '>push.log git push origin main',
    'eval "git push"',
    // fifth audit round: end of options before a shell script, and eval joining its arguments
    'bash -c -- "git push origin main"',
    'bash -e -c "npm publish"',
    'eval "git " "push origin main"',
    // sixth audit round: registry exporters and push flags with values, versioned package specs
    'docker buildx build --output=type=registry -t org/image:latest .',
    'docker buildx build -o type=image,name=org/img,push=true .',
    'docker buildx build --push=true -t org/img .',
    'npx --yes @vscode/vsce@latest publish',
    'npx vsce publish',
    // seventh audit round: redirections without spaces
    'git push>push.log',
    'npm publish>>release.log',
    'git>push.log push',
    'git push 2>&1',
    // eighth audit round: an option value that happens to be a local subcommand's name
    'git -C stash push origin main',
    // ninth audit round: an action that reads in one gh group writes in another
    'gh label clone source/repo --repo dest/repo --force',
    // tenth audit round: Go booleans; anything but a recognised false counts as push
    'docker buildx build --push=1 -t org/image:latest .',
    'docker buildx build --push=True .',
    'docker buildx build --push=TRUE .',
    'docker buildx build -o type=image,push=1 .',
    'docker buildx build -o TYPE=REGISTRY .',
  ]) {
    assert.notEqual(publishKind(cmd), null, cmd);
  }
});

test('publishKind leaves local and read-only commands alone', () => {
  for (const cmd of [
    'git status',
    'git log --oneline -5',
    'git commit -F /tmp/msg.txt',
    'git diff HEAD',
    'git stash push -m wip',
    'npm test',
    'npm run publish-docs-preview',
    'gh pr view 12',
    'gh pr list',
    'gh api repos/o/r/pulls',
    'echo "remember to git-push later"',
    'grep -rn pushState src/',
    'git commit -m "push the fix; then publish"',
    'docker --context prod ps',
    'npm --registry https://r.example view pkg',
    'gh api repos/o/r/issues -X GET',
    'gh --version',
    'git',
    '',
    "echo 'git push'",
    'echo "run git push when ready"',
    'bash scripts/test.sh',
    "sh -c 'npm test'",
    'sudo -u root git status',
    'gh pr checkout 12',
    'gh pr diff 12',
    'gh pr checks 12',
    'gh repo clone o/r',
    'gh gist clone abc123',
    'gh repo set-default o/r',
    'gh issue list --label bug',
    'gh run view 99 --log',
    'gh auth status',
    'gh search code push',
    'gh pr',
    'if git diff --quiet; then echo clean; fi',
    'gh api repos/o/r/issues --jq .[].title',
    'gh --repo org/repo pr view 12',
    'docker buildx build --output=type=docker -t org/img .',
    'docker build --push=false -t org/img .',
    'docker build --push=0 -t org/img .',
    'docker buildx build -o type=image,push=false .',
    'gh pr view 12 -R org/repo',
  ]) {
    assert.equal(publishKind(cmd), null, cmd);
  }
});

test('publishKind errs toward denying: a publish verb anywhere after the tool counts', () => {
  // Reading the subcommand exactly would need a full shell parser, and every gap in one lets a push through.
  // Matching the verb anywhere later in the same simple command closes that class, at the price of rare false
  // positives like this one, which fail safe.
  assert.equal(publishKind('git log --oneline --grep push'), 'git push');
});

test('publishKind refuses to read shells nested deeper than it checks, instead of guessing', () => {
  // Each level quotes the one inside it; JSON string escaping matches shell double-quote escaping for these.
  const nest = (depth, inner) => Array.from({ length: depth }).reduce((cmd) => `eval ${JSON.stringify(cmd)}`, inner);
  // 18 levels, two past the limit; quoting doubles the backslashes at each level, so far deeper inputs get huge.
  assert.equal(publishKind(nest(18, 'true')), 'unreadable nesting');
  assert.equal(publishKind(nest(3, 'git push')), 'git push');
  assert.equal(publishKind('eval "eval \\"true\\""'), null);
});

test('publishKind stays linear on long option lists', () => {
  const start = performance.now();
  assert.equal(publishKind(`npm ${'--flag value '.repeat(5000)}view`), null);
  assert.equal(publishKind(`echo ${'"a" '.repeat(5000)}$(${'('.repeat(2000)}`), null);
  assert.equal(publishKind(`echo ${'$('.repeat(8000)}true${')'.repeat(8000)}`), null);
  assert.ok(performance.now() - start < 500);
});

test('pushGuardDecision lets the main session and the releaser publish', () => {
  assert.deepEqual(pushGuardDecision({ agentType: null, command: 'git push' }), { allow: true });
  assert.deepEqual(pushGuardDecision({ agentType: RELEASER, command: 'git push' }), { allow: true });
});

test('pushGuardDecision denies publishing from any other subagent, and allows its ordinary commands', () => {
  const coder = pushGuardDecision({ agentType: 'dev-team:_coder', command: 'npm test && git push' });
  assert.equal(coder.allow, false);
  assert.match(coder.reason, /dev-team:_releaser/);
  assert.equal(pushGuardDecision({ agentType: 'general-purpose', command: 'gh pr create' }).allow, false);
  assert.deepEqual(pushGuardDecision({ agentType: 'dev-team:_coder', command: 'npm test' }), { allow: true });
});

test('pushGuardDecision ignores a call with no command', () => {
  assert.deepEqual(pushGuardDecision({ agentType: 'dev-team:_coder', command: undefined }), { allow: true });
});

test('parseAuditArgs reads a diff audit with defaults', () => {
  assert.deepEqual(parseAuditArgs([]), { target: 'diff', base: 'HEAD', plan: null, timeoutSec: 540, cwd: null });
  assert.deepEqual(parseAuditArgs(['--base', 'main', '--plan', 'p.md', '--timeout', '60', '--cwd', '/r']), {
    target: 'diff',
    base: 'main',
    plan: 'p.md',
    timeoutSec: 60,
    cwd: '/r',
  });
});

test('parseAuditArgs requires a plan for a plan audit and rejects junk', () => {
  assert.deepEqual(parseAuditArgs(['--target', 'plan', '--plan', 'p.md']).target, 'plan');
  assert.throws(() => parseAuditArgs(['--target', 'plan']), /--plan/);
  assert.throws(() => parseAuditArgs(['--target', 'code']), /--target/);
  assert.throws(() => parseAuditArgs(['--timeout', '0']), /--timeout/);
  assert.throws(() => parseAuditArgs(['--base']), /--base/);
  assert.throws(() => parseAuditArgs(['--wat']), /unknown argument/);
});

test('codexAuditPrompt for a diff names the base, the untracked files, the plan and the verdict line', () => {
  const p = codexAuditPrompt({ target: 'diff', base: 'abc123', plan: '.dev-team/t/plan.md' });
  assert.match(p, /git diff abc123/);
  assert.match(p, /git status --porcelain/);
  assert.match(p, /\.dev-team\/t\/plan\.md/);
  assert.match(p, /\.claude\/dev-team\.md/);
  assert.match(p, /check:/);
  assert.match(p, /Do not modify any file/);
  assert.match(p, /VERDICT: pass/);
  assert.match(p, /Skip `\.dev-team\/`/);
});

test('codexAuditPrompt for a diff without a plan asks Codex to state the intent it inferred', () => {
  assert.match(codexAuditPrompt({ target: 'diff', base: 'HEAD', plan: null }), /No plan was given/);
});

test('codexAuditPrompt for a plan reviews the plan, not a diff', () => {
  const p = codexAuditPrompt({ target: 'plan', base: 'HEAD', plan: 'plan.md' });
  assert.match(p, /before any code is written/);
  assert.doesNotMatch(p, /git diff/);
  assert.match(p, /VERDICT: pass/);
});
