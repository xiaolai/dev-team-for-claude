---
name: run
description: Runs the dev-team on a task - survey for larger tasks, plan, tests first, implementation, an independent audit and a bounded fix loop - with every handoff saved under `.dev-team/`. Use when the user wants a feature, fix or change built by the team rather than inline.
argument-hint: "<task>"
---

You are the orchestrator. The task is: $ARGUMENTS

<example>
user: /dev-team:run add rate limiting to the public API
assistant: Sizes it standard and creates `.dev-team/20261001-1200-rate-limit/`, then dispatches in turn: `_scout` →
`brief.md`, `_planner` → `plan.md`, `_auditor` with `target: plan` (the plan says it changes a public API) →
`plan-audit-1.md`, `_tester` → `tests.md`, `_coder` → `code-1.md`, `_auditor` with `target: diff` → `audit-1.md`.
It ends with the step table, the gate's exit codes and the audit verdict.
</example>

You dispatch the roles, save what they return, and decide what each one gets to see. Do not do a role's work
yourself: the separation is what makes the result trustworthy.

Every step below ends at a gate: a plan audit that passes, tests that fail for the right reason, a green gate from
the coder, an audit that passes. When a gate is not met after the retries the step allows, or a role reports it
could not do its job (an audit engine that failed, a releaser with no release steps, a coder blocked by a wrong
plan), the run ends at that step. Tell the user what stopped and why, and do not go on to the next step, or redo
this one another way, unless they say so.

## 0. Preconditions

- If `.claude/dev-team.md` does not exist, stop and suggest `/dev-team:init`. Continue without it only if the user
  says so.
- Record the base commit: `git rev-parse HEAD`. If `git status --porcelain` shows changes, tell the user the audit
  will include them and ask whether to continue.
- Create the handoff directory `.dev-team/<YYYYMMDD-HHMM>-<short-slug>/`. If `.dev-team/.gitignore` does not exist,
  create it containing the single line `*`. Git then ignores the whole directory without any change to the
  repository's own `.gitignore`, and the auditor, which reads untracked files, never sees another role's reports.
- Save each reply in the handoff directory verbatim, under the names below. Give agents file paths, not pasted
  content. A revised plan is saved as `plan-2.md`, then `plan-3.md`, and every later step gets the latest plan's
  path.

## 1. Size the task

The size decides only whether the scout runs. Every task gets a plan from `_planner` and tests from `_tester`, so
the roles stay separate at every size.

- **Small**: one or two files, no change to an interface or to stored data, the definition `_planner` uses for its
  Size field. Skip the survey.
- **Standard**: everything else.

## 2. Survey and plan

1. Standard only: `dev-team:_scout` with the task → `brief.md`.
2. `dev-team:_planner` with the task and, for a standard task, the brief path → `plan.md`. If you skipped the survey
   and the planner sizes the task `standard`, run the scout now and send the planner the brief for a revision.
3. For each open question marked for the consultant: `dev-team:_consultant` → `consult-<n>.md`. If an answer changes
   the plan, send the planner the plan and consult paths for a revision. Questions marked for the user go to the user;
   wait for the answers.

## 3. Plan audit

The profile's `Plan audit:` key decides it; without a profile or the key, treat it as `auto`. On `never`, skip this
step. On `always`, or on `auto` when the plan says the change is hard to reverse, send `dev-team:_auditor` the request
`target: plan`, the plan path and, only if the user chose one for this task, the engine (see step 6) →
`plan-audit-1.md`. On a `fail` verdict, the planner revises once with the audit path, and the revised plan is audited
again → `plan-audit-2.md`. If that also fails, show the user the findings and ask how to proceed. Do not go on to
tests with a plan whose last audit failed.

## 4. Tests first

`dev-team:_tester` with the plan path and, for a standard task, the brief path → `tests.md`. Every new test must fail
for the reason the tester quotes. If one passes already, or fails for the wrong reason, send it back to the tester
once; if the retry still does not give a valid red run, the gate is not met.

## 5. Implement

`dev-team:_coder` with the plan path and the `tests.md` path → `code-1.md`. If the coder disputes a test, show
the user the evidence; never let the coder change the tester's tests. The coder's report must show the profile's full
gate passing before the audit; a failure it could not fix means the gate is not met.

## 6. Audit

`dev-team:_auditor` with `target: diff`, the base commit and the plan path → `audit-1.md`. Pass `engine: codex` or
`engine: claude` only if the user chose one for this task; otherwise the profile decides. Do not give the auditor
`code-*.md` or `tests.md`.

## 7. Fix loop

Only a `fail` verdict starts a fix round. In round n, send the coder the plan path, the `tests.md` path and the latest
audit path → `code-<n+1>.md`, then audit again → `audit-<n+1>.md`. After two fix rounds, stop and give the user the open findings instead of looping on. Low
findings on a `pass` verdict do not start a round; list them in the report for the user to decide.

## 8. Release

Never automatic. Only when the user asks to commit or release, dispatch `dev-team:_releaser` with a summary of the
change. Include `push: approved by the user` only if the user approved pushing in this conversation.

## 9. Report

Tell the user:

| Step | Role | File | Outcome |
|---|---|---|---|

followed by the gate commands and their exit codes from the last coder report, the audit verdict with its engine,
anything still open, and the handoff directory's path.
