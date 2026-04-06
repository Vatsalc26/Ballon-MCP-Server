# Balloon MCP Server

<p align="center">
  <img src="./docs/assets/balloon-mcp-icon.png" alt="Balloon MCP icon" width="160" />
</p>

<p align="center">
  <a href="./docs/READINESS.md"><img alt="Status: Public Alpha" src="https://img.shields.io/badge/status-public%20alpha-0f766e" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-1f2937" /></a>
  <a href="./docs/HOST_COMPATIBILITY.md"><img alt="Hosts: VS Code first" src="https://img.shields.io/badge/hosts-VS%20Code%20first-2563eb" /></a>
  <a href="./docs/LONG_SESSION_BENCHMARK.md"><img alt="Evidence: 4-lane and long-session benchmark paths" src="https://img.shields.io/badge/evidence-4%20lane%20%2B%20long%20session-f59e0b" /></a>
</p>

Balloon MCP is an MCP server for monitoring context fidelity in long AI sessions.

The server is designed around one central observation: long sessions do not only lose facts, they often lose the shape of the user's intent. Balloon turns that problem into a visible runtime surface with profiles, gap reports, drift-pressure summaries, retrieval anchors, corrective prompts, and replayable artifacts.

<p align="center">
  <img src="./docs/assets/balloon-mcp-banner.png" alt="Balloon MCP anti-drift banner" width="760" />
</p>

At a glance:

1. deterministic Balloon is the stable benchmark anchor
2. assist Balloon adds optional semantic refinement
3. staged Balloon adds early, mid, and deep external passes for longer-session discipline

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
3. score the current drift pressure instead of only listing raw gaps
4. surface hidden requirements and questions behind the question
5. retrieve only the most relevant anchors
6. generate a low-volume, non-overriding proxy trickle
7. reinforce recurring context in a memory ledger
8. promote repeated drift into persistent focus that can change retrieval, trickle ordering, and release behavior
9. release similarity-matched corrections from memory and trickle into the next step
10. run a staged external prototype with early, mid, and deep Balloon passes

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

If you just want the shortest mental model:

1. baseline drifts
2. deterministic Balloon repairs the drift
3. assist Balloon improves the wording and bounded-next-step quality
4. staged Balloon adds re-check discipline before scope widens

## Why It Feels Different

A good Balloon run is not "more context" for its own sake.

It should make one specific failure visible:

1. the latest answer looks locally plausible
2. but it has stopped honoring earlier constraints, protected areas, or verification obligations
3. Balloon surfaces that loss of intent and applies smaller corrective pressure instead of stuffing the whole session back into the next turn
4. recurring drift can now become persistent focus, so repeated architecture or verification failures get pulled earlier into the correction path

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
4. drift-pressure scoring
5. persistent drift focus when the same failure pattern keeps recurring
6. targeted retrieval
7. proxy trickle generation
8. optional memory reinforcement

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
12. `balloon_score_benchmark_lanes`
13. `balloon_run_long_session_benchmark`
14. `balloon_score_long_session_benchmark`
15. `balloon_prepare_host_setup_packet`
16. `balloon_validate_host_setup`
17. `balloon_run_install_diagnostics`
18. `balloon_prepare_host_flow_packet`
19. `balloon_prepare_host_validation_suite`
20. `balloon_record_host_validation_result`
21. `balloon_summarize_host_validation_results`
22. `balloon_describe_slopcode_starter_suite`
23. `balloon_plan_slopcode_starter_benchmark`
24. `balloon_record_slopcode_run_evidence`
25. `balloon_summarize_slopcode_run_evidence`
26. `balloon_summarize_slopcode_starter_suite`
27. `balloon_export_slopcode_starter_artifacts`
28. `balloon_prepare_slopcode_problem`
29. `balloon_review_session_drift`
30. `balloon_update_memory_ledger`
31. `balloon_explain_gap_report`

Prompts:

1. `balloon/repair-next-turn`
2. `balloon/review-session-drift`

Resources:

1. `balloon://sessions/{sessionId}/summary`
2. `balloon://sessions/{sessionId}/profile`
3. `balloon://sessions/{sessionId}/gaps`
4. `balloon://sessions/{sessionId}/pressure`
5. `balloon://sessions/{sessionId}/trickles`
6. `balloon://sessions/{sessionId}/memory`
7. `balloon://sessions/{sessionId}/releases`
8. `balloon://hosts/matrix`
9. `balloon://hosts/{host}`
10. `balloon://hosts/{host}/playbook`
11. `balloon://hosts/{host}/validation-suite`
12. `balloon://hosts/{host}/validation-evidence`
13. `balloon://benchmark/slopcode/starter-suite`
14. `balloon://benchmark/slopcode/starter-suite/runbook`
15. `balloon://benchmark/slopcode/evidence`
16. `balloon://benchmark/slopcode/evidence/{problemName}`
17. `balloon://benchmark/slopcode/problems/{problemName}`

## Getting Started

1. read [docs/INSTALL.md](./docs/INSTALL.md)
2. run `npm run verify:balloon:mcp`
3. try the workflow in [docs/DEMO_WORKFLOW.md](./docs/DEMO_WORKFLOW.md)

The recommended real host test right now is VS Code with `.vscode/mcp.json`.

## First Demo

The recommended first demo is intentionally small:

1. earlier context says not to rewrite architecture and not to skip tests
2. a later assistant turn confidently proposes a rewrite anyway
3. Balloon produces a gap report, a drift-pressure summary, a proxy trickle, and a sharper next-turn repair path

If your MCP host is unreliable about prompt invocation, use `balloon_repair_next_turn` as the tool-level fallback. It returns the repair packet and a deterministic repaired reply, which makes demos and benchmarks more repeatable.

If you want the drift-review prompt without relying on prompt routing, use `balloon_review_session_drift`.

If you want to compare deterministic vs hybrid repair output directly, use `balloon_compare_repair_lanes`.

If you want the staged external approximation without depending on prompt routing, use `balloon_run_staged_cycle`.

If you want the benchmark-safe four-lane comparison, use `balloon_compare_benchmark_lanes`.

If you want checkpointed long-session comparison in one tool call, use `balloon_run_long_session_benchmark`.

If you want to inspect whether drift pressure is rising, falling, or staying stuck across a session, read `balloon://sessions/{sessionId}/pressure`.

If you want Balloon to generate or sanity-check a host config packet, use `balloon_prepare_host_setup_packet`, `balloon_validate_host_setup`, `balloon_run_install_diagnostics`, `balloon_prepare_host_flow_packet`, `balloon_prepare_host_validation_suite`, `balloon_record_host_validation_result`, `balloon_summarize_host_validation_results`, or `balloon://hosts/matrix`.

If you want the first real SlopCodeBench starter-suite workflow, use `balloon_describe_slopcode_starter_suite` and `balloon_prepare_slopcode_problem`.

If you want repo-backed SCBench summary bundles, use `balloon_export_slopcode_starter_artifacts`. Those exports now include both pressure traces and live-vs-replay evidence coverage.

If you want to keep benchmark claims honest, record whether a run was truly live with `balloon_record_slopcode_run_evidence`, summarize it with `balloon_summarize_slopcode_run_evidence`, and inspect `balloon://benchmark/slopcode/evidence`.

If the demo feels good, the important part is not that Balloon produced more text. The important part is that it preserved the existing direction and pushed the next reply back toward the user's real constraints.

## Documentation

1. [Installation](./docs/INSTALL.md)
2. [Demo workflow](./docs/DEMO_WORKFLOW.md)
3. [Current readiness](./docs/READINESS.md)
4. [Semantic CARA](./docs/SEMANTIC_CARA.md)
5. [Staged external Balloon](./docs/STAGED_EXTERNAL_BALLOON.md)
6. [Host compatibility](./docs/HOST_COMPATIBILITY.md)
7. [Host validation](./docs/HOST_VALIDATION.md)
8. [Cline quickstart](./docs/CLINE_QUICKSTART.md)
9. [Roo Code quickstart](./docs/ROO_CODE_QUICKSTART.md)
10. [Latency and correction tax](./docs/LATENCY_AND_CORRECTION_TAX.md)
11. [Benchmark lanes](./docs/BENCHMARK_LANES.md)
12. [Long-session benchmark](./docs/LONG_SESSION_BENCHMARK.md)
13. [SlopCodeBench starter suite](./docs/SLOPCODEBENCH_STARTER_SUITE.md)
14. [Contributor starters](./docs/CONTRIBUTOR_STARTERS.md)
15. [MCP listings](./docs/MCP_LISTINGS.md)
16. [Architecture roadmap](./docs/ROADMAP.md)
17. [Contributing](./CONTRIBUTING.md)
18. [Security policy](./SECURITY.md)
19. [Support](./SUPPORT.md)

## Visual Assets

1. app/listing icon: [docs/assets/balloon-mcp-icon.png](./docs/assets/balloon-mcp-icon.png)
2. README banner: [docs/assets/balloon-mcp-banner.png](./docs/assets/balloon-mcp-banner.png)
3. staged explainer image: [docs/assets/balloon-mcp-stages.png](./docs/assets/balloon-mcp-stages.png)
4. simple mark: [docs/assets/balloon-mcp-mark.png](./docs/assets/balloon-mcp-mark.png)

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
