---
name: developer-attention
description: >-
  Notify the Developer when an agent in goal mode has a question or needs attention,
  and stop the alert when the Developer acknowledges, cancels, or says "stop notification" in any task.
---

# Developer attention

- When a goal-mode question or blocker needs the Developer, start `./agent unsandboxed notify-developer --message "<question or reason>" --context "<task name>"` in a tool session that can yield, then present the question. Sound repeats every four seconds; screen flashes begin after 30 seconds and repeat every four seconds. Keep it running while waiting.
- On the Developer's reply or cancellation, run `./agent unsandboxed stop` before continuing. Any agent must also run that command immediately when the Developer says "stop notification", whether or not it started the alert. No shutdown ID or originating worktree is needed. Acknowledgement stops the alert even if the answer still needs clarification; start a new alert for a new question.
- There is one sound/flash loop per machine user across every worktree. A later request posts its context notification and reuses the active loop; it does not queue a new loop to start after shutdown. In a terminal, `just stop` from any worktree stops the shared loop. The stopped ownership claim remains until native effects have drained, preventing overlap with a new caller.
- In a normal terminal, `./agent notify-developer` works directly. An agent sandbox cannot reach macOS audio, so agents use the named host operation. If it is unavailable, report that limitation and the exact terminal command; do not claim a sound played. Audio playback success does not prove the Developer heard it.
- `--sound <name>` selects a built-in macOS sound (default Bottle); command help lists the choices. `--flash-screen` starts visual alerts immediately instead of waiting 30 seconds.
- Supply `--message` with the question or reason for attention and `--context` with the task name. One macOS notification is posted at startup; sound and flashes repeat until acknowledged. Banner visibility follows macOS notification and Focus settings; successful posting does not prove it was visible. Dismissing the banner does not stop the alert; acknowledge in the task.
- Playback volume rises linearly from 20% to 100% over two minutes, then stays at 100%; system volume and mute settings remain in effect.
- Stop the command's tool session on task cancellation if no acknowledgement command can run. The alert also stops on SIGINT, SIGTERM and SIGHUP. It opens no window and changes no sound or accessibility settings.
