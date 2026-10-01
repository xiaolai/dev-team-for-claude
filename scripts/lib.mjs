// Pure logic for dev-team. No I/O here: every function takes plain data and returns plain data,
// so the hook and the Codex runner are thin wrappers and everything below is unit-tested.

export const RELEASER = 'dev-team:_releaser';

// Publishing is recognised by reading the command, not by running it, so this is a guard against accidents, not a
// security boundary: a script that pushes internally, or an alias, gets through.
//
// It errs toward denying. Finding a tool's subcommand exactly would take a full shell parser, and every gap in one
// lets a push through, so a publish verb anywhere after the tool in the same simple command counts: `git log --grep
// push` is read as a push. Quoted text stays one word, so `git commit -m "push it"` is not.

// tool → [kind, ...publish verbs]. A verb is an exact word or a pattern for options that carry a value.
// Docker parses booleans the Go way (1, t, TRUE, ...), so any value but a recognised false counts as a push.
const IMAGE_PUSH = [
  'image push',
  'push',
  /^--push(?:=(?!(?:0|f|false)$).*)?$/i,
  /(?:^|[,=])(?:type=registry|push=(?!(?:0|f|false)(?:,|$))[^,]*)(?:,|$)/i,
];
const PUBLISHERS = {
  git: ['git push', 'push'],
  npm: ['package publish', 'publish'],
  pnpm: ['package publish', 'publish'],
  bun: ['package publish', 'publish'],
  yarn: ['package publish', 'publish'],
  cargo: ['package publish', 'publish'],
  twine: ['package publish', 'upload'],
  gem: ['package publish', 'push'],
  poetry: ['package publish', 'publish'],
  uv: ['package publish', 'publish'],
  docker: IMAGE_PUSH,
  podman: IMAGE_PUSH,
  vsce: ['extension publish', 'publish'],
  ovsx: ['extension publish', 'publish'],
};
// Local subcommands that share a publish verb: `git stash push` stashes.
const LOCAL_BEFORE_VERB = { git: ['stash'] };
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const MAX_NESTING = 16;

// gh is checked the other way round: an action counts as a write unless it is known to read or to stay local.
const GH_LOCAL_GROUPS = new Set(['auth', 'config', 'alias', 'extension', 'completion', 'help', 'search', 'browse', 'status']);
// Actions that only read, or only write locally, in every group; and those that do so only in the group named.
const GH_READ_ACTIONS = new Set(['view', 'list', 'ls', 'status', 'diff', 'checks', 'watch', 'download', 'help']);
const GH_READ_IN_GROUP = { repo: ['clone', 'set-default'], pr: ['checkout'], gist: ['clone'] };
const GH_VALUE_FLAGS = new Set(['-R', '--repo', '--hostname']);
const WRITE_METHOD = /^(?:-X|--method=?)(?:POST|PUT|PATCH|DELETE)$/i;
const FIELD_FLAG = /^(?:-[fF]|--(?:field|raw-field|input)(?:=|$))/;

/**
 * Split a command line into simple commands, as lists of words, the way a POSIX shell reads it: quotes group words,
 * backslashes escape, `<` and `>` end words, `; & | ( )` and newlines separate commands, and each `$(...)` or
 * backtick substitution is a
 * command of its own. Substitutions open a new context on a stack rather than being matched by searching, so a
 * quoted `)` inside one cannot end it early, and the whole pass is linear with no recursion. The outer command keeps
 * its words across a substitution, which stands in it as `_`.
 */
function lex(src) {
  const commands = [];
  const stack = [];
  let ctx = { words: [], word: '', inWord: false, quote: null, parens: 0, closer: null };
  const endWord = () => {
    if (ctx.inWord) ctx.words.push(ctx.word);
    ctx.word = '';
    ctx.inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (ctx.words.length) commands.push(ctx.words);
    ctx.words = [];
  };
  const open = (closer) => {
    stack.push(ctx);
    ctx = { words: [], word: '', inWord: false, quote: null, parens: 0, closer };
  };
  const close = () => {
    endCommand();
    ctx = stack.pop();
    ctx.word += '_';
    ctx.inWord = true;
  };
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (ctx.quote === "'") {
      if (c === "'") ctx.quote = null;
      else ctx.word += c;
      continue;
    }
    if (c === '\\' && src[i + 1] === '\n') {
      i += 1; // line continuation: the shell drops both characters
      continue;
    }
    if (c === '\\' && i + 1 < src.length && (ctx.quote === null || '$`"\\'.includes(src[i + 1]))) {
      ctx.word += src[(i += 1)];
      ctx.inWord = true;
      continue;
    }
    if (c === '$' && src[i + 1] === '(') {
      open(')');
      i += 1;
      continue;
    }
    if (c === '`') {
      if (ctx.closer === '`' && ctx.quote === null) close();
      else open('`');
      continue;
    }
    if (ctx.quote === '"') {
      if (c === '"') ctx.quote = null;
      else ctx.word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      ctx.quote = c;
      ctx.inWord = true;
    } else if (c === '(') {
      endCommand();
      ctx.parens += 1;
    } else if (c === ')') {
      if (ctx.parens > 0) {
        endCommand();
        ctx.parens -= 1;
      } else if (ctx.closer === ')') {
        close();
      } else {
        endCommand();
      }
    } else if (';&|\n'.includes(c)) {
      endCommand();
    } else if (/\s/.test(c) || c === '<' || c === '>') {
      endWord(); // a redirection ends a word even without a space: `git push>log`
    } else {
      ctx.word += c;
      ctx.inWord = true;
    }
  }
  while (stack.length) close();
  endCommand();
  return commands;
}

/** Does `gh <args>` write to GitHub? `gh api` writes with a write method or a field flag, which implies POST. */
function ghWrites(args) {
  const positional = [];
  for (let i = 0; i < args.length && positional.length < 2; i += 1) {
    if (!args[i].startsWith('-')) positional.push(args[i]);
    else if (GH_VALUE_FLAGS.has(args[i])) i += 1;
  }
  const [group, action] = positional;
  if (group === 'api') {
    return args.some((w, i) => WRITE_METHOD.test(w) || FIELD_FLAG.test(w) || (/^(?:-X|--method)$/.test(w) && WRITE_METHOD.test(`-X${args[i + 1] ?? ''}`)));
  }
  if (!group || !action || GH_LOCAL_GROUPS.has(group)) return false;
  return !GH_READ_ACTIONS.has(action) && !(Object.hasOwn(GH_READ_IN_GROUP, group) && GH_READ_IN_GROUP[group].includes(action));
}

/** The publishing one simple command does, reading `sh -c` and `eval` arguments as commands in their own right. */
function kindOf(words, nesting) {
  const tools = [];
  let ghSeen = false;
  let shellSeen = false;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    for (const tool of tools) {
      const [kind, ...verbs] = PUBLISHERS[tool];
      const isVerb = verbs.some((v) => (typeof v === 'string' ? v === w : v.test(w)));
      // `git stash push` stashes, but in `git -C stash push` the word is a directory, so an option before it voids it.
      const local = LOCAL_BEFORE_VERB[tool]?.includes(words[i - 1]) && !words[i - 2]?.startsWith('-');
      if (isVerb && !local) return kind;
    }
    // The command's own name: no directory, no `@version` (`npx @vscode/vsce@latest`).
    const name = w.split('/').pop().replace(/@[^@]*$/, '');
    if (Object.hasOwn(PUBLISHERS, name) && !tools.includes(name)) tools.push(name);
    if (name === 'gh' && !ghSeen) {
      ghSeen = true;
      if (ghWrites(words.slice(i + 1))) return 'GitHub write';
    }
    if ((name === 'eval' || SHELLS.has(name)) && !shellSeen) {
      shellSeen = true;
      const args = words.slice(i + 1);
      // eval runs its arguments joined by spaces; a shell with a -c flag runs its first non-option argument.
      const flag = args.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
      const script = name === 'eval' ? args.join(' ') : flag === -1 ? undefined : args.slice(flag + 1).find((a) => !a.startsWith('-'));
      const kind = script === undefined ? null : readCommand(script, nesting + 1);
      if (kind) return kind;
    }
  }
  return null;
}

function readCommand(command, nesting) {
  if (nesting > MAX_NESTING) return 'unreadable nesting';
  for (const words of lex(command)) {
    const kind = kindOf(words, nesting);
    if (kind) return kind;
  }
  return null;
}

/** What kind of publishing a shell command does, or null for a command that stays on this machine. */
export function publishKind(command) {
  return typeof command === 'string' ? readCommand(command, 0) : null;
}

/**
 * Decide whether a Bash call may run. Only the main session (no agent_type) and dev-team:_releaser may publish;
 * every other subagent is denied, with a reason that tells it to hand the release back.
 *
 * @param {{agentType: string|null, command: unknown}} args
 * @returns {{allow: true} | {allow: false, reason: string}}
 */
export function pushGuardDecision({ agentType, command }) {
  if (!agentType || agentType === RELEASER) return { allow: true };
  const kind = publishKind(command);
  if (kind === null) return { allow: true };
  return {
    allow: false,
    reason:
      `dev-team: ${agentType} may not publish (${kind}). Only ${RELEASER} pushes or publishes, and only with the ` +
      "user's approval. Leave this step out, finish your task, and say in your report what still needs releasing.",
  };
}

/** Arguments for codex-audit.mjs. Throws on anything it does not recognise, so a typo fails loudly. */
export function parseAuditArgs(argv) {
  const args = { target: 'diff', base: 'HEAD', plan: null, timeoutSec: 540, cwd: null };
  const value = (flag, i) => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--target') args.target = value(flag, (i += 1));
    else if (flag === '--base') args.base = value(flag, (i += 1));
    else if (flag === '--plan') args.plan = value(flag, (i += 1));
    else if (flag === '--cwd') args.cwd = value(flag, (i += 1));
    else if (flag === '--timeout') args.timeoutSec = Number(value(flag, (i += 1)));
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (args.target !== 'diff' && args.target !== 'plan') throw new Error('--target must be diff or plan');
  if (args.target === 'plan' && !args.plan) throw new Error('--target plan needs --plan <path>');
  if (!Number.isFinite(args.timeoutSec) || args.timeoutSec <= 0) throw new Error('--timeout needs a positive number of seconds');
  return args;
}

const FINDING_FORMAT = `For every finding, give:
- severity: high | medium | low
- location: file:line (or the plan step)
- what breaks: a concrete input or state, and the wrong result it produces
- check: the test to run, the file to read, or the command whose output would prove it

Drop any objection you cannot attach a check to. Do not report style preferences. Do not modify any file.

End with exactly one line: \`VERDICT: pass\` if you found no high or medium finding, otherwise \`VERDICT: fail\`.`;

const PROFILE = `Repository rules: if \`.claude/dev-team.md\` exists, read it first. It names the commands and the conventions this repository holds itself to.
Skip \`.dev-team/\` apart from the plan file named here: it holds the other agents' reports, which this audit must not see.`;

/** The refute-mode instructions handed to Codex. */
export function codexAuditPrompt({ target, base, plan }) {
  if (target === 'plan') {
    return `You are auditing an implementation plan in refute mode, before any code is written. Find how it fails; do not summarise it.

Plan: \`${plan}\`. Read the code it touches before judging it.
${PROFILE}

Look for: success criteria that cannot be checked, steps that break an invariant of the existing code, missing cases (errors, empty input, concurrency, migration, rollback), and a simpler approach that meets the same criteria.

${FINDING_FORMAT}`;
  }
  const intent = plan
    ? `Intent: \`${plan}\` states what the change must do and how success is checked. Judge the change against it.`
    : 'No plan was given. Infer the intent from the change, and state in one line what you inferred before the findings.';
  return `You are auditing a code change in refute mode. Find what is wrong with it; do not summarise it.

Change under audit: everything \`git diff ${base}\` shows, plus every untracked file (list them with \`git status --porcelain\` and read each one).
${intent}
${PROFILE}

${FINDING_FORMAT}`;
}
