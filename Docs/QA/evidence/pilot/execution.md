# Executed pilot evidence

Source baseline: d5bdeaefd037. Repository development profile; not public artifact acceptance.

## HNReaderStub browser journey

Command: `./agent unsandboxed test-host browser --app hnreader`
Run: `.artifacts/host-testing/9f545cfb-d3c6-431f-8a6d-0653a2f9876d/`

```
✓ opens a story, returns through browser-visible navigation, and keeps reading history after reload
✓ executes the authored HNReader reading-history journey through browser-visible input and reload
2 passed (16.4s)
```

Scope: deterministic feed, browser-visible controls and browser reload. No live news, CloudKit,
physical-device, signed artifact or marketplace claim.

## Tutorial source and behavior

Command: `./agent test-file packages/cli/tao-cli/cli-tests/tutorials.test.ts`
Run: `.artifacts/logs/dev-test/2026-09-26T22-46-24-164Z-88186-eac61f72/`

```
cli/tao-cli: passed; tests 4; pass 4; fail 0
```

The suite assembles all tutorial steps, checks canonical source and validation, runs the final
behavior journey, and checks the dated walkthrough's references. It does not prove teachability,
visual quality or a released binary.

## Screenshot provenance

`captures.json` preserves dimensions, requested/resolved scheme, screenshot digests and outcomes.
`ReadingList.tao.txt` is the extracted final tutorial program with appended QA-only fixture and
phone/desktop/dark scenarios, formatted only in the disposable project. Product sources were not
changed. Screenshot files are copied byte-for-byte from the review bundle.

The source/workflow implementation was being developed concurrently; these pilot records do not
certify the final committed toolchain or any public release profile. Recheck when freezing a candidate.

## Editor source integration

Command: `./agent test-file packages/ides/ide-extension/ide-extension-tests/ide-extension.test.ts`
Run: `.artifacts/logs/dev-test/2026-09-26T22-51-04-792Z-42080-c28fce38/`

```
ides/ide-extension: passed; tests 15; pass 15; fail 0
```

Scope: programmatic workspace separation, manifest/configuration, generated-output rollback,
syntax grammar merging, diagnostics/import resolution, formatting, and source/code actions.
This does not prove GUI activation, an installed VSIX, either marketplace, or a packaged public
release profile. Those acceptance cells remain not run.
