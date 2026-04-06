# SlopCodeBench Starter Suite

This is the first real dataset-backed Balloon benchmark starter set.

It exists so we can move from toy scenarios into repeatable anti-slop evaluation without pretending we have already "won" SlopCodeBench.

## Selected Problems

1. `file_backup`
2. `execution_server`
3. `trajectory_api`

## Why These 3

### `file_backup`

Good for:

1. bounded CLI evolution
2. event-history and output-discipline carry-forward
3. resisting unnecessary architectural widening when the spec gets more complex

### `execution_server`

Good for:

1. additive server growth under timeout, caching, concurrency, and scheduling pressure
2. checking whether Balloon preserves operational constraints instead of collapsing into broad rewrites
3. exposing structural erosion once multiple follow-on requirements stack up

### `trajectory_api`

Good for:

1. preserving API boundaries and validation rules
2. keeping concurrency and lineage constraints coherent later in the sequence
3. checking whether Balloon stays bounded once parsing and sandboxing pressure arrive

## New Runtime Surfaces

Use these first:

1. `balloon_describe_slopcode_starter_suite`
2. `balloon_plan_slopcode_starter_benchmark`
3. `balloon_prepare_slopcode_problem`
4. `balloon_score_benchmark_lanes`
5. `balloon_score_long_session_benchmark`
6. `balloon_summarize_slopcode_starter_suite`
7. `balloon_export_slopcode_starter_artifacts`
8. `balloon://benchmark/slopcode/starter-suite`
9. `balloon://benchmark/slopcode/starter-suite/runbook`
10. `balloon://benchmark/slopcode/problems/{problemName}`

These do not claim benchmark victory.

They exist to make the starter suite:

1. verified
2. inspectable
3. repeatable
4. easier for contributors to rerun

## Starter Workflow

1. verify the local snapshot with `verify_slopcodebench_dataset`
2. verify the selected starter-suite problems with `verify_slopcodebench_starter_suite`
3. inspect the suite with `balloon_describe_slopcode_starter_suite`
4. generate the full runbook with `balloon_plan_slopcode_starter_benchmark`
5. inspect one problem with `balloon_prepare_slopcode_problem`
6. run the checkpoint sequence in a real host session
7. compare lanes with `balloon_compare_benchmark_lanes`
8. score them with `balloon_score_benchmark_lanes`
9. when you score a whole SCBench checkpoint sequence, use `balloon_score_long_session_benchmark` with `checkpointMode: assistant_checkpoint`
10. once several problem sessions exist, roll them up with `balloon_summarize_slopcode_starter_suite`
11. save JSON and Markdown benchmark artifacts with `balloon_export_slopcode_starter_artifacts`
12. use the exported pressure traces to note where Balloon actually reduced drift and where pressure stayed elevated

## Recommended First Order

1. `file_backup`
2. `execution_server`
3. `trajectory_api`

That order starts with bounded CLI pressure, then moves to more stateful server pressure, then finishes with richer API-boundary pressure.

## Recommended Benchmark Rule

For these first checkpoint-sequence runs:

1. keep `forceStageCount: 3`
2. treat the recommended SCBench checkpoint numbers as assistant-turn ordinals, not raw turn counts
3. set `checkpointMode: assistant_checkpoint` whenever you score a whole checkpoint batch
4. score at least the opening, middle, and late checkpoint of each problem
5. use the same six-dimension scorecard on every rerun:
6. constraint preservation
7. architecture preservation
8. verification carry-forward
9. omission recovery
10. boundedness
11. clarity
12. export the scored bundle so the rerun leaves repo-backed artifacts instead of only chat text
13. do not make claims beyond "starter-suite reruns"
14. if we want stronger external-benchmark claims later, pin the upstream dataset revision instead of relying on the current zip-style snapshot

## Why This Block Matters

The starter suite now has an explicit runbook, a scorecard tool, and an artifact export path.

That means contributors no longer have to improvise:

1. which order to run
2. which prompts to paste next
3. how to score `baseline / deterministic / assist / staged`
4. how to summarize a whole long-session checkpoint batch
5. how to summarize the whole starter suite once multiple real sessions exist
6. how to save JSON and Markdown artifacts for the rerun
7. how to keep claims honest while still gathering useful anti-slop evidence
8. how to point to concrete rising/falling pressure traces instead of hand-waving about session quality
