# Commit All Chunks

Commit every current uncommitted change in small self-contained chunks, when the Developer explicitly asks to
commit all outstanding changes. Make commits only; do not edit code without separate approval.

- Do not change file contents. Ask before fixing anything discovered during commit preparation.
- Inspect staged and unstaged state and preserve the user's intended index boundaries where possible.
- Run `./agent verify --complete` before the first commit.
- Choose the smallest self-contained remaining chunk, stage only that chunk, commit it, and repeat.
- Use a concise summary followed by one bullet per line with no blank lines between bullets.
- Do not rerun full validation between commits unless a command changed files after the validated state.
- Finish with no uncommitted changes, or report exactly what could not be committed and why.
