# dev-team profile

<!--
Every dev-team agent reads this file before it starts. It is the only place the team learns how this repository
works, so keep it factual: each value says where it came from. Written by /dev-team:init, reviewed by a person,
committed with the repository. Re-run /dev-team:init to refresh it; it proposes edits and never overwrites.
-->

## Commands

| Check | Command | Source | Verified |
|---|---|---|---|
| Test | `{{test}}` | {{source}} | {{exit code and date, or "not run: <reason>"}} |
| Lint | | | |
| Type check | | | |
| Build | | | |

The full gate a change must pass before it counts as done: {{commands, in order}}.

## Conventions

<!-- Rules an auditor would hold a change to, with the file that states each one (AGENTS.md, CONTRIBUTING.md, ...). -->

- {{convention}} ({{source}})

## Protected paths

<!-- Paths agents must not edit by hand: generated code, vendored code, lockfiles that only a tool writes. -->

- `{{path}}`: {{why}}

## Release

Steps, in order:

1. {{step}}

The version string appears in: {{every file that carries it}}.

Commit messages: {{convention, or "no stated convention"}}.

Publishing commands, run by `dev-team:_releaser`, the only subagent allowed to publish, and only with the user's
approval: {{commands}}.

## Auditor

Engine: claude
<!-- claude | codex. A dispatch overrides it with `engine: codex` or `engine: claude`. codex needs the Codex CLI. -->

Plan audit: auto
<!-- auto | always | never. auto sends a plan to the auditor before tests are written when the change is hard to
reverse: a data model, a public API, a security boundary, a migration. -->
