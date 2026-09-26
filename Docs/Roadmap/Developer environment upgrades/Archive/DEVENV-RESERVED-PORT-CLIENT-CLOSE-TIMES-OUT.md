# DEVENV-RESERVED-PORT-CLIENT-CLOSE-TIMES-OUT — Reserved port client close can time out during broad tests

- **Status:** Resolved
- **Section:** External
- **Area:** Expo port reservation tests
- **Impact:** An unrelated socket lifecycle test consumed nearly two minutes during subprocess repair experiments.
- **Evidence:** On 2026-09-26, `Expo dev-loop port helpers > drops a client that connects to a reserved port, so releasing it does not wait` timed out after 114961ms. The test awaits the TCP client's close event and then reservation release; no subprocess was pending in the CLI trace. Log: `.artifacts/logs/dev-test/2026-09-26T05-45-17-095Z-84189-415cd91f/apps_expo-host_6.log`. Later broad runs passed this test. This does not establish that the subprocess completion defect causes the socket failure.
- **Workaround:** None required after the reservation repair.
- **Proposed change:** Reserve explicit IPv4 and IPv6 wildcard listeners and, on Darwin, both loopback listeners. Release partial reservations on any address collision and retry ephemeral allocation. Share the release promise so concurrent callers wait for every listener to close.
- **Dependencies:** Implemented on `feat/repair-port-journey-timeouts`.
- **Acceptance:** The occupied-address matrix fails against the original implementation for IPv4 wildcard, IPv4 loopback and IPv6 loopback. The repaired matrix also proves partial cleanup and same-port reacquisition; real clients in both families are disconnected. A 2,000-reservation native repetition completed without the previously reproduced client stall. Full-suite acceptance is recorded with the branch landing.
- **Diagnosis:** On 2026-09-26, both Bun and Node reproduced an IPv4 loopback listener coexisting with a wildcard listener on the same port. The client reached the pre-existing listener, while the reservation reported zero accepted connections. The original reservation could even return an explicitly occupied loopback port. This is an address-coverage defect, not a lost close event. Native probes and mutation evidence are under `.artifacts/investigation/port-journey/`; mutation gate `.artifacts/logs/dev-test/2026-09-26T09-03-31-090Z-99386-a08a0bf8/`. This repair covers wildcard and loopback addresses, not exclusive ownership against arbitrary interface-specific listeners.
- **Source:** Subprocess completion investigation on `feat/repair-verification-flakes`.
- **Archived:** 2026-09-26
