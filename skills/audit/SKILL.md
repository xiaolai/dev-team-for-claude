---
name: audit
description: Audits the current change, or a plan, with dev-team's auditor in refute mode, choosing Claude or Codex as the engine. Use when the user wants an independent review of uncommitted work, of a branch against a base commit, or of a plan, outside a full /dev-team:run.
argument-hint: "[claude|codex] [base <ref>] [plan <path>]"
---

Run `dev-team:_auditor` on the request: $ARGUMENTS

<example>
user: /dev-team:audit codex base main
assistant: Dispatches `dev-team:_auditor` with `target: diff`, `base: main` and `engine: codex`, and shows its report
unchanged: the Engine section, the findings table with each check's result, and the verdict.
</example>

Read the request as:

- `claude` or `codex`: the engine. Without one, the auditor uses the profile's default.
- `plan <path>` alone: audit that plan (`target: plan`). With `base <ref>` as well, it is a diff audit
  (`target: diff`) against that plan.
- `base <ref>`: audit the change since that commit (`target: diff`). Without it, the base is `HEAD`, which covers
  uncommitted work.
- Without a plan, the auditor infers the change's intent from the change itself and says what it inferred; nothing
  else the user wrote is passed on.

Dispatch `dev-team:_auditor` with the target, base, plan and engine you read, leaving out whatever the user did not
give. Show its report to the user unchanged.

If the report is a single `Audit failed:` line, say plainly that no audit took place and why. Do not rerun it on
the other engine unless the user asks.
