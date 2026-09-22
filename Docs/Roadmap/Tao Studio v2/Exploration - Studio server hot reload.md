# Exploration - Studio server hot reload

Status: **decision for the current development loop**. Studio server and native-host edits require a
deliberate `./dev studio` restart. Browser-client-only edits still reload the browser. Do not build a
coordinated server/native hot-swap or an automatic whole-process restart yet. This decision is separate
from Tao project edits, whose preview loop retains compatible interaction state.

## What reloads today, and what does not

`startStudioClientDevReload` watches the Studio package, Studio-tooling, and `Apps/Tao Studio` for `.tao`, `.ts` and `.tsx` changes.
For a browser-client-only edit it rebuilds the bundle in a subprocess, publishes it after the build, and
the page polls `/studio-dev/revision` to reload itself. This covers the editor, matrix view, and client
agent panel.

The Studio **server** does not reload. Its modules are loaded once when the process starts, so a change to
`StudioServer.ts`, a session, a source action, or anything under `agent-chat/` that runs server-side takes
effect only on restart. `--native` disables client reload, so a native-host edit also needs restart.

## Why the half state is worse than no reload

The two halves reload independently, and the client half wins. After a server-side edit the page is rebuilt
from new sources while the server still runs the old ones, so the page can call an endpoint the server does
not have. What comes back is not a clean failure: Studio's `/api/agent-chat/` prefix route matched a request
for a not-yet-existing `stream/send` sub-path as a _command name_ and answered `200` with
`{"error":"Unknown agent chat command: stream/send"}`. A caller checking the status code sees success.

That cost real time during the agent-chat work: a live check appeared to prove a new route existed when it did
not, and only a deliberate control probe — asking for a command that could never exist — showed the route was
being swallowed by the old handler. The watcher now latches on a server-side edit, keeps the last coherent
client bundle instead of publishing newer assets against the old server, and logs that Studio needs restart.
An in-flight client build cannot publish once that latch is set. Restart clears it.

## Why the cheap version is not obviously worth it

Restarting the process on every server-side save is simple but could be expensive because `./dev studio`
owns more than an HTTP server:

- the disposable Expo/Metro preview runtime, which takes seconds to boot and whose file-map crawl is the
  subject of its own fix (`Publish the preview app before the bundler crawls for it`);
- a project session with a workspace, a compile coordinator, and a file watcher;
- the Apple Foundation Models helper subprocess;
- the native shell, when one is attached.

The full restart cost has not been measured on a usable host, so no latency claim is settled here. For now,
the developer chooses when to pay it. If real work shows restarts dominate the loop, measure the components
and consider keeping Metro as a separate preview worker while restarting the Studio shell. The shell would
then reconnect to known preview URLs; that is an optimization to prove, not a dependency of the Tao preview
edit loop.

## If a coordinated reload becomes worth doing

The valuable version keeps the expensive things alive and reloads only what changed. Sketch, not a plan:

- **Re-import the request-handling modules per change, not per process.** Bun can re-import a module with a
  cache-busting specifier. The route table and the agent-chat handler are small and mostly pure; the session,
  the preview runtime and the compile coordinator are not, and must survive.
- **Decide what module-level state means across a reload.** `agent-chat` keeps conversations in a module-level
  `WeakMap` and staged changes in a `Map`; re-importing the module drops both. Losing an in-flight chat on a
  server edit may be acceptable, but it should be a decision rather than a surprise, and it needs saying in
  the UI when it happens.
- **Reload the two halves together.** The failure above comes from the client and server reloading
  independently. Whatever ships should publish one revision that both sides agree on, so a page never talks to
  a server older than itself.
- **Cover `--native`.** Native sessions reload nothing today, and the native shell is exactly where a manual
  restart costs the most.

## What would make it worth doing

Revisit only if measured restart frequency and latency justify it. Until then the honest position is:
client-only browser changes reload, server/native changes wait for restart, and the running client and
server never intentionally advance to different source revisions.
