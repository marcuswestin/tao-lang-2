# The session model gate

A spawned session starts on the app's default model, which the Developer changes over time and which may be the frontier tier. The brief and the coordinator together make sure no slice work runs there.

## In the brief

Open with the gate, verbatim or close to it: _do no work in your first turn; message the coordinator that you have started and end the turn; begin only when the coordinator confirms your model and effort are set._ Say that the click is required when the session comes from a `spawn_task` chip.

## When the session reports in

1. Find the session with `list_sessions`.
2. Set its model with `set_session_model`, using the full model id the picker lists, not a tier alias; the error names the accepted ids.
3. Set its effort with `set_session_effort`: medium for a slice, high for deep analysis, above high only with the justification the brief carries.
4. File it into the project's sidebar group with `move_sessions`.
5. Send the confirmation; the session starts on that message.

An agent created with the Agent tool takes its model and effort from the call, so it needs no gate; it still gets the rest of the brief.
