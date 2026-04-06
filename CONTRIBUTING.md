# Contributing To Balloon MCP

Thank you for considering a contribution.

Balloon MCP is trying to improve context fidelity in long AI sessions. The best contributions are the ones that make the system more truthful, more legible, and more useful without drifting away from that core identity.

## Before You Start

Please read:

1. [README.md](./README.md)
2. [docs/ROADMAP.md](./docs/ROADMAP.md)
3. [docs/INSTALL.md](./docs/INSTALL.md)
4. [docs/CONTRIBUTOR_STARTERS.md](./docs/CONTRIBUTOR_STARTERS.md)

## Issue Workflow

The recommended workflow is:

1. use GitHub Issues as the execution queue
2. keep larger vision and architecture discussion in docs and roadmap files
3. make each real work block traceable to an issue
4. link each pull request back to the issue it closes or advances

This helps keep scope honest and makes contribution entry much easier for new people.

## Recommended Labels

We recommend a small, legible label set:

1. `bug`
2. `benchmark`
3. `docs`
4. `host-ux`
5. `enhancement`
6. `good first issue`
7. `help wanted`
8. `release`

## Good Contribution Areas

Helpful contributions include:

1. better prompt quality
2. clearer demo and install docs
3. better gap classification or retrieval precision
4. safer and clearer MCP host behavior
5. stronger evaluation and verification
6. bounded repo-aware grounding that clearly serves CARA

Good first contributions often include:

1. docs clarity fixes
2. host compatibility notes from real reruns
3. benchmark report cleanup
4. starter-suite scoring and reproduction improvements
5. safer prompt/tool wording improvements

Less helpful contributions are the ones that make Balloon drift into a generic code agent, generic repo auditor, or vague memory system without keeping the CARA/gap/trickle focus.

## Pull Requests

For pull requests:

1. keep changes scoped
2. explain the user-facing effect
3. explain how the change aligns with Balloon's context-fidelity goal
4. avoid overclaiming in docs or comments
5. include verification notes when relevant
6. link the issue that the pull request closes or advances

If a change widens scope, please explain whether it affects:

1. CARA
2. gap identification
3. targeted retrieval
4. proxy trickle
5. public claim boundaries

## Style And Product Expectations

We value:

1. honest scope
2. visible artifacts over hidden magic
3. bounded corrections over broad overrides
4. reproducible demos over hype

## Security And Sensitive Reports

Please do not open a public issue for a security-sensitive vulnerability. See [SECURITY.md](./SECURITY.md).

## Licensing

The project is released under the MIT License.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this project is provided under the MIT License, without additional terms or conditions. In practical terms, inbound contributions use the same MIT terms that the project distributes outbound.
