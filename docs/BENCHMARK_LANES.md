# Benchmark Lanes

Balloon now has a benchmark-safe tool for comparing 4 lanes on the same session.

Use:

1. `balloon_compare_benchmark_lanes`

## The 4 Lanes

1. `baseline`: the drifted latest assistant reply
2. `deterministic`: Balloon repair without semantic assist
3. `assist`: Balloon repair with semantic CARA assist mode
4. `staged`: the first staged external Balloon prototype

## Why This Matters

This lets you inspect quality changes without depending on prompt routing.

It also keeps claims honest:

1. we can compare real outputs side by side
2. we can see whether assist actually improves the reply
3. we can see whether the staged lane adds value beyond deterministic repair

## Recommended Use

For short scenarios, pass:

1. `forceStageCount: 3`

That makes the staged lane fully visible even when the session is only a few turns long.

## What To Look For

A strong Balloon result is not "more words."

It is:

1. better constraint preservation
2. better architecture preservation
3. better verification carry-forward
4. better boundedness of the next step
5. less drift from the original request

## Communication Rule

Use these comparisons to say:

1. Balloon has a reproducible lane comparison path
2. Balloon looks promising on selected drift scenarios
3. assist and staged lanes can now be measured against deterministic Balloon

Do not use them to claim:

1. general victory on SlopCodeBench
2. universal superiority over all coding agents
3. solved long-horizon drift in general
