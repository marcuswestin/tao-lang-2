# DEVENV-DEV-CLIENT-CRASHES-RELOADING-WITH-AN-OPEN-WEBSOCKET — The dev client crashes reloading with an open websocket

- **Status:** Candidate
- **Section:** External
- **Area:** iOS simulator dev client, InstantDB websocket, app reloads.
- **Impact:** A reload during a simulator check can kill the dev client, which then needs relaunching and signing in again; a stray key in the simulator window triggers the reload.
- **Evidence:** On 2026-09-27 the `com.anonymous.tao-runtime` dev client on the iPhone 17 simulator aborted (SIGABRT in `RCTWebSocketModule`) when the bundle reloaded while the InstantDB websocket was open. The installed dev-client app path also changes on every launch, so a scripted relaunch cannot reuse the last one.
- **Workaround:** Avoid reloading during a live check; relaunch the dev client from `./agent unsandboxed app-dev` if it dies.
- **Proposed change:** Close provider sockets on reload (a dev-mode teardown hook), and find whether the abort is React Native's or the provider's.
- **Dependencies:** None.
- **Acceptance:** Reloading the app with an open InstantDB connection keeps the dev client running.
- **Source:** Provider pairing and InstantDB auth, `feat/provider-bridges`, 2026-09-27.
