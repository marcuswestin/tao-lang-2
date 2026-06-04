# Parser

## Goal

Parse `Apps/Kitchen Sink/Kitchen Sink.tao` with the smallest Langium grammar that supports the current app.

## Supported

- `app Name { ui RootView }`
- `ui Name { ... }`
- `ui Name Param text { ... }`
- `render View "text" { }`
- `render inject ```ts ... ````

## Out of Scope

- Validator package
- Full type system
- Formatter
- Imports, state, actions, layout, navigation, data, or design syntax
