# dev-team

An agentic dev team for Claude Code, installed per project. Seven roles each run in their own context, with their own
tools, model and effort level. A reviewed profile tells them how your repository works.

## Why separate agents

A role earns its own agent only when separation buys something a single session cannot have:

- **A clean context.** The tester writes tests from the plan before any code exists, and the auditor sees the plan
  and the diff but never the coder's reasoning. An auditor who shares the author's context repeats the author's
  mistakes.
- **Different permissions.** Among subagents, only the releaser may push or publish. A hook enforces it; your own
  session is unaffected.
- **A different model or effort.** Surveys and releases are mechanical and run on Sonnet at low effort. Planning and
  auditing are judgment and run on Opus at xhigh.

## The roles

| Agent | Job | Tools | Model, effort |
|---|---|---|---|
| `_scout` | Maps the code a task touches, how it is checked, and its constraints | read-only, shell | Sonnet, low |
| `_planner` | Success criteria that can each be checked, then the steps | read-only | Opus, xhigh |
| `_tester` | Tests from the plan, before the implementation, shown failing | edit, shell | Opus, high |
| `_coder` | Makes the tests and the full gate pass without weakening a test | edit, shell | Opus, medium |
| `_auditor` | Refute-mode audit of a plan or a diff, on **Claude or Codex** | read-only, shell | Opus, xhigh |
| `_releaser` | Commits, version bumps, and publishing with the user's approval | edit, shell | Sonnet, low |
| `_consultant` | Open questions answered from primary sources, then a recommendation | read-only, web | Opus, xhigh |

## Install

From the project you want the team in:

```bash
claude plugin install dev-team@xiaolai --scope project
```

Then build the repository's profile:

```
/dev-team:init
```

`init` surveys the repository, runs once each check command that is safe to run, to verify it, and writes
`.claude/dev-team.md`. Review it, particularly the Release section, and commit it with the repository. Every agent reads it before it starts, so it is
where you customise the team for this repository: the commands, the conventions, the paths not to touch, how a
release works, and the auditor's default engine.

## Use

```
/dev-team:run add rate limiting to the public API
/dev-team:audit codex
/dev-team:audit claude base main
/dev-team:audit codex plan .dev-team/20261001-1400-rate-limit/plan.md
```

`run` gives every task a plan, tests written first, the implementation, an audit, and at most two fix rounds. A
standard task is surveyed before it is planned. A plan is audited before tests are written when the profile's
`Plan audit:` is `always`, or `auto` (the default) and the change is hard to reverse.
Each handoff is saved under `.dev-team/<task>/`. That directory carries its own `.gitignore`, so git never sees it
and your `.gitignore` is not touched. Releasing happens only when you
ask for it.

You can also dispatch any role directly, for example "ask dev-team:_consultant whether ...".

### Auditor engine

The engine is chosen in this order: `engine: codex` or `engine: claude` in the request, then `Engine:` in the
profile, then `claude`. The Codex engine needs the [Codex CLI](https://github.com/openai/codex) on `PATH` and logged
in. It runs `codex exec` in a read-only sandbox, and the auditor then runs each finding's check where it can. If
Codex is missing or fails, the audit reports that and stops. It never quietly falls back to Claude.

### The push guard

A `PreToolUse` hook denies `git push`, package, image and extension publishing, and GitHub writes from any subagent except
`dev-team:_releaser`. Your own session is not affected. It reads the command text, quoting, chaining, substitutions
and `sh -c` included, and it errs toward denying. A publish verb anywhere after the tool counts, and any `gh` action
that isn't known to be read-only counts as a write. So a rare harmless command such as `git log --grep push` is
denied too. It guards against accidents, not against a determined agent: a script that pushes internally gets
through.

## Requirements

- Claude Code with plugin, subagent `effort:` and `agent_type` hook-input support (tested on 2.1.286).
- Node.js 20.11 or later for the hook, the Codex runner and the tests.
- The Codex CLI, only for `engine: codex` (tested with codex-cli 0.159.2).

## License

ISC
