# Tao Reimplement Roadmap

Track the clean, stepwise Tao reimplementation. Keep this current as each slice is ready for Ro review and commit.

## Ro's STACK

- [ ] Compiler: Create langium codegen wrapper and start using that
- [ ] INSTRUCT: How to separate parts of the language into different files
  - Codegen, validator, formatting, etc
- [ ] Implement proper inject statement
- [ ] Add runtime TR object, create instructions for minimizing generated code and maximizing functionality existing in the runtime
- [ ] Add runtime stdlib, along with `inject file ./path/to/file.ts`
- [ ] Remove hard-coded kitchen sink stuff
  - [ ] Add generic compiled-add test declarations
    - Should this map to test writing for the actual apps?
- [ ] Add validator and type system

- Add followups for later:
  - Add `import ./path/to/DateUtils.ts as DateUtils`
  - Think through how to do app testing, and how to use that for our repo test apps tests

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
  - [x] Generate Langium parser artifacts under `parser-src/_gen_tao-parser`
  - [x] Export `AST`, `Langium`, and the `Parser` object API
  - [x] Support current syntax: `app`, `ui`, text parameters, `render`, view calls, optional empty blocks, and `inject` TS fences
  - [x] Keep `Render` named `Render`
  - [x] Parse general statements and leave context-specific placement checks for the validator
  - [x] Cover parser grammar mechanics without adding validator behavior
  - [x] Add parser tests for Kitchen Sink and source strings
  - [ ] Ro review
  - [ ] Commit: `Add minimal Tao parser`
- [ ] Compiler
  - [x] Write compiler tests before implementation
  - [x] Add `packages/compiler` as `@tao/compiler`
  - [x] Export compiler entrypoints
  - [x] Emit Expo-compatible TSX for the supported AST only
  - [x] Generate a default exported React component
  - [x] Include `Hello, World!`, `MainView`, `Text`, and `_ViewProps.Value` in generated output
  - [x] Fix Kitchen Sink `Text` injection to return `<RN.Text>{text.jsValue}</RN.Text>`
  - [ ] Ro review
  - [ ] Commit: `Add minimal Tao compiler`
- [ ] Runtime
  - [x] Write runtime e2e test before implementation
  - [x] Add `packages/runtime` as `@tao/runtime`
  - [x] Add minimal Expo web host files
  - [x] Compile app into ignored `packages/runtime/_gen_tao-app`
  - [x] Add `just run` to compile Kitchen Sink and start Expo web
  - [x] E2E render verifies `Hello, World!`
  - [ ] Verify `./agent just run` starts Expo web
  - [ ] Ro review
  - [ ] Commit: `Add minimal Expo web runtime`

## Dev Environment

- [ ] ...
