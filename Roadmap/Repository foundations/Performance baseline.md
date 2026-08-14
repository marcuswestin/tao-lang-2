# Performance baseline - Repository foundations

Measured on macOS 26.5.2 arm64 with Bun 1.3.13 and Node 24.14.1 from the pinned devenv profile.
The fixture was `Apps/WordFlower/1 - Current/WordFlower.tao`: 583 lines and 22,759 bytes. Each row
records one first call followed by 10 sequential steady-state iterations in one process. These are
local comparison numbers, not a CI budget.

The same harness was run from a detached `6cfd88be` worktree and from the implementation branch. Its
one-shot strategy calls the public convenience API repeatedly; its session strategy explicitly owns
and reuses one context. Values are milliseconds.

| Stage    | Strategy | `6cfd88be` cold | `6cfd88be` median / p95 | Branch cold | Branch median / p95 |
| -------- | -------- | --------------: | ----------------------: | ----------: | ------------------: |
| parse    | one-shot |              77 |                 38 / 47 |          69 |             34 / 40 |
| parse    | session  |              35 |                 16 / 20 |          27 |             15 / 18 |
| validate | one-shot |              73 |                 50 / 63 |          69 |             31 / 35 |
| validate | session  |              40 |                 27 / 28 |          44 |             25 / 29 |
| compile  | one-shot |              61 |                 54 / 61 |          56 |             35 / 38 |
| compile  | session  |              55 |                 36 / 39 |          57 |             37 / 43 |
| format   | one-shot |              71 |                 39 / 51 |          68 |             42 / 45 |
| format   | session  |              35 |                 26 / 33 |          42 |             26 / 27 |

Overall wall time was 3.3s at `6cfd88be` and 2.9s on the branch. The intended change is visible at the
public entry points: steady-state median validation fell from 50ms to 31ms and compilation from 54ms
to 35ms because those one-shot APIs now reuse process-shared services. Explicit caller-owned session
results stayed near baseline, as expected.

Run the benchmark with `./agent bench`; pass a different positive iteration count as the final
argument when a larger sample is useful. Benchmarks are intentionally separate from `test` because
their timings do not add correctness coverage.
