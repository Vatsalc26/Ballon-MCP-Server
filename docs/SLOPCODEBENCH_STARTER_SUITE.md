# SlopCodeBench Starter Suite

This is the first real dataset-backed Balloon benchmark starter set.

It is not a claim that Balloon has already won SlopCodeBench.

It is the first verified set of real SCBench problems we recommend for repeatable Balloon anti-drift reruns.

## Selected Problems

1. `file_backup`
2. `execution_server`
3. `trajectory_api`

## Why These 3

### `file_backup`

Good for bounded CLI evolution, event-history discipline, and checking whether Balloon resists premature refactors when the spec grows.

### `execution_server`

Good for stateful server growth under timeout, caching, concurrency, and scheduling pressure.

### `trajectory_api`

Good for preserving API boundaries, validation rules, concurrency discipline, and layered feature growth.

## New MCP Surfaces

Use:

1. `balloon_describe_slopcode_starter_suite`
2. `balloon_plan_slopcode_starter_benchmark`
3. `balloon_prepare_slopcode_problem`
4. `balloon_score_benchmark_lanes`
5. `balloon_score_long_session_benchmark`
6. `balloon_summarize_slopcode_starter_suite`
7. `balloon://benchmark/slopcode/starter-suite`
8. `balloon://benchmark/slopcode/starter-suite/runbook`
9. `balloon://benchmark/slopcode/problems/{problemName}`

## Fast Starter Workflow

1. verify your local snapshot with `verify_slopcodebench_dataset`
2. verify the selected starter problems with `verify_slopcodebench_starter_suite`
3. inspect the suite with `balloon_describe_slopcode_starter_suite`
4. build the runbook with `balloon_plan_slopcode_starter_benchmark`
5. inspect one problem with `balloon_prepare_slopcode_problem`
6. run the checkpoint sequence in your host
7. compare lanes with `balloon_compare_benchmark_lanes`
8. score them with `balloon_score_benchmark_lanes`
9. if you stretch the same session across multiple checkpoints, score the whole checkpoint batch with `balloon_score_long_session_benchmark`
10. after several problem sessions exist, roll them up with `balloon_summarize_slopcode_starter_suite`

## Recommended First Order

1. `file_backup`
2. `execution_server`
3. `trajectory_api`

## Suggested Rule

For the first checkpoint-sequence runs:

1. keep `forceStageCount: 3`
2. score the opening, middle, and late checkpoint of each problem
3. keep the same score dimensions every time:
4. constraint preservation
5. architecture preservation
6. verification carry-forward
7. omission recovery
8. boundedness
9. clarity
10. keep claims modest and reproducible

## Why The New Runbook Matters

The starter suite now has both:

1. a runbook tool
2. a scorecard tool
3. a long-session score tool
4. a suite summary tool

So contributors can move from dataset verification to repeatable scoring without inventing their own process each time.

## Claim Boundary

Say:

1. Balloon has a verified SCBench starter-suite path
2. Balloon is being tested on real benchmark problem sequences

Do not say:

1. Balloon has already beaten SlopCodeBench
2. Balloon has solved long-horizon coding in general
