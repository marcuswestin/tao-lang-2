# First-hour tutorial engineering replay

Source candidate: `8d6e3ac40`, 2026-10-06; initial journey/layout repair `eb1c7f95a`.

## Repeat the journeys

Run from the checkout root:

```sh
./dev test-file packages/cli/tao-cli/cli-tests/tutorials.test.ts
./dev test-host browser --app reading-list
```

The source suite replays the documented project marker/file setup and checks the first snippet
through the CLI, assembles every tutorial step, checks canonical syntax and validation, and runs
the final Tao behavior journey. It then edits the title through the form, asserts the edited
navigation/list title, makes a deliberately wrong count assertion, restores it, introduces a
syntax error, and restores valid source. Every case uses a disposable project and isolated store.

The browser command extracts the complete program directly from the tutorial Markdown, compiles
and exports the production runtime, serves it on an owned port, and runs three headless journeys.
It proves title/author edits, actual local-storage writes, reload persistence, finish/remove,
destination switching, unavailable storage with Retry preserving the saved row, phone and desktop
layout, an eight-row phone list, and the documented light palette under a dark system scheme.
Uncaught page exceptions fail the journeys. The runner stops its browser and server on completion.

## Repairs and inspected evidence

1. Public tutorial commands create a separate project with its required `.tao` marker and use
   `./tao run`, replacing the removed `dev` command. The automated replay derives its marker and
   file path from those instructions and checks the first snippet through the actual CLI. The text
   explains failing tests, persistence, Retry, and the destructive corrupt-data reset separately.
2. Portable selection tabs have separate 44-pixel targets, spacing, and a blue selected underline.
   Native navigation remains covered by its separate acceptance route.
3. Tutorial cards and pane columns hug their contents; pane widths fill the available column.
   Short phone sections remain adjacent and desktop sections align side by side.
4. The tutorial explicitly owns its light paper palette in either system scheme; this replay does
   not introduce a new dark theme. QA capture now creates a fresh staged project marker without
   copying the original project's machine state; its focused regression checks source preservation.

The final browser replay `c755027f-17ed-4223-82d9-2bb7e9f352b7` passed all three tests.
[The command receipt](browser/browser.json), [run/build provenance](browser/run.json), and
[test output](browser/browser.log) are retained. The restored negative-control replay
`cf787650-22b9-4996-bb3a-6cda6dfa4ef0` also passed all three tests. The unchanged layout passed in replay
`9e12071c-df1f-44a4-bf7e-acd17182a0a7` before the deliberate mutations.

All seven final screenshots were inspected:

| View                                                        | Observation                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Phone light](browser/tutorial-phone-light.png)             | Distinct Library/About destinations, selected underline, compact empty sections. |
| [Desktop](browser/tutorial-desktop.png)                     | Reading/Finished headings align in filled columns; no zoom overlay.              |
| [Phone dark](browser/tutorial-phone-dark.png)               | Same intentional paper palette, readable controls and labels.                    |
| [Long phone list](browser/tutorial-phone-long-list.png)     | Eight compact rows scroll; Finished follows the last row.                        |
| [Persisted edits](browser/tutorial-persisted-phone.png)     | Edited title/author survive a page reload; the narrow row truncates long labels. |
| [Storage failure](browser/tutorial-storage-failure.png)     | Load error exposes Retry and retains the data.                                   |
| [Recovered storage](browser/tutorial-storage-recovered.png) | Saved book returns after Retry and another reload.                               |

[Negative-control output](mutation-browser.log.txt) retains the two expected failures: replacing
the browser's storage writes with a no-op breaks the persisted-title assertion; retaining the read
failure after access restoration breaks the Retry assertion. Those temporary injections were
removed before the final passing replay. They test the browser storage boundary, rather than
proving independent defects in the provider implementation.

## Acceptance boundaries

These are development-source and exported-browser observations. They do not accept the installed
public CLI, an outside uncoached reader, native navigation, a physical device, or a public release.
`QA-TUTORIAL-ENTRY` remains awaiting its required human recheck.

The first separate Studio capture reached the scenario manifest but every cell timed out before
ready. [Its snapshot](capture/source-snapshot.json) is **partial** and
[review manifest](capture/review.json) marks all three cells failed. Capture had waited on inactive
cells in a fresh staged project. The repair uses each cell's existing activation control, leaves
active cells alone, and retries an initially disabled control under the existing timeout. The
regression executes the actual browser expressions and checks both inactive and already-active cases.

The repaired capture completed all three cells in 46.6 seconds with no failed cell. The
[complete source snapshot](capture-complete/source-snapshot.json) and
[review manifest](capture-complete/review.json) retain cell keys and image hashes. Inspected
[phone](capture-complete/screenshots/qa-views-phone-80026e1d3386.png),
[desktop](capture-complete/screenshots/qa-views-desktop-15f53c859d19.png), and
[dark-scheme phone](capture-complete/screenshots/qa-views-dark-d53ce3e07882.png): distinct navigation,
compact lists, adaptive columns, intentional light colors, and no transient review overlay.

To repeat this isolated capture, run from the checkout root, choosing unused output directories:

```sh
mkdir -p .artifacts/qa/tutorial-review/.tao
cp Docs/QA/evidence/tutorial-first-hour/capture-source.tao.txt .artifacts/qa/tutorial-review/ReadingList.tao
./dev qa-capture .artifacts/qa/tutorial-review --app ReadingList --output .artifacts/qa/tutorial-review-capture
```

[Broader verification](verification.json) and [the final-candidate repeat](verification-final.json)
stopped at five unrelated process-session tests expecting v2 ownership records but receiving safe v1
fallback records; 555 and 562 checks were skipped. The unchanged
focused test reproduced the failure. This is recorded under the existing developer-environment
process-inspection finding. The initial QA run's automatic tutorial check hit its 120-second idle
timeout under contention; that failed receipt remains immutable. The final QA run repeated it and
[passed](qa-source-final.json); [its output](qa-source-final.log.txt) is retained. No merge-proof
claim follows from these runs.
