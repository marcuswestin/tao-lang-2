# Performance baseline - Repository foundations

Measured on macOS 26.5.2 arm64 with Bun 1.3.13 and Node 24.14.1 from the pinned devenv profile.
The fixture was `Apps/WordFlower/1 - Current/WordFlower.tao`: 583 lines and 22,759 bytes. Each row
records one first call followed by 10 sequential steady-state iterations in one process. These are
local comparison numbers, not a CI budget.

The identical harness was run from a temporary worktree rooted at `6cfd88be` and from the finalized
implementation branch. For parse, validate, and compile, the one-shot strategy calls the static
Workspace file API while the session strategy explicitly opens and reuses a caller-owned Workspace.
Formatting compares the corresponding one-shot and caller-owned Formatter file APIs. Each measured
stage owns a separate Workspace so one stage cannot warm another. Values are milliseconds.

| Stage    | Strategy | `6cfd88be` cold | `6cfd88be` median / p95 | Branch cold | Branch median / p95 |
| -------- | -------- | --------------: | ----------------------: | ----------: | ------------------: |
| parse    | one-shot |              99 |                 51 / 61 |         101 |             49 / 58 |
| parse    | session  |              45 |                 25 / 30 |          47 |             24 / 26 |
| validate | one-shot |              69 |                 53 / 55 |          71 |             59 / 62 |
| validate | session  |              60 |                 27 / 29 |          58 |             29 / 32 |
| compile  | one-shot |              70 |                 63 / 66 |          71 |             65 / 76 |
| compile  | session  |              67 |                 34 / 36 |          70 |             39 / 43 |
| format   | one-shot |              61 |                 44 / 48 |          72 |             44 / 48 |
| format   | session  |              43 |                 24 / 30 |          51 |             28 / 32 |

Overall wall time was 3.7s at `6cfd88be` and 3.9s on the branch. Results stayed in the same range: the
branch does not claim a production-path speedup from repository foundations. Caller-owned sessions
remain the faster repeated-call strategy, while standalone Validator and Compiler conveniences stay
fresh and free of hidden process-global state. This local file-workflow baseline is not an LSP
response-latency measurement.

Run the benchmark with `./agent bench`; pass a different positive iteration count as the final
argument when a larger sample is useful. Measurements and their tool checks stay outside `test`.
The four fast tool-correctness checks run through the private benchmark-check flow used by `bench`,
`check`, and `verify`.
