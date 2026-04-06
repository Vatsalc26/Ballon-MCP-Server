# Long-Session Benchmark

The small 3-scenario pilot is only the start.

This page is for the next question:

Can Balloon stay useful deeper into a session instead of only helping on one short correction?

## If You Want Official Benchmark Input

Use the official SlopCodeBench repository as the source dataset:

1. `https://github.com/SprocketLab/slop-code-bench`

If you download a local snapshot, do not blindly trust the folder name alone.

Verify that the snapshot still contains the expected benchmark markers before using it for Balloon comparisons.

The helper for that is:

```powershell
node dist/verification/verify_slopcodebench_dataset.js --dataset-root "..\\slop-code-bench-main"
```

After the dataset root passes, verify the selected starter problems too:

```powershell
node dist/verification/verify_slopcodebench_starter_suite.js --dataset-root "..\\slop-code-bench-main"
```

That check looks for:

1. the official top-level repo layout
2. README, pyproject, and citation markers
3. benchmark configs, prompts, and problem/test markers
4. whether the dataset is a commit-pinned clone or only a zip-style snapshot

If you want the first recommended real-problem set after verification, use:

1. [SLOPCODEBENCH_STARTER_SUITE.md](./SLOPCODEBENCH_STARTER_SUITE.md)
2. `balloon_describe_slopcode_starter_suite`
3. `balloon_plan_slopcode_starter_benchmark`
4. `balloon_prepare_slopcode_problem`
5. `balloon_score_benchmark_lanes`

## What To Measure

Across a longer session, check whether Balloon keeps:

1. architecture direction
2. protected areas
3. verification obligations
4. bounded next steps
5. acceptable correction tax

## Recommended Session Lengths

Start with:

1. `25` turns
2. `50` turns

Only after those look healthy, move to:

1. `75` turns
2. `100` turns

## Recommended Lanes

Compare:

1. baseline
2. deterministic
3. assist
4. staged

## Recommended Tool

Use `balloon_run_long_session_benchmark` when you want checkpointed long-session comparison in one tool call.

Suggested starting call:

```text
Use #balloon_run_long_session_benchmark with:

- sessionId: long-bench-25
- checkpoints: [10, 25]
- semanticAdapterPath: .\examples\semantic_cara_adapter.example.mjs
- stageThresholds: [5, 15, 40]

Return text only.
Do not edit files.
Do not apply patches.
Do not run terminal commands.
```

That call will return checkpoint batches with:

1. baseline reply
2. deterministic Balloon reply
3. assist Balloon reply
4. staged external Balloon reply

If you want the standard six-dimension scorecard immediately after that, run `balloon_score_benchmark_lanes` on the same session.

## Recommended Staged Profiles

Try:

1. everyday profile: `5 / 15 / 40`
2. longer benchmark profile: `8 / 25 / 60`

## Example Fixtures

Use these starting fixtures:

1. [../examples/long_session_25_turns.example.json](../examples/long_session_25_turns.example.json)
2. [../examples/long_session_50_turns.example.json](../examples/long_session_50_turns.example.json)
3. [../examples/long_session_benchmark_request.example.json](../examples/long_session_benchmark_request.example.json)
4. [../examples/slopcode_starter_suite_request.example.json](../examples/slopcode_starter_suite_request.example.json)
5. [../examples/slopcode_starter_benchmark_plan_request.example.json](../examples/slopcode_starter_benchmark_plan_request.example.json)
6. [../examples/slopcode_problem_prep_request.example.json](../examples/slopcode_problem_prep_request.example.json)
7. [../examples/benchmark_scorecard_request.example.json](../examples/benchmark_scorecard_request.example.json)

They are not "official benchmark wins."

They are simply reproducible longer-session starting points.

The first real-problem step after those fixtures is the verified SCBench starter suite, not a claim of benchmark victory.

## What Good Looks Like

A good longer-session Balloon run is not one that produces more text.

It is one that:

1. keeps earlier constraints alive later in the session
2. resists broad refactors when the session asked for bounded changes
3. keeps verification visible
4. avoids paying too much correction tax for weak gains
5. stays easy enough to rerun that contributors can repeat the evidence

## Communication Rule

Use these runs to say:

1. Balloon has a longer-session evaluation path
2. Balloon is being tested beyond tiny three-turn scenarios
3. the project is moving toward trajectory-shaped proof

Do not use them to say:

1. Balloon has already won SlopCodeBench
2. Balloon has solved long-horizon coding in general
