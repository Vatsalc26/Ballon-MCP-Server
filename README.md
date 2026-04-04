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

By design, the server returns analysis artifacts and corrective context. It does not patch your repo by itself.

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
7. `balloon_update_memory_ledger`
8. `balloon_explain_gap_report`

Prompts:

1. `balloon/repair-next-turn`
2. `balloon/review-session-drift`

Resources:

1. `balloon://sessions/{sessionId}/summary`
2. `balloon://sessions/{sessionId}/profile`
3. `balloon://sessions/{sessionId}/gaps`
4. `balloon://sessions/{sessionId}/trickles`
5. `balloon://sessions/{sessionId}/memory`

## Getting Started

1. read [docs/INSTALL.md](./docs/INSTALL.md)
2. run `npm run verify:balloon:mcp`
3. try the workflow in [docs/DEMO_WORKFLOW.md](./docs/DEMO_WORKFLOW.md)

The recommended real host test right now is VS Code with `.vscode/mcp.json`.

## First Demo

The recommended first demo is intentionally small:

1. earlier context says not to rewrite architecture and not to skip tests
2. a later assistant turn confidently proposes a rewrite anyway
3. Balloon produces a gap report, a proxy trickle, and a sharper next-turn repair prompt

If the demo feels good, the important part is not that Balloon produced more text. The important part is that it preserved the existing direction and pushed the next reply back toward the user's real constraints.

## Documentation

1. [Installation](./docs/INSTALL.md)
2. [Demo workflow](./docs/DEMO_WORKFLOW.md)
3. [Architecture roadmap](./docs/ROADMAP.md)
4. [Contributing](./CONTRIBUTING.md)
5. [Security policy](./SECURITY.md)

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
