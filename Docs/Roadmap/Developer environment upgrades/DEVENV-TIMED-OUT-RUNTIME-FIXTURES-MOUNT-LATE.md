# DEVENV-TIMED-OUT-RUNTIME-FIXTURES-MOUNT-LATE — Timed-out runtime fixture preparation can mount in a later test

- **Status:** In progress
- **Section:** External
- **Area:** Compiled runtime test lifecycle
- **Impact:** A timed-out test can finish preparing its app after cleanup and publish a stale render during the next test, causing misleading secondary failures.
- **Evidence:** Native ARM Ubuntu run `20260927T170622Z-75373` on `ee79a599` timed out the first Haptics and Clipboard binding tests. The following Clipboard image test received the prior text fixture's `Read`, `ReadHtml`, `before` and `saved:true,has:true` tree. Test cleanup unmounted existing roots but did not invalidate in-flight source generation or compilation. The same runtime suite passed during the subsequent verification in the same guest; this establishes schedule/cache sensitivity, not the source of the initial delay. Copied initial log: `.artifacts/contributor-linux/20260927T171035Z-79864/` under the cold guest's `dev-test/2026-09-27T17-07-43-628Z-2229-58c43169/runtime-jest.log`.
- **Workaround:** An isolated rerun can remove the secondary symptom; it does not repair stale publication.
- **Proposed change:** Capture a test lifetime before asynchronous source preparation, invalidate it before cleanup, and prevent stale compilation, mounting and assertion callbacks from crossing that boundary. Measure the cold native-binding preparation separately before changing its timeout or performance behavior.
- **Dependencies:** None. The existing runtime-journey observation timeout has a different test and no established common cause.
- **Acceptance:** Controlled delayed source and compilation regressions must prevent stale renders and callbacks without relying on a wall-clock timeout, retain the next test's render, and pass fresh contributor acceptance with explicit cold/cache boundaries.
- **Source:** September 27 repository health review, finding I5.

## Implemented repair awaiting contributor acceptance

The runtime fixture helper now captures a per-test abort signal before asynchronous source preparation. Teardown invalidates that signal before render cleanup. Compilation checks the captured signal before mounting, and a mounted screen unregisters its abort listener when disposed. The listener disposes only that owned render. Native-binding fixtures pass source factories so their TypeScript preparation is inside the captured lifetime. This suppresses late publication; it does not forcibly cancel shared compiler subprocess work or arbitrary assertion promises already executing.

Focused controls cover delayed source, delayed compilation, abort after mount with another owner present, and abort during mount acquisition. Removing early lifetime capture admitted the stale callback; removing the pre-render guard mounted two apps instead of one; removing the abort listener left the old screen mounted. All mutations were restored and the final lifecycle, Haptics and Clipboard files passed. Fresh Linux acceptance remains pending before closure.

## Cold preparation diagnosis

Two focused Haptics controls used separate empty, task-owned transform caches. The original configuration spent 14,100 ms requiring TypeScript's 9 MB, already-CommonJS compiler bundle; native API generation took 1,263 ms, compile/mount 4,558 ms and all action calls 26 ms. Excluding only `/node_modules/typescript/lib/typescript.js` from transformation reduced the first require to 112 ms, with generation 610 ms, compile/mount 3,587 ms and actions 31 ms. Active suite time was 27.5 versus 11.8 seconds. The baseline's 377-second admission wait is excluded from those timings. These are measured local controls, not Linux timings or a general speed guarantee.

The exclusion matches ordinary and nested package layouts, leaves React Native/Expo transforms intact, and changes neither dependency versions nor test deadlines. Raw control logs are `.artifacts/logs/dev-test-mutation/2026-09-27T17-16-44-134Z-85026-815a1a11/runtime-jest.log` and `.artifacts/logs/dev-test-mutation/2026-09-27T17-25-10-601Z-94039-eee268f5/runtime-jest.log`. Temporary phase instrumentation was restored. This removes a demonstrated cold cost; lifetime fencing remains necessary even when preparation is fast.
