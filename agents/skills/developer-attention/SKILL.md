---
name: developer-attention
description: >-
  Notify the Developer when an agent in goal mode has a question or needs attention,
  and stop the alert when the Developer acknowledges or cancels.
---

# Developer attention

- When a goal-mode question or blocker needs the Developer, start `./agent unsandboxed notify-developer --id <unique-question-id>` in a tool session that can yield, then present the question. The command sounds immediately and every five seconds; keep it running while waiting.
- On the Developer's reply or cancellation, run `./agent notify-developer --id <same-id> --stop` before continuing. Acknowledgement stops the alert even if the answer still needs clarification; start a new alert for a new question.
- Use a unique ID per question, consisting of letters, digits, underscores or dashes, starting with a letter or digit. Record the ID in the task checkpoint if handing off while waiting. An alert with the same ID replaces the previous one; different IDs remain independent.
- In a normal terminal, `./agent notify-developer` works directly. An agent sandbox cannot reach macOS audio, so agents use the named host operation. If it is unavailable, report that limitation and the exact terminal command; do not claim a sound played. Audio playback success does not prove the Developer heard it.
- Stop the command's tool session on task cancellation if no acknowledgement command can run. The alert also stops on SIGINT, SIGTERM and SIGHUP. It opens no window and changes no sound settings.
