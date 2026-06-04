# Plain Codegen Wrapper

Status: implemented, pending Ro review.

- "Plain" means no custom generator class and no tracing/source maps yet; the wrapper still uses Langium generator nodes.
- Added `gen` for dedented source templates and indentation-aware multiline substitutions.
- Replaced the class-based runtime generator with the exported `Compile` object.
- Routed current string arguments through `Compile.Expression` and `Compile.StringLiteral`.
- Deferred tracing and source maps by design.
