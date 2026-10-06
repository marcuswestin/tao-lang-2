# First-hour tutorial engineering replay

Initial source candidate: `8d6e3ac40`, 2026-10-06; journey/layout repair `eb1c7f95a`.

## Final landing candidate recheck

After integrating main `2e5d4e867` into candidate `1b8a44f0d`, the automatic QA
[source replay](land-candidate/source.json) passed all three cases on the normal isolated retry
in 20.9 seconds; the full source command took 254.7 seconds.
[The command log](land-candidate/source.log.txt), [summary](land-candidate/source-summary.json),
and the separate [initial per-test timeout](land-candidate/source-contention-timeout.log.txt)
and [passing retry](land-candidate/source-retry.log.txt) retain both attempts.
The replay exercises the documented setup, cumulative snippets, title edit, passing and deliberately
failing tests, syntax failure, and restored valid source. It remains development evidence.

Production browser replay `ff5aa509-746f-4248-9fcc-1d22ea8128b0` passed all three journeys:
[command](land-candidate/browser/browser.json), [run](land-candidate/browser/run.json),
[build digests](land-candidate/browser/build.json), [export](land-candidate/browser/web-export.json),
and [output](land-candidate/browser/browser.log). Its source digest matches the current tutorial.
All seven [fresh browser images](land-candidate/browser/) were inspected, including edited data
surviving reload, long-list scrolling, storage failure, and recovery after Retry.

The fresh staged capture completed all three cells in 115.6 seconds:
[complete snapshot](land-candidate/capture/source-snapshot.json),
[manifest](land-candidate/capture/review.json), inspected
[phone](land-candidate/capture/screenshots/qa-views-phone-6c6dc4d8d0a9.png),
[desktop](land-candidate/capture/screenshots/qa-views-desktop-1a11ea511a53.png), and
[dark-scheme phone](land-candidate/capture/screenshots/qa-views-dark-ea74cf496d40.png).
Tabs remain distinct, phone lists compact, desktop columns aligned, and captures free of overlays.

Streaming preparation alone did not repair the automatic replay's watchdog:
[a repeated idle timeout](land-candidate/qa-source-idle-after-streaming.json),
[parent log](land-candidate/qa-source-idle-after-streaming.log.txt), and
[worker log](land-candidate/qa-source-idle-worker.log.txt) retain that failure.
Test workers capture output until completion, so the parent now uses the existing 600-second total
deadline without interpreting worker silence as a hang. The explicit bounded policy preserves that
deadline in diagnostic mode. The successful final replay retained the suite's per-test deadlines
and normal isolated retry. The invocation regression checks this supervision contract and immutable
resume; independent review found no actionable issue. This repair does not establish the cause of
the separate per-test timeout.

Required human release acceptance stays separate. Earlier receipts below remain historical evidence.

## Earlier integrated candidate recheck

After integrating main `4f3b2ca44` into candidate `4bfb13da4`, the fresh
[source replay](integrated/source.json) passed all three tests in 91.5 seconds;
[its log](integrated/source.log.txt) includes the passing and deliberate-failure recovery exercises.
Production browser replay `5ab707f1-98d5-4a81-b84c-fed5758f4828` passed all three journeys:
[command](integrated/browser/browser.json), [run](integrated/browser/run.json),
[build digests](integrated/browser/build.json), [export](integrated/browser/web-export.json), and
[output](integrated/browser/browser.log). Its Markdown digest matches the current tutorial.
All seven [fresh browser images](integrated/browser/) were inspected, including persisted edits,
long-list scrolling, unavailable storage and recovery after Retry.

The fresh staged capture completed all three cells in 99.6 seconds:
[complete snapshot](integrated/capture/source-snapshot.json), [manifest](integrated/capture/review.json),
inspected [phone](integrated/capture/screenshots/qa-views-phone-6156547a7ca5.png),
[desktop](integrated/capture/screenshots/qa-views-desktop-d327f6b6de0f.png), and
[dark-scheme phone](integrated/capture/screenshots/qa-views-dark-2b84c5e37826.png).
Tabs remain distinct, phone lists compact, desktop columns aligned, and captures free of overlays.
The inventory retains this Markdown-authored app beside automatic discovery of apps in `Apps/`,
and validates its exact app, staged project, source file and cell identities.

The [buffered automatic replay](integrated/qa-source-timeout.json) hit its 120-second idle-output
bound. At this earlier candidate, the child front door streamed progress into the captured log
while retaining the same 600-second total and 120-second idle deadlines. The final repair above
supersedes that insufficient watchdog fix. An intermediate invocation put the flag before
the command and was [rejected](integrated/qa-source-flag-rejected.log.txt); it was corrected to
`test-file --verbose` before the passing recheck. An unchanged overlapping direct run also hit the
suite's per-test deadline; [its failure](integrated/source-contention-timeout.log.txt) is retained.
That command's normal isolated retry then passed all three tests, recorded in its
[summary](integrated/source-direct-summary.json) and [output](integrated/source-direct.log.txt).
The repaired automatic recheck passed with five overlapping lanes; this does not establish the
cause of the separate per-test timeout. Capture, preview and QA register regressions passed,
and independent integration review found no actionable defect.

Earlier receipts below remain historical evidence. Required human release acceptance stays separate.

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
[The command receipt](browser/browser.json), [run summary](browser/run.json),
[build provenance](browser/build.json), [production export receipt](browser/web-export.json), and
[test output](browser/browser.log) are retained. The build's source digest matches the current
tutorial Markdown; its compiled-artifact digest identifies the generated app used by this replay.
The restored negative-control replay
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

To repeat this isolated capture, keep the derived project path below and choose an unused capture
output directory:

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
