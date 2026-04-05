# Balloon MCP Roadmap

This document explains two things separately:

1. what Balloon MCP alpha implements today
2. what the fuller Balloon Architecture is trying to become over time

Keeping those separate is important. The public repo should be ambitious, but it should not blur current runtime truth with future architecture.

## Current Alpha

The current server is the external approximation of Balloon.

Today it provides:

1. structured profile extraction from prior turns
2. CARA-style gap auditing against user and project context
3. targeted retrieval of only the most relevant prior anchors
4. proxy trickle as low-volume corrective pressure on the next turn
5. memory-ledger reinforcement for recurring constraints
6. MCP tools, prompts, and resources that expose those artifacts visibly

This is already useful because it makes one painful failure mode visible:

1. the model answers the local turn
2. but it quietly stops honoring earlier constraints
3. Balloon surfaces the drift and helps the next turn recover

## Product Shape

The product is best understood as 3 layers:

1. Balloon engine
2. Balloon MCP server
3. host integrations

That matters because the desired user experience is not only "a server with tools."

The goal is a snap-in anti-drift layer for coding sessions:

1. connect Balloon quickly
2. use it in an MCP-capable coding surface
3. let it help keep earlier constraints, architecture direction, and verification obligations in view

The current public repo is the alpha core of that experience, not the fully finished host experience yet.

## What This Alpha Does Not Claim

The current public alpha does not claim:

1. hidden-state access to closed models
2. direct backend trickle into proprietary reasoning layers
3. provider-level memory implantation
4. repo-wide architecture auditing as Balloon's core identity

If repo context is added later, it should remain bounded and in service of CARA rather than turning Balloon into a generic whole-repo auditor.

## Full Architecture Direction

The full Balloon Architecture described in the papers remains the longer-term target.

That fuller direction includes:

1. staged balloons that activate as conversation depth increases
2. CARA auditing both established context and live reasoning state
3. targeted retrieval tied to typed gaps
4. passive backend trickle between outputs
5. provenance-aware corrective material
6. earned memory solidification after repeated successful relevance

In short:

1. current repo: external approximation
2. end-state vision: deeper reasoning-sidecar architecture

## Near-Term Roadmap

The next useful steps are:

1. stronger prompt-routing and host-surface reliability
2. a first Balloon-vs-baseline evaluation pass on realistic long-session tasks
3. cleaner repaired replies and better demo quality
4. cleaner public examples and install paths
5. bounded repo-aware grounding only where it materially improves CARA
6. an optional hybrid semantic CARA lane layered on top of the deterministic base

## Medium-Term Roadmap

After the alpha is stable, the next layer should focus on:

1. multi-balloon external prototypes
2. better gap scoring and ranking
3. stronger similarity-gated release behavior
4. evaluation on longer coding sessions
5. comparison against baseline long-session drift, including code-grounded erosion and verbosity-style measurements where feasible

## Evaluation Track

The evaluation story matters because Balloon is making a long-session quality claim, not only a protocol claim.

The next benchmark layer should proceed in this order:

1. a small Balloon-vs-baseline pilot on reproducible long-session coding scenarios
2. trajectory capture for repaired vs unrepaired runs
3. measurement of visible drift, omission rate, and repair quality
4. later comparison against public long-horizon benchmarks such as SlopCodeBench-style erosion and verbosity signals

Do not claim benchmark wins before the runs exist and the results are reproducible.

## Build Strategy

The fastest credible path is a 2-lane build:

1. deterministic Balloon as the stable reproducible base
2. hybrid semantic Balloon as the next optional lane

Current state inside that strategy:

1. the deterministic base is already the benchmark anchor
2. semantic CARA `shadow` mode is the first verified hybrid step
3. semantic CARA `assist` mode is the adapter-backed experimental step

That lets the project compare:

1. baseline
2. deterministic Balloon
3. hybrid Balloon

without losing clarity on cost, latency, or what actually improved.

## Long-Term Roadmap

Longer term, the architecture should move toward:

1. deeper open-weight experiments on state intervention
2. stronger provenance-aware correction flows
3. more realistic earned-memory behavior
4. multilingual and code-switched context-fidelity evaluation
5. provider-level experiments where backend access is possible

## Relationship To The Papers

This roadmap stays anchored to:

1. `Balloon Architecture v1.0`
2. `Balloon Architecture v2.0`

The repo is not meant to replace those papers. It is meant to make the buildable layer legible to contributors and to show how current runtime work connects to the fuller research direction.
