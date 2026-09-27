# DEVENV-VM-ACCEPTANCE-RECEIPT-REMAINS-NONTERMINAL — VM acceptance receipt remains nonterminal

- **Status:** In progress
- **Section:** External
- **Area:** Standalone VM evidence collection and base qualification.
- **Impact:** The collected scenario receipt can disagree with the successful driver output, preventing reliable acceptance attribution after guest shutdown.
- **Evidence:** Vanilla run `tao-acceptance-1790524937-48051` on `0e3f6a9b` printed scenario 17 as passed, while its collected `acceptance-summary.json` retained that scenario as running. The guest was stopped immediately after the driver exited. Missing flush durability is a hypothesis, not a demonstrated cause.
- **Workaround:** Inspect every collected scenario state and retain the original report; successful driver output alone does not establish a complete collected receipt.
- **Proposed change:** Flush guest writes before shutdown and validate all collected scenario receipts are terminal and passed before qualifying a base. Preserve contradictory or incomplete evidence and fail closed.
- **Dependencies:** Existing guest RPC and stopped-disk collection workflow.
- **Acceptance:** Focused regression rejects a running, absent or failed scenario despite successful driver exit. Fresh vanilla and prepared-Xcode runs collect complete receipts matching their exact run and do not qualify on incomplete evidence.
- **Source:** September 27 repository health pass on `feat/repository-health-2026-09-27`.
