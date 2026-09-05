# Tao create

Status: **first slice shipped 2026-09-04; direction recorded, follow-ups open.** `tao create` is the
first leg of Tao's product loop — write, preview, ship — at the moment a project does not exist yet.
Its executable contract is in `Docs/Spec/Tao Packages.md` under _Creating a Tao Project_; the
starters it writes and their byte-identity rule are owned by `Apps/Starters/README.md`. This page
records why it is built the way it is and what comes next.

## The direction

- **Creation is a conversation, not a template.** A person says what they are making in a sentence.
  A model names the shape — app name, entities, fields, colors, sample rows — and Tao derives the
  code and decides every placement. The model never writes Tao. This is the semantic-agent lesson
  (`Tao Studio AI/Exploration - Semantic agent proof of concept.md`, SAI-D020) applied at birth.
- **Born in the canonical shape.** Every project gets the `Decisions.md` §1 decomposition as far as
  the toolchain runs it: App, Data, Chrome, Design, one folder per feature, Scenarios, tests.
  Access, Rules, and Words join as their tranches land. Design is always written.
- **Born proven.** The result is formatted, validated, and its behavior tests run before the command
  reports success. The starters in `Apps/Starters` are the lowering's exact output for reference
  plans, and `tao test Apps` runs them, so the generator cannot rot silently.
- **No key required.** Lanes are tried in order and the person agrees to the first one used: an
  installed Claude Code or Codex CLI, a listening Ollama, then Apple's on-device model. Free cloud
  tiers all require an account and a key, so they are not a "no key" answer; a keyed cloud lane
  can join later behind the same seam.

## How it is built

- **The plan is the seam.** `creation-plan.ts` owns a typed `CreationPlan`, its JSON schemas, and
  the validation that says exactly why a plan cannot be lowered. `creation-lowering.ts` turns a valid
  plan into files; `creation-pipeline.ts` fills a plan through the `packages/generation` provider
  seam, one whole answer for a wide window and one small question per part for a narrow one, each
  answer validated, re-asked once with the problems named, then replaced by a plain default.
- **Deterministic first.** `creation-brief.ts` reads what the description points at before any model
  runs: web pages become text, images become a palette (through `sips`, so macOS only for now). An
  image palette outranks a model's color choice. Agent CLIs may additionally read the images and
  pages themselves.
- **Providers live in `packages/generation`.** `OllamaGenerationProvider` uses Ollama's schema-
  constrained chat format and stays in the portable entry. `AgentCliGenerationProvider` drives
  `claude -p --json-schema` or `codex exec --output-schema` and sits behind the `./agent-cli`
  subpath because it spawns processes. Apple reuses the supervised helper service.
- **Consent and honesty.** Interactive runs ask before a lane is used, suggest the id and confirm it
  because the id is immutable and becomes the bundle identifier, and show the plan before writing.
  Every fallback to a plain default is said out loud in the output.

## Open follow-ups

- Image understanding beyond color: Apple Vision OCR in the helper (labels from a screenshot or a
  sketch) and a vision-capable Ollama model captioning screens into the brief.
- A keyed cloud lane through the AI SDK, behind the same provider seam and the same consent rule.
- Richer plans as the language grows: relations between entities, editable number and time fields,
  commands beyond add and save, and the Access, Rules, and Words files once their tranches land.
- `tao create` outside a repository checkout: the Apple lane compiles its Swift helper from source,
  so a shipped CLI needs a prebuilt, signed helper.
- Studio's "New project" and the companion app's "Fork into my Studio" over the same plan and
  lowering, so creation has one implementation wherever it starts.
- Landing in the loop: an `--open` that hands the new project to `tao dev` or Studio, and the
  companion QR once that app exists.
