# Tao Reimplement Roadmap

Track the clean, stepwise Tao reimplementation. Keep this current as each slice is ready for Ro review and commit.

## Language

- Spec
  - Copy/fill spec
- Apps
  - Kitchen Sink
    - Target
    - Current

## Minimal Port: Kitchen Sink Current

- [ ] Parser
  - [x] Add `Apps/Kitchen Sink/Kitchen Sink.tao`
  - [x] Add `packages/parser` as `@tao/parser`
  - [x] Split grammar under `packages/parser/parser-grammar`
  - [x] Generate Langium parser artifacts under `parser-src/_gen-tao-parser`
  - [x] Export `parseTaoFile`, `parseTaoSource`, `parser`, and `parserASTExport`
  - [x] Support current syntax: `app`, `ui`, text parameters, `render`, view calls, optional empty blocks, and `inject` TS fences
  - [x] Keep `Render` named `Render`
  - [x] Use context-specific statements: top-level declarations, app-root `ui`, and view-block `render`
  - [x] Skip validator and grammar mechanics tests
  - [x] Add parser tests for Kitchen Sink and source strings
  - [ ] Ro review
  - [ ] Commit: `Add minimal Tao parser`
- [ ] Compiler
  - [ ] Write compiler tests before implementation
  - [ ] Add `packages/compiler` as `@tao/compiler`
  - [ ] Export `compileTaoSource` and `compileTaoFile`
  - [ ] Emit Expo-compatible TSX for the supported AST only
  - [ ] Generate a default exported React component
  - [ ] Include `Hello, World!`, `MainView`, `Text`, and `_ViewProps.Value` in generated output
  - [ ] Fix Kitchen Sink `Text` injection to return `<RN.Text>{text.jsValue}</RN.Text>`
  - [ ] Ro review
  - [ ] Commit: `Add minimal Tao compiler`
- [ ] Runtime
  - [ ] Write runtime e2e test before implementation
  - [ ] Add `packages/runtime` as `@tao/runtime`
  - [ ] Add minimal Expo web host files
  - [ ] Generate app into ignored `packages/runtime/_gen/tao-app`
  - [ ] Add `just dev` to compile Kitchen Sink and start Expo web
  - [ ] E2E render verifies `Hello, World!`
  - [ ] Verify `./agent just dev` starts Expo web
  - [ ] Ro review
  - [ ] Commit: `Add minimal Expo web runtime`

## Dev Environment

- [ ] ...
