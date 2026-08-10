# Prompt - Review Navigation Decisions

Perform a context-free, read-only architectural review. Assume no access to the design conversation. Do not edit, format, stage, commit, or run mutating commands.

Read the active specifications, navigation research record, authoritative Writer app, nav stdlib stub, first implementation scope, and deferrals. Treat `Roadmap/Archive/` only as history.

Report only substantial issues that could make implementation wrong, incomplete, inconsistent, unexpectedly complex, or unable to support legitimate apps. Check:

- Whether `let`, declaration properties, `with`, child blocks, and type matching form one coherent language model.
- Whether UI/nav roles, descriptor construction, identities, and mounting rules are unambiguous.
- Whether targeting and transition operations cover selection, panes, stack reset, duplicate destinations, auxiliaries, native back, and reusable package UI.
- Whether React Native/native providers can implement the semantic reducer without parallel authoritative state.
- Whether restoration, entity failure states, dialogue lifetime, and deferred work leave viable evolution paths.
- Whether the first implementation scope is a coherent vertical slice and does not require a deferred feature implicitly.
- Whether every normative rule has an example and planned test, every invalid behavior has a diagnostic, and active documents agree.

For every confirmed issue, recommend a concrete resolution and include Tao syntax where useful. Classify it as a blocker before planning, a required plan clarification, or a safe deferral. Cite exact files and lines.
