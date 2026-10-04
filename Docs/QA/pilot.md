# Initial QA pilot

Baseline: `d5bdeaefd037` (2026-09-26). This report records inspected source and executed
checks; it is not acceptance of an installed public release. Product defects are reported,
not repaired by this pass. Full run results and coverage are recorded in the QA register.

## First findings

### QA-INSTALL-PLACEHOLDER — the public first step is not runnable

- Dimension: text and newcomer functionality. Phase: 1. Severity: blocking before publication.
- Source: `README.md:50-61` at the baseline revision.
- Evidence: the Install section says the standalone command is on its way and shows
  `git clone <repository> tao && cd tao`.
- Expected: a newcomer can follow the actual published, signed CLI installation route.
- Impact: the front door cannot currently deliver the proposed phase-1 first success.
- Disposition: open; links to the existing standalone CLI publication work (A2/A3).
- Recheck: follow the final public instructions on a clean supported Mac, then create/run an app.

### QA-TUTORIAL-ENTRY — the tutorial omits the execution instructions

- Dimension: text and newcomer functionality. Phase: 1. Severity: major.
- Source: `Docs/Tutorials/Your First Tao App.md:10-31` and the complete baseline document.
- Evidence: it promises every snippet is copy-and-paste and starts directly with a Tao block;
  it does not specify a filename, project setup, or a `tao dev` / `tao test` invocation.
- Expected: a reader knows the starting prerequisites, where to put the source, and how to see
  and test the result before proceeding through the editing steps.
- Impact: runnable snippets alone do not establish that a new user can complete the tutorial.
- Disposition: open; related release QA story DOC1 and the A5 tutorial work.
- Recheck: an uncoached reader reaches the first screen and runs the final journey using the text.

### QA-README-AVAILABILITY — the front door mixes future and initial release surfaces

- Dimension: text. Phase: 1. Severity: major.
- Source: `README.md:47-48,66-73` at the baseline revision.
- Evidence: the platform statement names iOS, Android and web; the command table presents
  simulator, Android, desktop and TestFlight without phase availability.
- Expected: the phase-1 entry point clearly distinguishes supported web authoring from later
  releases and repository-development capabilities.
- Impact: readers can choose a path the initial public artifact does not support.
- Disposition: open; related WEB3/DOC4 and the staged release scope decision.

## Execution notes

- The first HNReader host journey and screenshot attempts stopped before rendering because
  the fresh checkout lacked the generated parser module. `./agent parser-gen` recovered setup.
  No functional or visual pass was inferred from those attempts. This is existing setup risk,
  related to DEVENV-048 (fresh parser setup) and DEVENV-090 (runtime diagnostics); it is not a demonstrated HNReader product defect.
- HNReaderStub is a deterministic QA-workflow subject. It does not prove a live news service,
  CloudKit, the public reading-list showcase, or physical-device behavior.

## Review rubric

Functional, visual and text outcomes are independent. Capture success, passing source tests,
and unchanged screenshots do not establish attractive presentation or newcomer comprehension.
Visual findings require inspecting the captured image. Editorial observations include a concrete
passage, reader impact and recheck; taste-dependent judgments are labelled as such.

## Executed results

The [execution receipt](evidence/pilot/execution.md) records the HNReaderStub browser journey and
tutorial replay. Both completed their stated functional checks. Their scope is development-source
evidence; installation, human comprehension and release-profile acceptance remain unproved.

The [capture receipt](evidence/pilot/captures.json) records three tutorial views and four Notebook
cells. Notebook's tablet-dark cell did not reach a capturable state; its three other cells were
captured. A command completing successfully did **not** make all four cells pass.

### QA-TUTORIAL-NAVIGATION — navigation choices read as one label

- Dimension: visual. Phase: 1. Severity: major. Disposition: open.
- Evidence: [phone](evidence/pilot/reading-list-phone.png) and
  [desktop](evidence/pilot/reading-list-desktop.png); top-left `LibraryAbout` has no visible gap,
  selected treatment or button affordance.
- Expected: a reader can distinguish the two destinations and the active choice.
- Recheck: inspect and operate both tabs at phone and desktop widths. This is an observation of
  the web-rendered tutorial; it makes no claim about native tabs.

### QA-TUTORIAL-VERTICAL-SPACE — phone sections are separated by a large empty area

- Dimension: visual polish. Phase: 1. Severity: minor. Disposition: open; design judgment.
- Evidence: [phone](evidence/pilot/reading-list-phone.png), between the single Reading row and
  the Finished heading.
- Impact: related lists feel disconnected and use most of a small display for empty space.
- Recheck: judge short and long lists on a phone; preserve useful adaptive behavior on desktop.

### QA-TUTORIAL-DARK-PALETTE — dark scenario retains the light presentation

- Dimension: visual polish. Phase: 1. Severity: minor. Disposition: open; design judgment.
- Evidence: the phone-light and phone-dark image digests in the capture receipt are identical.
  Both captures display a light background. The scenario records requested/resolved dark mode.
- Expected decision: explicitly support an intentional light-only showcase or provide an accepted
  dark presentation. The tutorial does not currently promise a dark theme, so this is not a
  demonstrated violation of its written behavior.

### QA-CAPTURE-OVERLAY — desktop evidence contains a transient zoom indicator

- Dimension: visual evidence quality. Phase: 1. Severity: minor. Disposition: open.
- Evidence: [desktop](evidence/pilot/reading-list-desktop.png), `100%` bubble near the bottom.
- Impact: tooling chrome is mixed into the app evidence. Do not attribute this overlay to the
  published app until reproduced outside review tooling.
- Recheck: capture a settled app view with review overlays absent.

### QA-NOTEBOOK-DARK-CAPTURE — one starter scenario has no usable image

- Dimension: visual coverage. Phase: 1. Severity: major. Disposition: open; blocked assessment.
- Evidence: Notebook `devices/tabletDark` in the capture receipt has a timeout outcome.
- Impact: dark tablet appearance is unreviewed, even though the capture command exited zero.
- Recheck: reproduce that exact scenario and inspect its image. Do not classify the underlying
  cause as an app defect from the timeout alone.

Notebook's [phone screen](evidence/pilot/notebook-phone.png) has legible labels, separated cards,
consistent spacing and clear Open controls in the captured initial state. This is a scoped visual
pass for that image, not acceptance of editing, focus, keyboard, scrolling or every scenario.
This capture used the repository-development starter. The newly projected phase-1 generated starter
requires its own visual review; the development image does not certify its public-profile layout.

### QA-HNREADER-CAPTURE — the wrapping state remains unreviewed

- Dimension: visual coverage. Phase: 2. Severity: major. Disposition: open; blocked assessment.
- Evidence: HNReader `rows/wrapping` in the capture receipt timed out after the first whole-grid
  capture attempt failed. The retry captured `rows/leading` and two sketch drafts.
- The [leading row](evidence/pilot/hnreader-leading.png) has legible title/metadata and no observed
  clipping in that isolated state. Sketch drafts are not promoted-app acceptance.
- Recheck: reproduce the wrapping scenario, capture it, and assess long-title readability. The
  successful browser journey does not establish this visual state.
