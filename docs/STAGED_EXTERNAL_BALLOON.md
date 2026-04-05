# Staged External Balloon

Balloon MCP now includes a first staged external prototype.

This is still an MCP-side approximation. It does not claim hidden-state access or provider-level trickle into closed-model reasoning.

## What "Staged" Means

The staged lane splits the correction pass into 3 external stages:

1. `early`: direct drift and contradiction pressure
2. `mid`: hidden requirements plus targeted retrieval
3. `deep`: similarity-gated release from memory and trickle

The goal is not to make the reply bigger.

The goal is to make the correction path more disciplined over longer sessions.

## Similarity-Gated Release

The deep stage does not dump every remembered rule back into the next step.

Instead, it:

1. looks at recent memory items and trickle instructions
2. scores them against the current correction context
3. releases only the strongest matches
4. keeps weaker matches held back

That makes the correction path more selective and easier to inspect.

## Tool Surface

Use:

1. `balloon_run_staged_cycle`

That tool returns:

1. active stage count
2. per-stage summaries
3. the release packet
4. the deterministic repaired reply
5. the staged external reply

## Thresholds

The staged lane is not "3 balloons total."

It is `3` named balloon families that can re-inflate repeatedly across a long session:

1. `early` runs every turn
2. `mid` activates on cadence or pressure
3. `deep` activates on longer cadence, persistence, or sustained depth

Default staged cadence anchors are:

1. `5`
2. `15`
3. `40`

Read those as:

1. `mid` can wake up every `5` turns, or earlier if gap pressure spikes
2. `deep` can wake up every `15` turns, or earlier if persistent drift shows up
3. after `40` turns, the session is deep enough that the deep balloon should stay active by default

For short demos or benchmark scenarios, use `forceStageCount: 3` so the full staged path is visible even in a small session.

That means the product shape is:

1. early correction pressure on every turn
2. periodic or pressure-triggered mid balloon passes
3. periodic or persistence-triggered deep balloon passes
4. sustained deep correction once the session is genuinely long-horizon

## Recommended Stage Strategy

Do not think of this as "100 balloons."

For the MCP product, the better shape is:

1. keep `3` named stages: `early`, `mid`, `deep`
2. support long sessions of `100+` turns with those same stages
3. let the stage thresholds change by use case

Recommended profiles:

1. public demo profile: `3 / 6 / 10`
2. everyday coding profile: `5 / 15 / 40`
3. long-session benchmark profile: `8 / 25 / 60`

That means:

1. `early` catches the first visible drift every turn
2. `mid` starts doing more retrieval and hidden-requirement pressure on cadence and under pressure
3. `deep` becomes the longer-session selective-release lane, and eventually stays on when the trajectory is long enough

For a `100`-turn session, the point is not to create `100` balloons.

The point is to let the same staged system stay useful across the whole trajectory.

## Why This Exists

The staged lane is the first MCP-buildable step toward the paper's multi-balloon feel.

It gives us:

1. a more faithful external approximation
2. a richer benchmark lane
3. a way to study correction depth without pretending we already have provider-side access

## Current Truth

Today:

1. deterministic Balloon is still the benchmark anchor
2. assist Balloon is the optional semantic refinement lane
3. staged Balloon is the fuller external approximation lane
4. the current stage count is intentionally `3`, not unbounded

The right comparison is:

1. baseline
2. deterministic
3. assist
4. staged external prototype
