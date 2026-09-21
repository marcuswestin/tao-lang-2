# DEVENV-ONE-TEST-FILE-SPAWNS-FIVE-TYPECHECKS — One test file spawns five typechecks, so its shard cannot be split

- **Status:** Candidate
- **Section:** External
- **Area:** Test performance
- **Impact:** The Expo-host suite shards by whole file, so a file whose cost exceeds every sibling
  combined defines the suite's floor no matter how many shards are planned. `runtime.test.ts` spawns
  a real `tsc` five times; its eight sibling files together are about a second. Adding shards cannot
  help, and the bin-packer is working correctly — it simply has nothing to pack against. The suite is
  the third-longest node in a `verify` lane for this one reason.
- **Evidence:** `packages/apps/expo-host/expo-host-tests/runtime.test.ts` calls
  `typecheckGeneratedApp` at lines 355, 425, 819, 842 and 898, with the helper itself at line 990.
  Measured 2026-09-21 on a quiet machine: node elapsed for `runtime-toolchain#1` was 34.8s against
  61-335ms for shards 2 through 7, from the same `verify` run's `summary.json`. Node elapsed is the
  trustworthy figure here — DEVENV-046's correction withdraws the distortion claim for node
  `elapsedMs`, which is set from the node's own `startedAt`, and limits it to per-test ledger entries
  recorded under `--concurrent`.
- **Workaround:** None. Reducing the shard count does not help, because the cost is inside one file.
- **Proposed change:** Share one typechecked fixture across the five cases that only vary what they
  assert about it, or move the typechecking cases into a file of their own so the packer can isolate
  them and the remaining behaviour cases shard freely. Splitting the file is the smaller change and
  costs nothing in coverage; sharing the fixture is the larger win and risks coupling the cases.
- **Dependencies:** None. This is inside the Expo-host package and is untouched by the CLI
  restructure.
