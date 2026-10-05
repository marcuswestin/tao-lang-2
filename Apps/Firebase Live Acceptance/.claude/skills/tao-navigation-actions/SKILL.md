---
name: tao-navigation-actions
description: >-
  Implement Tao navigation and interactions. Use when configuring navigation, presenting scenes,
  passing values, handling actions or commands, or updating app state and responses.
---

# Tao Navigation and Actions

`StackNav` keeps push history; `SelectionNav` keeps keyed areas mounted and selects one; `SlotNav`
shows one presented value; `SplitNav` lays out keyed panes. A `scene` is presented rather than
composed and may fill host-facing `Title`, `Toolbar`, and `Header`. A plain `view` may also be
presented, but has no scene chrome.

```tao SkillNavigation.tao
use SelectionNav, StackNav from @tao/nav
use Col, FormButton, Text, TextInput from @tao/ui

scene SkillHome() {
   Title "Skill home"
   state Draft = ""
   action OpenDetail() {
      check Draft is not empty
      present SkillDetail(Draft)
   }
   command OpenDetailCommand() {
      Title "Open detail"
      Enabled Draft is not empty
      do OpenDetail()
   }
   Toolbar { OpenDetailCommand }
   render Col() [gap 8] {
      TextInput(Value: Draft, Label: "Message") {
         on submit OpenDetail
      }
      FormButton("Open detail", Disabled: Draft is empty) {
         on press OpenDetail
}  }  }

scene SkillDetail(Message text) {
   Title Message
   render Text(Message)
}

nav SkillStack = StackNav {
   Initial SkillHome
}

nav SkillNavigator = SelectionNav {
   Initial @home,
   Display "automatic",
   @home {
      Label "Home",
      Content SkillStack
}  }
```

## Navigation

- `present Detail(Value)` goes to the nearest nav; add `in TargetNav` for an explicit mounted target.
- `present App@key` activates a root `SelectionNav` key without pushing content.
- `present View() as overlay` stacks above a nav. `as toast (Key: "...", Duration: 3.s)` is app-level.
- `dismiss` removes the nearest overlay or pushed/slot content; Back uses the same reducer.
- Arguments bind by owner label or unique nominal type, so values pass directly between scenes.
- Routes, deep links, general window presentation, and call-site title overrides are unavailable.

## Actions and state

- `state Name = Value` is view-local and reactive. App state may use `state Name is Type = Value (persist)`.
- `action Name(...) { ... }` may `set`, compound-set, `toggle`, `create`, `update`, `delete`, `do`,
  `present`, `dismiss`, `ask`, `respond`, or `fail`.
- `check <condition>` stops the action when the condition is false; it may not sit inside an `if`.
  One-sided `if` conditionally runs a block. `guard` belongs to views; in an action it is retired.
- `when do Verb(...) { … }` runs a verb that may fail and names what happens: `saved -> { … }`, a case
  the verb declares (`Offline -> { … }`), `rejected -> Problem { … }` for its other declared cases, and
  `error -> Message { … }` for anything undeclared. The verb's own writes roll back on failure.
- Root actions are serialized transactions; nested `do` joins the transaction. TypeScript effects
  cannot roll back. `async { ... }` starts a detached serialized root after its caller finishes.
- A `command` supplies static `Title`, optional description/label/icon/key/enabled values, and one
  `do`; use commands for toolbars and discoverable verbs, actions for private procedures.
- A view declaring `responds ResultType` can be opened with `ask`; `respond Case` resumes the action,
  while Back, `dismiss`, or bare `respond` yields `none`.
