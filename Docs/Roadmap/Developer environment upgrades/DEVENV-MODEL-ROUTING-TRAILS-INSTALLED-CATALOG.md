# DEVENV-MODEL-ROUTING-TRAILS-INSTALLED-CATALOG — Model routing trails the installed catalog

- **Status:** Candidate
- **Section:** External
- **Area:** Agent delegation, model routing
- **Impact:** The standard and deep harness tiers still select a model superseded in the installed
  catalog. Delegation does not automatically follow the newer catalog entry.
- **Evidence:** `./agent model-audit` on 2026-10-04 reported both configured tiers as superseded.
  The command passed; this is a routing warning, not a failed availability check.
- **Workaround:** Retain the current routing until the Developer chooses a change.
- **Proposed change:** Review the installed catalog and the tier routing in
  `agents/skills/delegation/references/model-routing.md`, then update the approved configuration
  and confirm the observed models for standard and deep tasks.
- **Dependencies:** A routing change needs the Developer's approval; the current audit does not
  authorize a routing-table change.
- **Acceptance:** After an approved routing update, `./agent model-audit` no longer reports these
  tiers as superseded, and named standard and deep tasks report their expected observed models.
- **Source:** Studio preview activation follow-up, 2026-10-04.
