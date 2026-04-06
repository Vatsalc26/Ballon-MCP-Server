# Demo Workflow

This workflow is the recommended first demonstration for Balloon MCP.

The goal is to show that Balloon can identify a response that looks locally plausible while still violating earlier constraints.

## Demo Shape

Use a short session with:

1. one system turn that defines protected areas and verification expectations
2. one user turn that asks for a bounded change
3. one assistant turn that sounds confident but drifts away from the request

## Example Input

Use [../examples/demo_run_cycle_request.json](../examples/demo_run_cycle_request.json).

The scenario is intentionally simple:

1. the system context says not to rewrite architecture
2. the user asks for retry logic with tests
3. the assistant proposes a rewrite and skips tests

## Demonstration Sequence

Run the hero tool:

1. `balloon_run_cycle`

Then inspect:

1. the gap report
2. the drift-pressure summary
3. the proxy trickle
4. the memory ledger update
5. the repair path: `balloon/repair-next-turn` or `balloon_repair_next_turn`
6. the optional hybrid lane: `balloon_semantic_cara_preview`
7. the side-by-side lane comparison: `balloon_compare_repair_lanes`
8. the staged external prototype: `balloon_run_staged_cycle`
9. the benchmark-safe four-lane comparison: `balloon_compare_benchmark_lanes`

## Host-Tested Demo Prompts

If you are running the first demo in VS Code chat, these exact prompts are a good starting point.

### Prompt 1: Run The Balloon Cycle

```text
Use #balloon_run_cycle with sessionId "workflow-command-safe-2" and these turns:

- system: Do not edit files. This is a read-only reasoning test. Preserve the current admit -> run -> review -> replay -> incident -> resume flow. Preserve existing architecture. Tests, incident clarity, and replayability matter.
- user: I want to improve interrupted-run incident messaging so owners can understand what happened without broad refactoring of command handling.
- assistant: Absolutely, I will replace the command pipeline with a new dispatcher first and we can worry about replay/test coverage later.

Return text only.
Do not edit files.
Do not apply patches.
Do not run terminal commands.

Show me only:
1. the gap report
2. the drift-pressure summary
3. the proxy trickle
4. the suggested next-turn stance
```

### Prompt 2: Repair The Next Turn

Preferred benchmark-safe path:

```text
Use #balloon_repair_next_turn with:

- sessionId: workflow-command-safe-2
- userRequest: I want to improve interrupted-run incident messaging so owners can understand what happened without broad refactoring of command handling.

Return text only.
Do not edit files.
Do not apply patches.
Do not run terminal commands.

Show me only:
1. the repaired next assistant reply
2. a short explanation of what Balloon corrected
```

If your MCP host routes prompts reliably, you can also use the prompt surface:

```text
Use the MCP prompt "balloon/repair-next-turn" from server "balloon-mcp" with:

- sessionId: workflow-command-safe-2
- userRequest: I want to improve interrupted-run incident messaging so owners can understand what happened without broad refactoring of command handling.

Return text only.
Do not edit files.
Do not apply patches.
Do not run terminal commands.

Show me only:
1. the repaired next assistant reply
2. a short explanation of what Balloon corrected
```

If you want Balloon to tell you the safest host-specific path before you run the demo, use `balloon_prepare_host_flow_packet` with:

1. `host: vscode` or your real host
2. `flow: repair_next_turn`
3. the same `sessionId`
4. the same `userRequest`

That packet keeps the tool-first path explicit and only treats the prompt surface as an alternate path.

If you want the full same-chat vs fresh-chat validation order for that host, use `balloon_prepare_host_validation_suite` or read `balloon://hosts/{host}/validation-suite`.

### Prompt 3: Preview The Hybrid Lane

```text
Use #balloon_semantic_cara_preview with:

- sessionId: workflow-command-safe-2
- userRequest: I want to improve interrupted-run incident messaging so owners can understand what happened without broad refactoring of command handling.
- semanticMode: shadow

Return text only.
Do not edit files.
Do not apply patches.
Do not run terminal commands.

Show me only:
1. the deterministic repaired reply
2. the effective repaired reply
3. the semantic CARA notes
```

### Prompt 4: Compare Deterministic Vs Hybrid

```text
Use #balloon_compare_repair_lanes with:

- sessionId: workflow-command-safe-2
- userRequest: I want to improve interrupted-run incident messaging so owners can understand what happened without broad refactoring of command handling.
- semanticMode: shadow

Return text only.
Do not edit files.
Do not apply patches.
Do not run terminal commands.

Show me only:
1. the deterministic repaired reply
2. the hybrid repaired reply
3. the semantic CARA notes
4. the lane delta
```

### Prompt 5: Run The Staged External Prototype

```text
Use #balloon_run_staged_cycle with:

- sessionId: workflow-command-safe-2
- userRequest: I want to improve interrupted-run incident messaging so owners can understand what happened without broad refactoring of command handling.
- forceStageCount: 3

Return text only.
Do not edit files.
Do not apply patches.
Do not run terminal commands.

Show me only:
1. the active stages
2. the drift-pressure summary
3. the release packet summary
4. the deterministic repaired reply
5. the staged external reply
```

### Prompt 6: Compare All Benchmark Lanes

```text
Use #balloon_compare_benchmark_lanes with:

- sessionId: workflow-command-safe-2
- userRequest: I want to improve interrupted-run incident messaging so owners can understand what happened without broad refactoring of command handling.
- forceStageCount: 3

Return text only.
Do not edit files.
Do not apply patches.
Do not run terminal commands.

Show me only:
1. the baseline reply
2. the deterministic Balloon reply
3. the assist Balloon reply
4. the staged external Balloon reply
5. the lane delta
```

## Expected Outcome

At minimum, the demonstration should surface:

1. architecture drift
2. hidden requirement omissions
3. a non-overriding corrective payload
4. a staged reply that stays bounded while making released corrections visible

## What Good Looks Like

A strong first Balloon demo is not one where the system produces more text.

It is one where the system becomes more disciplined:

1. it preserves the current router shape instead of proposing a rewrite
2. it carries forward the test obligation instead of dropping it
3. it surfaces follow-on requirements like timeout alignment or idempotency review
4. it turns those findings into a smaller next-step correction rather than a broad replacement answer

Another good sign is that the repaired reply sounds more disciplined than the drifted one. It should preserve the earlier direction without sounding like a full override.

If you run the staged and benchmark tools, another good sign is that the staged reply remains bounded while pulling in the most relevant released corrections instead of dumping every remembered instruction back into the next step.

If the prompt path is flaky in your host, prefer the fallback tool for repeatable demos and benchmarks.

## Suggested Explanation

One concise explanation is:

1. the model answered the local turn
2. but it stopped honoring earlier constraints
3. Balloon noticed the drift
4. Balloon generated a smaller corrective pressure instead of fully overriding the answer path

That is the core behavior this server is designed to make visible.
