// PreToolUse(Bash): only the main session and dev-team:_releaser may push or publish.
// Fails closed: if the hook itself breaks, the call is denied with the error, so a broken guard is loud.

// The logic module is imported inside the try: a static import that fails would crash before the catch and fail open.

import { readFileSync } from 'node:fs';

function deny(reason) {
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`,
  );
}

try {
  const { pushGuardDecision } = await import('./lib.mjs');
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const decision = pushGuardDecision({ agentType: input.agent_type ?? null, command: input.tool_input?.command });
  if (!decision.allow) deny(decision.reason);
} catch (err) {
  deny(`dev-team: the push guard failed (${err.message}), so this command was blocked. Report this to the user.`);
}
