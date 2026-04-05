# Latency And Correction Tax

Balloon is trying to improve long-session discipline.

That only matters if the host experience still feels usable.

## What "Correction Tax" Means

Correction tax is the extra cost of keeping Balloon in the loop:

1. extra analysis
2. extra retrieval
3. extra semantic help
4. extra correction text

If that cost gets too high, people will stop using the server even if the ideas are good.

## Practical Lane Cost

From lowest to highest expected cost:

1. `baseline`: no Balloon correction
2. `deterministic`: cheapest useful Balloon lane
3. `assist`: adds semantic adapter cost
4. `staged`: adds extra correction structure and release logic

That does not mean the most expensive lane is always the best lane.

## Current Product Reading

Today:

1. deterministic Balloon is the safest default benchmark anchor
2. assist Balloon is useful when the host can run the adapter cleanly
3. staged Balloon is useful when you want the fuller external approximation or benchmark visibility

## Recommended Default Strategy

For everyday use:

1. start with deterministic Balloon
2. turn on assist when you want more natural repair quality
3. use staged when you want a deeper benchmark or longer-session discipline check

For demos:

1. deterministic or assist is usually enough for a short first impression
2. staged is best when you want to show the multi-balloon external approximation explicitly

## Signs The Tax Is Too High

You should scale back if:

1. the host feels laggy on ordinary turns
2. the repair text keeps getting larger without getting sharper
3. the semantic lane changes wording without improving decisions
4. the staged lane adds ceremony but not a better bounded next step

## Current Honest Status

Balloon does not yet have a deep published latency study.

The current project state is:

1. smoke verification is strong
2. manual benchmark evidence is real
3. latency and correction-tax notes still need more explicit measurement

That is why the roadmap should prefer:

1. more host validation
2. more benchmark reruns
3. clearer lane-by-lane tradeoff notes

before making big performance claims.
