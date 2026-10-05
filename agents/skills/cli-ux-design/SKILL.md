---
name: cli-ux-design
description: Design or revise interactive CLI prompts, option menus, terminal screens, progress, and recovery messages. Use for CLI UX design and changes to developer-facing command flows.
---

# CLI UX design

- When a process step takes more than about one second, print what it is doing, such as
  `Compiling…` or `Shutting down…`. Show the message before the wait, update it for distinct
  meaningful stages, and report completion only after the work and cleanup finish.

- `tao connect run` is the Developer's explicit exception: use one compact `Actions:` line
  with single-key actions and no initial target menu or numbered action list.

- When a person picks among multiple options, print each option on its own line. Label options `1`–`9`, then `a`–`z`, in display order. Accept the displayed label followed by Enter.
- When an option is the default, put it first and append `(default)` on that line. Enter selects that option. Without a default, Enter is an incorrect response; never silently pick one.
- On an incorrect response, reprint the options and the exact notice `ctrl+c to quit`, then accept another response. Keep the same labels and default while retrying. Ctrl+C exits the prompt.
- Keep option labels short and explicit about what selecting them does. Choose a default from the Developer's decisions and existing behavior; do not silently spend a limited resource or choose product behavior.
- Present the next action where it is needed, and report failures with what completed and how to resume. Keep passwords and tokens in hidden local prompts.
- Make terminal screens readable with light and dark themes. Give machine-readable visuals explicit contrast and sufficient quiet space; prevent line wrapping from corrupting their geometry. Keep the underlying address available as text.
- Reuse shared prompt and output helpers. Put repeatable interaction behavior in those helpers rather than reimplementing it independently in each command.

Example:

```text
Open the app on:
1. iOS Simulator (default)
2. iPhone

>
```

Enter or `1` followed by Enter selects Simulator; `2` followed by Enter selects iPhone.
An incorrect response redraws both options with `ctrl+c to quit`.
