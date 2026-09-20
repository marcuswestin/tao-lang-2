# Archive

Frozen records of finished work, kept for history and never deleted or rewritten for style.

- **`Plans/`** — implementation plans, checklists, and tranche briefs whose work landed.
- **`Explorations/`** — design research, spikes, and decision analysis that is no longer live;
  superseded or folded into a canonical document elsewhere.
- **`Reports/`** — audits, retrospectives, and closed-out status records of completed work.

To add a document: once its work has landed or it reads as a closed report, `mv` it here (never
`git mv`) under the subfolder that best matches its kind, keeping its original name. Then fix every
inbound link that pointed at its old path.
