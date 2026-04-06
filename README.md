# Balloon MCP Server

Balloon MCP is an MCP server for monitoring context fidelity in long AI sessions.

The server is designed around one central observation: long sessions do not only lose facts, they often lose the shape of the user's intent. Balloon turns that problem into a visible runtime surface with profiles, gap reports, retrieval anchors, corrective prompts, and replayable artifacts.

## Why Balloon Exists

AI sessions often fail in a frustratingly subtle way:

1. the latest answer sounds locally reasonable
2. but it quietly abandons earlier constraints, protected areas, or verification obligations
3. the user now has to manually drag the session back onto the right path

That is the problem Balloon is built to surface.

For a developer, this usually looks like:

1. a model proposes a broad refactor when you asked for a bounded change
2. a test requirement disappears halfway through a session
3. a protected file or architecture choice gets ignored because the local turn sounded plausible

Balloon is meant to act like a reasoning sidecar for that failure mode. It does not try to be magical code generation. It tries to make drift visible and apply smaller corrective pressure before the session loses the plot.

## Status

This release is an early public alpha.

It is a working external approximation of the Balloon architecture. It does **not** claim:

1. hidden-state access to closed models
2. direct backend trickle into proprietary reasoning layers
3. inference-layer memory implantation

## What It Does

Balloon MCP helps a host application:

1. build a structured session profile
2. audit the latest turn for drift and omissions
3. surface hidden requirements and questions behind the question
4. retrieve only the most relevant anchors
5. generate a low-volume, non-overriding proxy trickle
6. reinforce recurring context in a memory ledger
7. release similarity-matched corrections from memory and trickle into the next step
8. run a staged external prototype with early, mid, and deep Balloon passes

By design, the server returns analysis artifacts and corrective context. It does not patch your repo by itself.

## Optional Hybrid Lane

Balloon now has an optional hybrid semantic lane in addition to the deterministic base.

That means:

1. deterministic Balloon stays the stable benchmark anchor
2. semantic CARA can be enabled as a shadow or assist mode
3. developers can plug in their own model-backed adapter without changing the core server
4. shadow mode and assist mode are both in the current smoke path
5. assist mode still depends on the host allowing adapter process execution

See [docs/SEMANTIC_CARA.md](./docs/SEMANTIC_CARA.md).

## Staged External Prototype

Balloon now also includes a first staged external prototype.

That staged lane is still honest about the MCP boundary:

1. it is an external approximation, not hidden-state access
2. it runs early, mid, and deep Balloon stages in the open
3. it uses similarity-gated release to decide which memory/trickle corrections should stay visible in the next step
4. it gives us a fourth benchmark lane beyond baseline, deterministic, and assist

See [docs/STAGED_EXTERNAL_BALLOON.md](./docs/STAGED_EXTERNAL_BALLOON.md).

## Why It Feels Different

A good Balloon run is not "more context" for its own sake.

It should make one specific failure visible:

1. the latest answer looks locally plausible
2. but it has stopped honoring earlier constraints, protected areas, or verification obligations
3. Balloon surfaces that loss of intent and applies smaller corrective pressure instead of stuffing the whole session back into the next turn

That makes the first useful experience easier to relate to:

1. you already know what the session should respect
2. Balloon shows what was dropped
3. Balloon gives the next model turn a bounded way to recover

## Core Entry Point

The fastest way to understand the server is:

1. `balloon_run_cycle`

It runs the main Balloon loop:

1. profile update
2. hidden-requirement detection
3. CARA-style gap audit
4. targeted retrieval
5. proxy trickle generation
6. optional memory reinforcement

## Protocol Surface

Tools:

1. `balloon_run_cycle`
2. `balloon_build_profile`
3. `balloon_audit_turn`
4. `balloon_detect_hidden_requirements`
5. `balloon_targeted_retrieval`
6. `balloon_generate_proxy_trickle`
7. `balloon_repair_next_turn`
8. `balloon_semantic_cara_preview`
9. `balloon_compare_repair_lanes`
10. `balloon_run_staged_cycle`
11. `balloon_compare_benchmark_lanes`
12. `balloon_run_long_session_benchmark`
13. `balloon_describe_slopcode_starter_suite`
14. `balloon_prepare_slopcode_problem`
15. `balloon_review_session_drift`
16. `balloon_update_memory_ledger`
17. `balloon_explain_gap_report`

Prompts:

1. `balloon/repair-next-turn`
2. `balloon/review-session-drift`

Resources:

1. `balloon://sessions/{sessionId}/summary`
2. `balloon://sessions/{sessionId}/profile`
3. `balloon://sessions/{sessionId}/gaps`
4. `balloon://sessions/{sessionId}/trickles`
5. `balloon://sessions/{sessionId}/memory`
6. `balloon://sessions/{sessionId}/releases`
7. `balloon://benchmark/slopcode/starter-suite`
8. `balloon://benchmark/slopcode/problems/{problemName}`

## Getting Started

1. read [docs/INSTALL.md](./docs/INSTALL.md)
2. run `npm run verify:balloon:mcp`
3. try the workflow in [docs/DEMO_WORKFLOW.md](./docs/DEMO_WORKFLOW.md)

The recommended real host test right now is VS Code with `.vscode/mcp.json`.

## First Demo

The recommended first demo is intentionally small:

1. earlier context says not to rewrite architecture and not to skip tests
2. a later assistant turn confidently proposes a rewrite anyway
3. Balloon produces a gap report, a proxy trickle, and a sharper next-turn repair path

If your MCP host is unreliable about prompt invocation, use `balloon_repair_next_turn` as the tool-level fallback. It returns the repair packet and a deterministic repaired reply, which makes demos and benchmarks more repeatable.

If you want the drift-review prompt without relying on prompt routing, use `balloon_review_session_drift`.

If you want to compare deterministic vs hybrid repair output directly, use `balloon_compare_repair_lanes`.

If you want the staged external approximation without depending on prompt routing, use `balloon_run_staged_cycle`.

If you want the benchmark-safe four-lane comparison, use `balloon_compare_benchmark_lanes`.

If you want checkpointed long-session comparison in one tool call, use `balloon_run_long_session_benchmark`.

If you want the first real SlopCodeBench starter-suite workflow, use `balloon_describe_slopcode_starter_suite` and `balloon_prepare_slopcode_problem`.

If the demo feels good, the important part is not that Balloon produced more text. The important part is that it preserved the existing direction and pushed the next reply back toward the user's real constraints.

## Documentation

1. [Installation](./docs/INSTALL.md)
2. [Demo workflow](./docs/DEMO_WORKFLOW.md)
3. [Current readiness](./docs/READINESS.md)
4. [Semantic CARA](./docs/SEMANTIC_CARA.md)
5. [Staged external Balloon](./docs/STAGED_EXTERNAL_BALLOON.md)
6. [Host compatibility](./docs/HOST_COMPATIBILITY.md)
7. [Cline quickstart](./docs/CLINE_QUICKSTART.md)
8. [Roo Code quickstart](./docs/ROO_CODE_QUICKSTART.md)
9. [Latency and correction tax](./docs/LATENCY_AND_CORRECTION_TAX.md)
10. [Benchmark lanes](./docs/BENCHMARK_LANES.md)
11. [Long-session benchmark](./docs/LONG_SESSION_BENCHMARK.md)
12. [SlopCodeBench starter suite](./docs/SLOPCODEBENCH_STARTER_SUITE.md)
13. [Contributor starters](./docs/CONTRIBUTOR_STARTERS.md)
14. [MCP listings](./docs/MCP_LISTINGS.md)
15. [Architecture roadmap](./docs/ROADMAP.md)
16. [Contributing](./CONTRIBUTING.md)
17. [Security policy](./SECURITY.md)
18. [Support](./SUPPORT.md)

## Good Fit

Balloon MCP is most useful when:

1. a session has strong prior constraints that should continue to matter
2. a locally plausible answer may still be drifting away from earlier intent
3. visible correction artifacts are more valuable than invisible prompt stuffing

## Not The Claim

This public alpha does not claim:

1. hidden-state access to closed models
2. direct backend trickle into proprietary reasoning layers
3. repo-wide architecture auditing as the main product identity

The current server is the external approximation of the Balloon architecture: CARA-style gap analysis, targeted retrieval, and proxy trickle for context fidelity over time.
