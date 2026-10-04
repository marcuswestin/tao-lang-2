---
name: developer-attention
description: >-
  Notify the Developer when an agent in goal mode has a question or needs attention,
  and stop the alert when the Developer acknowledges or cancels.
---

# Developer attention

- When a goal-mode question or blocker needs the Developer, start `./agent unsandboxed notify-developer --shutdown-id <unique-question-id>` in a tool session that can yield, then present the question. Sound repeats every four seconds; screen flashes begin after 30 seconds and repeat every four seconds. Keep it running while waiting.
- On the Developer's reply or cancellation, run `./agent notify-developer --shutdown-id <same-id> --stop` before continuing. Acknowledgement stops the alert even if the answer still needs clarification; start a new alert for a new question.
- IDs only need to differ among simultaneous alerts in the same checkout; separate worktrees have separate alert state. Use a task or session identifier plus a question counter (for example, `task-ab12-question-1`), consisting of letters, digits, underscores or dashes and starting with a letter or digit. Record the ID in the task checkpoint if handing off while waiting. An alert with the same ID replaces the previous one; different IDs remain independent.
- In a normal terminal, `./agent notify-developer` works directly. An agent sandbox cannot reach macOS audio, so agents use the named host operation. If it is unavailable, report that limitation and the exact terminal command; do not claim a sound played. Audio playback success does not prove the Developer heard it.
- `--sound <name>` selects a built-in macOS sound (default Bottle); command help lists the choices. `--flash-screen` starts visual alerts immediately instead of waiting 30 seconds.
- Supply `--message` with the question or reason for attention and `--context` with the task name. One macOS notification is posted at startup; sound and flashes repeat until acknowledged. Banner visibility follows macOS notification and Focus settings; successful posting does not prove it was visible. Dismissing the banner does not stop the alert; acknowledge in the task.
- Playback volume rises linearly from 20% to 100% over two minutes, then stays at 100%; system volume and mute settings remain in effect.
- Stop the command's tool session on task cancellation if no acknowledgement command can run. The alert also stops on SIGINT, SIGTERM and SIGHUP. It opens no window and changes no sound or accessibility settings.
