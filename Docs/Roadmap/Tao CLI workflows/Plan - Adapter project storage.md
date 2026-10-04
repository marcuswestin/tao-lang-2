# Adapter project storage

Deferred from the Studio preview speed project on 2026-10-04. The Developer chose to finish the
project-folder layout before building the adapter storage API.

[Project folder layout](<Decisions - Project folder layout.md>) decides that datasource adapters
get a Tao API to read and write committed `store/`, developer-local `local/`, and regenerable `cache/`
state. The current Dev datasource continues to use its existing server protocol.

Before implementation, decide the adapter-facing API, access boundaries, atomic-write and locking
contract, and how adapters locate their own state without exposing unrelated project files. Reuse
the project layout and migration owner; do not introduce a second directory convention.

Completion requires an adapter exercising each storage lifetime, preservation of unrelated state,
and behavior tests covering atomic writes, contention, and unavailable storage.
