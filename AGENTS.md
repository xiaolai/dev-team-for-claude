# dev-team — Developer Notes

## What it does

Seven role agents, each in its own context with its own tools, model and effort, plus three skills that set them up
and coordinate them. A per-repository profile, `.claude/dev-team.md`, carries everything repository-specific; the
agents stay generic.

```
/dev-team:init  → _scout survey → draft .claude/dev-team.md from templates/dev-team.md → run each safe command → user review
/dev-team:run   → (_scout) → _planner → (_consultant) → (plan audit) → _tester → _coder → _auditor: diff → fix ×2
/dev-team:audit → _auditor, engine claude | codex
_auditor engine: codex → scripts/codex-audit.mjs → codex exec -s read-only
PreToolUse(Bash) → scripts/push-guard.mjs   (deny publishing from any subagent except dev-team:_releaser)
```

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Claude Code | 2.1.286 or later (the platform facts below were checked on it) | everything |
| Node.js | 20.11 or later (`node --test` with a glob, `import.meta.dirname` in the tests) | the hook, the Codex runner, the tests |
| Codex CLI | 0.159.2 or later, logged in | `engine: codex` only |

The orchestrator is the main session while it follows `/dev-team:run`. Agents that can also be dispatched
directly (by `/dev-team:audit` or by hand) call whoever dispatched them the requester.

## Project structure

```
.claude-plugin/plugin.json       — identity and metadata
.claude-plugin/marketplace.json  — per-plugin marketplace listing (workspace convention)
agents/_*.md                     — the seven roles
skills/init|run|audit/SKILL.md   — profile setup, orchestration, standalone audit
templates/dev-team.md            — the profile template init fills in
hooks/hooks.json                 — PreToolUse(Bash) push guard
scripts/lib.mjs                  — all logic, pure functions
scripts/push-guard.mjs           — hook entry point; fails closed
scripts/codex-audit.mjs          — Codex runner; exit 0 ok, 2 bad input, 3 no codex, 4 codex failed
scripts/*.test.mjs               — unit tests, and end-to-end tests with real processes and a stub codex
```

## Platform facts this depends on

Checked on Claude Code 2.1.286 with a probe plugin; re-check after an upgrade.

| Fact | What relies on it |
|---|---|
| `PreToolUse` input from a subagent carries `agent_type` (`<plugin>:<agent>`); from the main session it has none | The push guard tells the releaser and the main session apart from every other subagent |
| `${CLAUDE_PLUGIN_ROOT}` is substituted in a plugin agent's body | `_auditor` finds `codex-audit.mjs` |
| Agent names may start with `_`; plugin agents are namespaced `dev-team:_coder` | The role names |
| `hooks`, `mcpServers` and `permissionMode` are ignored in plugin agents' frontmatter | Permissions are enforced by the plugin-level hook and each agent's `tools` list, not per agent |
| `model:` and `effort:` in an agent's frontmatter are fixed per plugin version | Per-repository customisation goes through the profile, not the frontmatter |

## Checks

```bash
node --test scripts/*.test.mjs                        # unit + end-to-end; the glob matters, a bare directory fails
claude plugin validate --strict .claude-plugin/plugin.json
cd "$(mktemp -d)" && claude -p 'Reply ok' --plugin-dir <abs-plugin-dir> --debug-file /tmp/load.log --max-turns 1 && grep -E '\[(WARN|ERROR)\]' /tmp/load.log
```

## Rules

- The push guard fails closed: a crash, including a failed import of `lib.mjs`, denies the call with the error.
  Keep the import inside the `try`; a guard that fails open looks exactly like a guard that works. It cannot fail
  closed if `node` itself is missing: the hook command then exits non-zero, which Claude Code treats as a
  non-blocking error.
- The guard errs toward denying, by design. A quote-aware lexer splits the command into simple commands (each
  `$(...)` and backtick substitution is one, tracked on a stack, so the pass is linear and never recurses); within
  each, a publishing tool followed **anywhere later** by one of its publish verbs counts. Earlier versions tried to
  locate the subcommand exactly; four Codex audit rounds each found new shell forms that slipped past (wrapper
  options, `sh -lc`, quoted values, keywords, redirections, `docker compose push`). Do not go back to exact parsing.
  The price is rare false positives that fail safe, such as `git log --grep push`; `git stash push` is the one
  explicit exception. `sh -c` and `eval` arguments are read as commands, to a depth of 16, past which the guard
  denies. `gh` is deny-by-default: any action not on the read-only list counts as a write.
- `codex-audit.mjs` never falls back to another engine, and `_auditor` never substitutes a Claude audit for a failed
  Codex one. A requested Codex audit is Codex or a loud failure.
- The auditor gets the plan and the change, never the coder's or the tester's reports. Keep that out of `run` and
  out of the auditor's inputs. `.dev-team/` ignores itself (`.dev-team/.gitignore` is `*`) so that reading untracked
  files cannot reach those reports, and both engines are told to skip it apart from the plan.
- The coder never edits the tester's tests; a disputed test goes to the user. Every task size gets `_planner` and
  `_tester`, so this holds for small tasks too; size only decides whether `_scout` runs.
- With no profile, `_planner`, `_tester` and `_coder` put `Profile: missing` above their sections; `_scout` and
  `_auditor` report it inside their own sections; `_releaser` stops; `_consultant` carries on without one. The
  auditor's report is either its three sections or the single line `Audit failed: <error>`; `/dev-team:audit`
  relies on that shape.
- Keep the roles table in README.md in step with each agent's `model`, `effort` and `tools`.
- The version, description and repository live in both `.claude-plugin/plugin.json` and
  `.claude-plugin/marketplace.json`; change them together.
- Profile labels the agents and skills read by name are an interface: `## Commands` with `The full gate a change
  must pass`, `## Conventions`, `## Protected paths`, `## Release` with `The version string appears in:`,
  `Commit messages:` and `Publishing commands`, and `## Auditor` with `Engine:` and `Plan audit:`. Renaming one in the template means changing every agent and
  skill that reads it.
