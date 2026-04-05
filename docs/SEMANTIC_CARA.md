# Semantic CARA

Balloon MCP now includes an optional hybrid lane called semantic CARA.

The deterministic Balloon path remains the default and the benchmark anchor.

Semantic CARA is additive:

1. deterministic Balloon stays stable and reproducible
2. semantic CARA can refine repair quality and gap interpretation
3. the two lanes can be benchmarked against each other

## Modes

Balloon supports these semantic CARA modes:

1. `off`
2. `shadow`
3. `assist`

### `off`

No semantic CARA work is attempted.

### `shadow`

Balloon builds the semantic packet and returns semantic notes without calling an external adapter.

This is useful for:

1. debugging
2. demos
3. benchmark-safe inspection

### `assist`

Balloon builds the semantic packet and sends it to an external adapter.

That adapter can call whatever model or local inference stack you want.

Current truth:

1. the adapter contract is implemented
2. the current smoke verifier proves `shadow` mode
3. `assist` mode has passed a direct local adapter check
4. MCP-hosted `assist` execution can still depend on the host allowing child-process execution

## Why This Matters

This is how Balloon can move toward the paper's feel without pretending we already have provider-level reasoning access.

It keeps the current external approximation honest while still allowing a more semantic lane to be built today.

## Adapter Contract

When semantic CARA runs in `assist` mode, Balloon sends a JSON packet to the adapter over `stdin`.

The adapter should write a JSON object to `stdout`.

Expected output shape:

```json
{
  "notes": [
    "Preserve the stored architecture boundary explicitly.",
    "Carry forward the verification obligation instead of deferring it."
  ],
  "suggestedAdditions": [
    "type safety",
    "tests for the affected change"
  ],
  "rewrittenReply": "I would keep the change bounded to the current architecture and focus directly on the requested improvement.",
  "correctionSummaryAddendum": "Semantic CARA tightened the repaired wording and made the architecture boundary more explicit."
}
```

All fields are optional.

If the adapter fails, Balloon falls back to the deterministic lane.

## Configuration

You can configure semantic CARA through CLI args or environment variables.

Environment variables:

1. `BALLOON_SEMANTIC_CARA_MODE`
2. `BALLOON_SEMANTIC_CARA_ADAPTER`
3. `BALLOON_SEMANTIC_CARA_TIMEOUT_MS`
4. `BALLOON_SEMANTIC_CARA_MAX_NOTES`

If you provide an adapter path without an explicit mode, Balloon infers `assist`.

CLI flags:

1. `--semantic-cara-mode`
2. `--semantic-cara-adapter`
3. `--semantic-cara-timeout-ms`
4. `--semantic-cara-max-notes`

## Example Adapter

See [../examples/semantic_cara_adapter.example.mjs](../examples/semantic_cara_adapter.example.mjs).

For a simple preview request payload, see [../examples/demo_semantic_preview_request.json](../examples/demo_semantic_preview_request.json).

That example is intentionally simple.

It is not meant to be the final semantic adapter.

Its purpose is to show:

1. the packet shape
2. the expected return format
3. how contributors can plug in their own model-backed logic

## Recommended Use

Use the lanes like this:

1. benchmark `baseline`
2. benchmark deterministic Balloon
3. benchmark hybrid Balloon

That is the cleanest way to measure whether semantic CARA is worth its latency and correction tax.
