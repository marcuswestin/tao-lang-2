# Accessible Tao apps — plan

Status: **MVP name, hint, warning, state, and action baseline implemented in Current**
(2026-09-28); native screen-reader acceptance remains open.

## Goal

Make a Tao app work well with screen readers, keyboards, voice control, switch access, Braille,
magnification, large text, high contrast, and reduced motion before its author writes any
accessibility-specific code. Tao's advantage is the derived interaction outline: views, regions,
collections, items, controls, commands, labels, state, and navigation already have language-level
meaning. Accessibility projects that meaning through maintained platform primitives; it does not
create a second application model.

The default contract follows four rules:

1. Prefer the platform's established accessibility API and native control.
2. Infer semantics from ordinary Tao declarations and require author input only when meaning is
   genuinely absent or ambiguous.
3. Give every modality the same semantic operations; accessibility must not invoke a private path.
4. Keep experimental AI interpretation additive. Deterministic names, roles, state, order, focus,
   actions, captions, and alternatives remain the dependable foundation.

The compatibility baseline is WCAG 2.2 and its mobile guidance, Apple and Android platform
accessibility guidance, React Native's public accessibility API, and ATAG's expectation that an
authoring system helps authors produce accessible output. Near-term research to watch includes the
ARIA 1.3 notification work, WCAG 3, system accessibility readers and Braille workspaces, and
AI-assisted descriptions in screen readers. Those capabilities consume Tao's semantic model; they
do not replace it.

## What already ships

- The compiler derives regions, collections, items, action controls, input controls, labels, and
  provenance into one read-only interaction outline.
- Standard controls publish native names, roles, values, and enabled, selected, checked, and busy
  state. Informative images require a name; decorative images leave traversal.
- Selectable rows expose their derived label and directly invokable commands through native custom
  accessibility actions.
- Action controls derive a name from `Title`, `Label`, or visible text; `Description` provides a
  supplementary hint. Missing or uncertain names receive a warning that suggests a source fix.
  Suitable action controls expose available directly invokable verbs through the catalog.
- Covered navigation and modal surfaces leave traversal; modals support accessibility escape and
  focus restoration.
- Web focus and React Native accessibility-focus requests project Tao attention back to the host.
- Generated hints, region overview, verbs, and the command palette read the same outline.

## Ranked candidates

|  Rank | Candidate                                                   | Why it is valuable by default                                                                                                                                                                                         | High-level implementation plan                                                                                                                                                                                                                                                                                               |
| ----: | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Selectable-row focus intake** — selected                  | Every selectable loop benefits, with no syntax or author work. It closes the current asymmetry where Tao can move platform accessibility focus to a row but a platform row-focus event does not update Tao attention. | Add identity-based targeting to `TR.Interaction`; feed a row's native `onFocus` into it; prove focus changes target and region without activating selection; document the host-event boundary.                                                                                                                               |
|     2 | Accessible semantics by construction — baseline implemented | Names and state are the highest-volume screen-reader dependency. Tao infers them from `Title`, `Label`, visible text, commands, fields marked `(title)`, and row content.                                             | Validate names, hints, state, and actions with native screen readers; contextual progress names remain a later extension.                                                                                                                                                                                                    |
|     3 | Semantic structure and announcements                        | Headings, landmarks, status, validation, and transient feedback let screen-reader users skim and understand change without rereading a screen.                                                                        | Adopt semantic heading/section and polite/assertive status contracts independent of styling; project them to web and native roles/live regions; announce keyed toasts and validation once, with deduplication; add Tao steps for observable status text rather than implementation roles.                                    |
|     4 | Accessibility-aware design defaults                         | Large text, contrast, target size, high contrast, and reduced motion help low-vision, motor, vestibular, and cognitive access automatically.                                                                          | Add host accessibility preferences beside `Scheme`; make built-in components scale and reflow; establish mandatory contrast/target/name checks, then let authored design `rules` tighten them; add 200% text and reduced-motion scenarios when the design/scenario program lands.                                            |
|     5 | Alternative representations and complex operations          | Tao can use structured source data to offer more than a traditional overlay: maps as synchronized lists, charts as tables/summaries, and drag/reorder as named move actions.                                          | Define one semantic operation per capability; generate list/table/summary alternatives; expose move before/after/up/down and adjustable-value actions; test equivalent results across gesture, keyboard, voice/switch, and assistive actions. Sequence this after the corresponding map, chart, and ordered-move primitives. |

Candidate 4's contrast, target, and name checks wait for design `rules { }`, which is deferred past
MVP (2026-09-23); when they land they are warnings rather than mandatory errors. The static analysis
they need, and the preferred automatic tap minimum, are recorded in the design system plan's
"Design rules — deferred past MVP".

Custom accessibility actions on outline-backed action controls merge with existing native actions;
text inputs keep their platform editing actions. A later semantic reader can expose the outline by
region, entity, heading, or command as a calm, linear Tao-native mode; it should be built after
names and structure are trustworthy.

## Selected slice — selectable-row focus intake

This slice is first because it is a current correctness gap, has universal default coverage over
selectable collections, exercises the existing semantic architecture, and does not pre-empt the
open LANG-023 metadata/localization design. It is more urgent than adding a new semantic surface:
an assistive technology using a platform focus event should reach the same target and region state
as a pointer or keyboard.

### Contract

- Focusing a selectable row through a React Native/web host focus event targets that exact outline
  item and focuses its containing Tao region.
- Focus is observational: it does not run `on select`, invoke a command, or mutate app state.
- Pressing the focused row still runs selection exactly once through the existing semantic
  activation path.
- The guarantee applies where the host emits `onFocus`. Tao does not claim to observe a
  screen-reader virtual cursor movement that React Native does not surface.

### Implementation and proof

- `TR.Interaction.TargetIdentity(identity)` exposes the reducer's guarded identity targeting beside
  identity-based activation.
- A selectable row's press surface sends its host `onFocus` event through that operation.
- The compiled-app test focuses both rows and observes their exact public attention identity and
  containing region while the selection count remains zero, then presses the second row and
  observes one selection. Existing custom-action behavior remains in the same journey.
- Removing the `onFocus` bridge makes the focused test fail with the prior `Seed` target; restoring
  it makes the test pass. The focused runtime/toolchain suites and full `./agent verify` are green.

## Decision boundaries

- For the MVP baseline, a control's name comes from `Title`, `Label`, or its visible text;
  `Description` adds a hint and never substitutes for a name. An empty or statically uncertain
  name produces a warning with a suggested source fix, not a compile error. Suitable action
  controls expose their available verbs as custom accessibility actions; text inputs keep their
  platform editing actions.
- Decide whether Tao needs explicit accessibility syntax in a separate discussion **before MVP
  launch**. This baseline adds ordinary descriptive control content, not a new accessibility clause.
- Headings, status and validation announcements, accessibility-aware design defaults, and
  alternative representations remain post-MVP work.
- Do not infer headings from visual bundle names such as `sectionTitle`; styling is not semantics.
- Do not add a general author-written `Role` escape hatch while standard components and wiring can
  derive a stronger contract.
- Keep accessibility and localization compatible but do not make the name/focus baseline wait for
  a complete localization system.
- Do not claim VoiceOver or TalkBack parity until Tao has a tracked native build and real-device
  validation path. Deterministic React Native adapter tests prove the contract below that boundary.
- Reconcile the Revolution role-selector examples before adopting test syntax: current Tao tests
  intentionally assert user-visible labels and outcomes rather than platform implementation roles.

## Research references

- <https://www.w3.org/TR/WCAG22/>
- <https://www.w3.org/TR/wcag2mobile-22/>
- <https://www.w3.org/WAI/standards-guidelines/atag/glance/>
- <https://www.w3.org/TR/wai-aria-1.3/>
- <https://www.w3.org/TR/wcag-3.0/>
- <https://developer.apple.com/design/human-interface-guidelines/accessibility>
- <https://developer.android.com/guide/topics/ui/accessibility/principles>
- <https://reactnative.dev/docs/accessibility>
- <https://reactnative.dev/docs/accessibilityinfo>
- <https://www.apple.com/newsroom/2025/05/apple-unveils-powerful-accessibility-features-coming-later-this-year/>
- <https://blog.google/company-news/outreach-and-initiatives/accessibility/android-gemini-ai-gaad-2025/>
