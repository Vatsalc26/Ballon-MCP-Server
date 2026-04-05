# Changelog

All notable public changes to Balloon MCP should be recorded in this file.

## Unreleased

1. improved deterministic repair phrasing so repaired replies preserve direction more naturally
2. benchmark pilot logging moved from plan-only to first recorded maintainer benchmark notes
3. added the optional semantic CARA lane with `shadow` and `assist` modes
4. added `balloon_semantic_cara_preview` for deterministic-vs-hybrid inspection
5. documented the adapter contract, configuration flags, and current host-permission caveat for MCP-hosted assist mode
6. added `balloon_compare_repair_lanes` and `balloon_review_session_drift` as host-reliability fallbacks for comparison and drift review
7. improved semantic adapter path handling for assist-mode runs
8. clarified lane comparison output so reply changes and semantic-signal changes are distinguished
9. improved the example semantic adapter so assist-mode repairs preserve protected areas, architecture wording, verification obligations, and bounded next-step quality more explicitly
10. scrubbed public docs/examples so the standalone repo no longer uses internal-layout language
11. added similarity-gated release packets so memory and trickle corrections are surfaced selectively instead of all at once
12. added `balloon_run_staged_cycle` as the first staged multi-balloon external prototype
13. added `balloon_compare_benchmark_lanes` for `baseline / deterministic / assist / staged` comparison in one tool call
14. added `balloon://sessions/{sessionId}/releases` so release packets are inspectable through MCP resources
15. expanded the smoke verifier to cover staged-cycle and four-lane benchmark tooling
16. added public docs/examples for the staged external lane and four-lane benchmark workflow

## 0.1.0-alpha.0 - 2026-04-05

First public alpha.

Highlights:

1. working MCP server with tools, prompts, and resources
2. `balloon_run_cycle` hero tool
3. `balloon/repair-next-turn` and `balloon/review-session-drift`
4. `balloon_repair_next_turn` tool-level repair fallback
5. SQLite-backed profile, gap, trickle, and memory state
6. VS Code host-tested alpha path
7. public docs for install, demo, roadmap, contribution, and security
