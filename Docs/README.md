# Docs

<!-- Landing workflow smoke test: 2026-09-22. -->

Written material about Tao, in five folders.

- **`MVP Roadmap/`** — what remains before Tao is released to outside developers, split into the
  work agents can execute (`Agent MVP Roadmap.md`) and the judgments only the Developer can make
  (`Developer MVP Roadmap.md`). It points into `Roadmap/` for per-workstream context and duplicates none of
  it. `Plan - Initial release QA.md` organizes the final new-user review of the integrated release.
- **`Spec/`** — the authoritative contract for what the toolchain implements today. If the code and
  a spec page disagree, one of them is a bug. Operational how-to for a product or package (launch,
  ports, doctor, release) lives next to that package — for Studio, `packages/ides/studio/README.md` —
  not under Spec.
- **`Roadmap/`** — where Tao is going: `Tao Revolution/` owns the decided language and the program
  that reaches it, the remaining folders are per-workstream notes. `../Roadmap.md` at the repository
  root is the index of open work and points in here.
- **`Archive/`** — frozen records of finished work, moved out of `Roadmap/` once it lands or reads
  as a closed report. `Archive/README.md` says what belongs in each of its three subfolders.
- **`Tutorials/`** — learning material, written for someone who has not used Tao before.

Language decisions live in `Roadmap/Tao Revolution/Decisions.md`, and they win wherever an older
document disagrees.
