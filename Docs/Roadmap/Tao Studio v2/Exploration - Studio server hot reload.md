# Exploration - Studio server hot reload

Status: **problem statement and options, not a decision**. Nothing here is implemented. It records why a
`./dev studio` session only half-reloads today, what the cheap fix would cost, and what a real one would have
to preserve.

## What reloads today, and what does not

`startStudioClientDevReload` watches `packages/ides/studio/studio-src` (which now holds the code editor too)
for `.tao`, `.ts` and `.tsx` changes, rebuilds the browser bundle in a subprocess, and publishes it only when
the build completes. The page polls `/studio-dev/revision` and reloads itself. That covers everything bundled
into the client: the editor, the matrix view, the agent panel.

The Studio **server** does not reload. Its modules are loaded once when the process starts, so a change to
`StudioServer.ts`, a session, a source action, or anything under `agent-chat/` that runs server-side takes
effect only on restart. `--native` disables client reload entirely, so a native session reloads nothing.

## Why the half state is worse than no reload

The two halves reload independently, and the client half wins. After a server-side edit the page is rebuilt
from new sources while the server still runs the old ones, so the page can call an endpoint the server does
not have. What comes back is not a clean failure: Studio's `/api/agent-chat/` prefix route matched a request
for a not-yet-existing `stream/send` sub-path as a _command name_ and answered `200` with
`{"error":"Unknown agent chat command: stream/send"}`. A caller checking the status code sees success.

That cost real time during the agent-chat work: a live check appeared to prove a new route existed when it did
not, and only a deliberate control probe — asking for a command that could never exist — showed the route was
being swallowed by the old handler. The rebuild now logs `Studio server sources changed; restart ./dev studio`
when a changed file is one the server loads, which makes the state visible but does not remove it.

## Why the cheap version is not obviously worth it

Restarting the process on every server-side save is a few lines. It is also probably worse than restarting by
hand, because `./dev studio` owns more than an HTTP server:

- the disposable Expo/Metro preview runtime, which takes seconds to boot and whose file-map crawl is the
  subject of its own fix (`Publish the preview app before the bundler crawls for it`);
- a project session with a workspace, a compile coordinator, and a file watcher;
- the Apple Foundation Models helper subprocess;
- the native shell, when one is attached.

Tearing all of that down on each save turns a two-second edit into a ten-second one and re-runs the preview
boot that a session only just got right. A person who wants that today can already have it, deliberately, in
two keystrokes.

## What a real one has to preserve

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

This is worth building when Studio server code is edited often enough that manual restarts dominate the loop —
which the agent work has started to do, since a change to a tool or a route is a server change. Until then the
honest position is: the client reloads, the server does not, and the rebuild says so out loud.
