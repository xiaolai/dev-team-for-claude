---
name: init
description: Surveys this repository and drafts its dev-team profile, `.claude/dev-team.md`, which every dev-team agent reads first - the check commands (verified by running them), conventions, protected paths, release steps and the auditor's default engine. Use when setting up dev-team in a repository, or when the profile no longer matches it.
argument-hint: ""
---

<example>
user: /dev-team:init
assistant: Dispatches `dev-team:_scout` for a profile survey of this Node repository, fills in the template, runs
`npm test` once and records `exit 0, 2026-10-01` in the Verified column, writes `.claude/dev-team.md`, and asks the
user to review the Release section.
</example>

Build or refresh `.claude/dev-team.md` for this repository. The profile is how the team learns this repository, so
every value in it must come from evidence, and a person reviews it before the team relies on it.

## 1. Existing profile

If `.claude/dev-team.md` already exists, this is a refresh. Do not overwrite it. Run steps 2 to 4, then show the
user each proposed change as a before/after pair, and apply only the ones they accept.

## 2. Survey

Dispatch `dev-team:_scout` with this request, adapted to anything the user asked for:

> Profile survey: survey this repository to fill in its dev-team profile, not for a task. Report, each with its
> source file and line: the test, lint, type-check and build commands (package scripts, Makefile, CI workflows, pyproject, Cargo.toml and
> the like) and which of them CI treats as the required gate; the conventions stated in AGENTS.md, CLAUDE.md,
> CONTRIBUTING.md and similar; paths that must not be edited by hand (generated, vendored, tool-written lockfiles);
> the release process (release scripts, CI release jobs, tags); every file that carries the current version string
> (grep for it); and how commit messages are written, judged from `git log --oneline -30`.

## 3. Draft

Fill in the template at `${CLAUDE_PLUGIN_ROOT}/templates/dev-team.md`. Replace every `{{...}}`. Where the survey found
nothing, write `unknown` and what was looked for, rather than a guess or an empty cell. Delete table rows that do not
apply, such as a type check in a project without types.

## 4. Verify the commands

Run each command in the Commands table once, with a 10-minute timeout, and record the exit code and today's date in
the Verified column. Skip a command, and write `not run:` with the reason, if it needs network services,
credentials or a running server, or if it writes anywhere other than build output. Keep a failing command in the
table with its exit code; do not drop it.

## 5. Auditor engine

Leave `Engine: claude` unless the user asked for Codex. If `command -v codex` finds the Codex CLI, tell the user that
`codex` is available as the engine.

## 6. Write

Write `.claude/dev-team.md`. Leave `.gitignore` alone: `/dev-team:run` keeps its handoff files in `.dev-team/`, which
ignores itself.

## 7. Hand over

Show the user the profile and ask them to review it, in particular the Release section and the protected paths,
which the survey can get wrong. Do not commit anything.
