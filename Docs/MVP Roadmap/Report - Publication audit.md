# Report - Publication audit

One inventory of what publishing this repository would expose, with a recommendation per entry.
Serves `Agent MVP Roadmap.md` item `A10`; its findings were the input `Developer MVP Roadmap.md` item `R2`
waited on.

**`R2` was decided on 2026-09-20: publish the whole repository**, to make an open-source contributor
community possible. That closes the option every entry below was written against. Each recommendation
still names curating or withholding as an alternative, because that was the live choice when the
audit ran; read those as the cost of publishing the thing rather than as an available out. What the
decision does not waive is the prerequisite work — `P15`, `P16`, `P17`, `P18`, and `P24` were
required under every option and are now the only blocking items.

Entries are `P1`–`P25`, grouped by the five areas `A10` names. Each states what it is, what
publishing it reveals, and a recommendation. Severity is **High** (publish only after acting),
**Medium** (act, or accept deliberately), **Low** (note and move on).

No secret value appears in this report. Where a value had to be inspected to classify it, only its
shape and location are recorded.

## Summary

- **Nothing must stay unpublished for secrecy of credentials.** `secrets/secrets.jsonc` is genuinely
  age-encrypted to a Secure Enclave recipient, and a scan of all 15,141 blobs in all 1,448 commits of
  history found no credential material. This was the single largest unknown going in, and it is clean.
- **The real exposure is editorial, not cryptographic.** The agent instruction set, `Roadmap.md`, and
  `Docs/Roadmap/` are candid internal working material — roughly 271,000 words of it — written on the
  assumption that only the Developer and agents would read it. It is unflattering in places and sets
  expectations the product does not yet meet.
- **Three concrete items should be fixed before any publication**, whichever shape `R2` picks: real
  App Store Connect account identifiers in a committed lock file (`P15`), a hardcoded personal device
  name in shipped source and docs (`P16`), and a license that names no copyright holder and is
  declared in no package (`P24`).
- **The license question is larger than hygiene.** AGPL-3.0's copyleft reaches into every app built
  with Tao, because Metro resolves the runtime's AGPL source directly into the app bundle. That is
  `R1`'s decision, and `P23` records the mechanism that makes it real.

## A. Agent instruction set, subagent profiles, skills, and `.rulesync`

The whole agent surface is tracked and would publish: `AGENTS.md` (116 lines), `packages/AGENTS.md`,
`Apps/Test Apps/AGENTS.md`, `.claude/CLAUDE.md`, 21 skills under `agents/skills/`, 7 subagent
profiles under `agents/subagents/`, the 4 `.rulesync/` sources, and their generated adapters
(`.claude/settings*.json`, `.codex/config.toml`, `.codex/hooks.json`, `.codex/rules/tao.rules`,
`.cursor/*`, `.config/wt.toml`).

### P1 — The instruction set names the Developer and encodes the working relationship — Medium

`AGENTS.md` refers to the Developer 18 times, and skills add 46 more references. It states that "the Developer is the
project lead and language designer", that the Developer decides language semantics, roadmap priority, and
product behavior, and that pushing and merging always stop for the Developer. A whole `Response format` section
— named `Responses to the Developer` when this audit was written — prescribes how an agent should talk to the Developer:
lead with the answer, at most three levels of nesting, letter the sub-items the Developer may want to address.

Published, this tells a reader that Tao is one person's project with agents doing the typing, and it
publishes the Developer's personal communication preferences as repository content. Neither is damaging; both
are more intimate than a public repository usually is.

- **Recommendation:** keep the instruction set, but move the `Response format` section out of the
  published copy — it is the one part that is about the Developer rather than about Tao. If `R2` picks a
  curated public repository, keep a slimmed `AGENTS.md` there that covers the codebase conventions
  and drop the authority and response-shape sections entirely.

### P2 — The "never mention Claude" rule reads badly out of context — Medium

`AGENTS.md` instructs every harness never to mention Claude or any agent identity in work products —
no file names, documents, code, comments, branch names, or commit messages, and explicitly no AI
`Co-Authored-By` trailer and no "Generated with Claude Code" line. The rule is repeated in
`agents/skills/agent-instructions/SKILL.md`.

Internally this is a consistency rule. Published alongside a history of 1,451 commits that carry no
AI attribution, it can be read as deliberate concealment of how the code was written — a story an
unsympathetic reader will tell for you, and one that lands badly with exactly the Hacker News
audience `A1`–`A16` are aiming at.

- **Recommendation:** get ahead of it rather than hide it. Keep the rule (it is a reasonable
  house-style choice), and say plainly in the public README that Tao is built by one person working
  with coding agents and that commit trailers are omitted for a clean history. Volunteering this
  costs nothing; being caught at it costs the launch.

### P3 — The sandbox policy is a published map of what agents may do — Medium

`.rulesync/permissions.jsonc` (230 lines) and the generated `.claude/settings.json` (199 lines) and
`.codex/config.toml` (165 lines) spell out the full policy: which commands auto-approve, which are
excluded, which paths are writable, and a network allowlist of 27 host patterns (Anthropic, OpenAI,
Apple's developer, App Store Connect and software-update hosts, Expo, GitHub, npm, nixos/cachix).
`.rulesync/profiles.jsonc` adds the opt-in escapes: `native` (Simulator and DerivedData writes),
`local-services` (the Docker socket), `release` (Xcode archives), and `unsandboxed` (the Bash sandbox
off entirely).

Two things are revealed. First, an operational profile of the project: it uses Anthropic and OpenAI
models, ships through App Store Connect, and runs a Docker-backed InstantDB. Second, and more
usefully to an attacker, a precise description of the guard rails — including that an `unsandboxed`
profile exists and how to select it. A malicious contributor who can land a file in this repository
learns exactly which commands execute without review.

- **Recommendation:** publish it anyway, with one change. The policy's value as documentation of how
  to work safely with agents exceeds its value to an attacker, and everything it protects
  (`~/.ssh`, `~/.aws`, `~/.config/gh`, `.env`) is denied by name in the file itself, which is
  reassuring rather than alarming. The change: treat the deny rules as security-relevant from
  publication onward, so a pull request that edits `.rulesync/permissions.jsonc` or
  `.rulesync/profiles.jsonc` needs the same scrutiny as one that edits a signing script.

### P4 — The skills document known weaknesses in the codebase — Low

The 21 skills are a candid description of where this codebase goes wrong. `test-quality` exists to
catch "vacuous or self-fulfilling assertions" and "README claims a journey does not prove".
`removing-code` exists because dead surfaces accumulate. `old-repo-porting` warns against the
previous repository's "stale conventions and copied implementation cruft". `error-handling`,
`langium-scoping`, `runtime-codegen`, and `studio-hybrid-client` each encode a seam that was gotten
wrong before.

A skill is a scar. Twenty-one of them published together read as a list of the project's recurring
failure modes.

- **Recommendation:** publish. This is the least of the exposures and arguably an asset — it is
  concrete evidence of engineering discipline, and the audience `A3` addresses will read it that
  way. No action.

### P5 — `agents/skills/parallel-implementation/agents/openai.yaml` — Low

A single vendor-specific agent definition sits inside an otherwise harness-neutral skill tree.

- **Recommendation:** no publication concern. Noted only because it is the one place the
  harness-neutral rule is not held, and a reader looking for inconsistency will find it.

### P6 — The session-start hook runs outside the sandbox, and says so — Low

`.rulesync/hooks.jsonc` (64 lines) documents in a comment that "Hooks run as ordinary processes
outside the Bash sandbox", and wires `sessionStart` to execute
`packages/dev/dev-src/cli/agent-session-start.zsh` from the Git root. Three further hooks —
`preToolUse`, `subagentStart`, `subagentStop` — run
`packages/dev/dev-src/cli/agent-delegation-log.zsh`.

Published, this is a documented code-execution path that runs unsandboxed whenever anyone opens this
repository in Claude Code, Codex, Cursor, or Worktrunk. A contributor who lands a change to either
script executes code on the next maintainer's machine, outside the sandbox, before any agent command
runs.

- **Recommendation:** treat `packages/dev/dev-src/cli/agent-session-start.zsh`,
  `packages/dev/dev-src/cli/agent-delegation-log.zsh`, `./agent`, and `.rulesync/hooks.jsonc` as
  protected paths once the repository is public — the same review bar as the permission sources in
  `P3`. This is a real supply-chain seam, not merely an exposure, and it is worth naming in the
  contributing guidance `A3` produces.

### P25 — The delegation instrumentation is published; its log is not — Low

The subagent-delegation work adds a surface worth stating explicitly, because it looks like telemetry
at a glance and is not.

- Seven profiles under `agents/subagents/` name concrete models and effort levels —
  `claude-opus-5[effort=high]`, `claude-sonnet-5`, `model_reasoning_effort: xhigh`. Published, these
  disclose which vendor and tier each kind of work is routed to, and they sit oddly beside `P2`'s
  rule against naming the agent identity in work products. The rule governs work products; config
  that has to name a model is a different thing, but a reader will notice the tension.
- The three hooks in `P6` write to `.artifacts/delegation/events`. `.artifacts` is gitignored
  (`.gitignore:16`), so **no delegation log is committed** and none would publish. Verified rather
  than assumed, because a per-session record of what work was handed to which model is exactly the
  kind of file that should not leave the machine.
- `Docs/Roadmap/Subagent delegation/Plan - Subagent delegation.md` states the hooks are for a
  calibration period and names the criteria for removing them, so the instrumentation is
  self-limiting and says so.

- **Recommendation:** publish the profiles and the skill; keep the log path gitignored. If `R2` picks
  a curated public repository, check before each sync that `.artifacts/` is excluded at the sync
  boundary too, not only by `.gitignore` — that is the one way these events could escape.

## B. `Roadmap.md` and `Docs/Roadmap/` as the Developer's private working material

`Roadmap.md` is 393 lines. `Docs/Roadmap/` is 206 tracked files and roughly 271,000 words, 138 of
them active and 33 archived.

### P7 — `Roadmap.md`'s personal `STACK` section — High

Lines 15–31 are a personal working list, not a roadmap: raise a TUI test timer from 0.5s to 0.1s,
deep links, "Enable Codex to interact with studio on its own", work through the environment ledger.
`R2` names this section specifically.

It is undated, unordered, and mixes a one-line chore with a multi-week workstream. It reads as
someone's notes-to-self, because it is.

- **Recommendation:** do not publish. Move the `STACK` list into an untracked or separately-tracked private
  file before publication. It carries no information a public reader can use and it sets the tone for
  everything after it.

### P8 — `Roadmap.md`'s personal backlog section — High

Lines 262–357 are the product and codebase backlog, "unordered", and they are frank in a way that
will be quoted. Specifics that publish as written: "Roughly two dozen raw `Error`s handed to a
promise rejection", "66 already-typed `throw new Errors.*` guards across ten studio files", "Remove
magical strings", "Review all tests: remove unnecessary surfaces and overlaps", 462 call sites
awaiting an argument-order change, and repeated "Not started." markers against named plan parts.

These are healthy things for a maintainer to track. Published at launch, they are the raw material
for "Tao ships with two dozen known unhandled rejections" — accurate, unfair, and unanswerable.

- **Recommendation:** do not publish as-is. Either keep `Roadmap.md` private entirely, or replace the
  public copy with a short, curated "what's next" that states direction without per-site defect
  counts. `A3`'s README needs an honest limitations section regardless; that is the right place for
  candour, because there you control the framing.

### P9 — `Docs/Roadmap/September squash-merge remediation.md` — High

Opens with two independent audits of every September squash merge, 188 confirmed findings
"(27 high / 76 medium / 85 low)", 183 deduplicated checklist rows, and a status section naming gates
that have **not** been run to completion and a quarantined smoke skip.

This is the single most quotable document in the repository. "183 findings in one month of merges"
is a headline, and the fact that all 183 were then implemented is the part that will not travel.

- **Recommendation:** do not publish. The document's whole value is internal traceability, and it
  explicitly says it is the durable summary of an untracked checklist. Keep it private under any
  `R2` outcome.

### P10 — The developer-environment ledger — Medium

Now three things rather than one file: `Docs/Roadmap/Developer environment upgrades.md` (120 lines,
69 open `DEVENV-` entries), `Developer environment upgrades archive.md` (62 lines), and a
`Developer environment upgrades/` folder of 67 per-issue files. **243 distinct `DEVENV-` identifiers**
exist across the three.

Checked for machine-specific content: no absolute home paths, no device names, no usernames, so it is
clean in the `P16`/`P17` sense.

What it reveals is volume. The split makes the open list look shorter while the full record is larger
and still tracked — 243 catalogued environment defects is a lot of friction to show a developer you
are asking to install your toolchain, and the archive says plainly how many there have been.

- **Recommendation:** do not publish at launch, and treat all three paths as one decision — publishing
  the trimmed index while the folder and archive stay private would be worse than publishing none of
  it, because the index links onward. It is the correct place for agents to keep recording findings
  (`AGENTS.md` mandates it), so keep it tracked privately rather than deleting it. Revisit after
  `A8`'s managed toolchain lands, when the story is "we fixed these".

### P11 — Twenty-four active roadmap programs for unshipped capability — Medium

`Docs/Roadmap/` holds active plans for Accessible Tao apps, a design system, navigation and routing,
React Native and Expo bridging, a CloudKit provider, component kits, enforcement and diagnostics,
freehand UI sketching, HTTP and InstantDB datasources, keyboard-driven apps, multiple datasources,
Tao Skills, Studio AI, the companion app, Studio v1 and v2, `Tao ship`, and an iCloud provider —
plus `AI in Tao apps.md`, `Authority.md`, `Multiplayer sync.md`, `Deterministic simulation.md`, and
`Tao create.md`.

Published, these read as a feature list. A visitor cannot easily tell a landed capability from a
design sketch, and `R3` has not yet settled what stability is promised.

- **Recommendation:** publish selectively and label ruthlessly. `Docs/Roadmap/Tao Revolution/`
  (`Decisions.md`, `Process.md`, `Coverage.md`) is the language target and is worth publishing —
  `Coverage.md` in particular maps capability to proving test, which is exactly the honesty `A3`
  wants. Hold the per-program plan folders back until `R3` fixes the stability promise, then publish
  them behind a clear "planned, not built" banner.

### P12 — `Docs/Archive/` — Low

33 archived files, including spike patches, prompt documents, and a `dialect-spike.test.ts.txt`.
Frozen by `AGENTS.md`; historical rather than forward-looking, so it sets no expectations.

- **Recommendation:** publish or omit, either is defensible. Omitting is marginally tidier; the
  archive's contents are already reachable through history under `P20`.

### P13 — `Docs/Spec/` and `Docs/Tutorials/` — Low

The spec set (9 documents) is the implemented contract and the tutorials are the learning material.
`Docs/Spec/Tao Design.md` carried a work-in-progress suffix; the rename (decision I) resolved it for
this file. One tutorial reference is caught separately by `P16`.

- **Recommendation:** publish. This is the material `A3` and `A5` are built on. Settle the `- WIP`
  suffix convention before launch — `Roadmap.md` already lists "write down the draft-suffix
  convention" as open work — so a reader knows whether WIP means unfinished prose or unfinished
  behavior.

### P14 — `Docs/Archive/Explorations/Tao ship.md` names an unowned credential problem — Medium

Line 240 states that deploy credentials — App Store Connect keys, Play service-account keys,
InstantDB admin tokens — have "**No owner today**", and that `AppId` values are hardcoded in `.tao`
source, "survivable only because InstantDB app ids are public client values".

The technical claim is correct, and it is the reason `P15`'s InstantDB identifier is not a finding.
But an explicit, dated, self-documented "no owner today" on credential handling is an invitation to
look for what else is unowned.

- **Recommendation:** do not publish this document until `R2` and the `Tao ship` program settle the
  configuration store it sketches. If it does publish, cut the "No owner today" phrasing to a neutral
  statement of the design direction — the design is sound; only the self-assessment is the problem.

## C. Machine-specific files and personal references

### P15 — Real App Store Connect identifiers in a committed lock file — High

**2026-10-02 amendment:** this finding records the previous lock layout. The project migration
tracks `.tao/lock.jsonc` for reproducible dependency and toolchain pins while preserving its shipping
concern. The blanket untracking recommendation below is superseded; publication review must instead
settle how accepted machine/account shipping identifiers are separated or redacted. No credentials
or accepted shipping history are removed by the migration.

`Apps/WordFlower/1 - Current/.tao-project/lock.jsonc` is tracked and contains, for a real accepted
ship of WordFlower:

| Field                               | What it is                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `issuerId`                          | The App Store Connect API **issuer ID** — identifies the Developer's whole ASC account |
| `keyId`                             | The ASC API **key ID** (`KSAY…`), naming a specific active API key                     |
| `appStoreAppId`                     | A real App Store application ID                                                        |
| `betaGroups.external` / `.internal` | Real TestFlight beta group UUIDs                                                       |
| `AppId`                             | The InstantDB app id, also the local fixture seed in `Justfile:7`                      |
| `update.serverUrl`                  | `https://updates.tao-lang.dev`, a host the Developer operates                          |

None of these is a secret on its own, and the matching `.p8` private key is **not** committed —
`packages/cli/tao-cli/cli-src/ship-command.ts:335` resolves it from a path outside the repository, and no
`.p8`, `.cer`, or `.mobileprovision` file has ever been tracked. The InstantDB `AppId` is a public
client value by design (`P14`). So this is not a credential leak.

It is still worth removing. `issuerId` and `keyId` are the two halves of ASC authentication that are
not the key file; publishing them narrows an attacker's problem to obtaining one `.p8`, and they
identify the Developer's Apple developer account permanently, in history, whether or not the file is later
changed. The TestFlight group UUIDs address real tester cohorts.

- **Recommendation:** stop tracking `.tao-project/lock.jsonc`. It is per-checkout accepted-ship state,
  not source, and the `Tao ship` design in `P14` already wants this data in a per-project store that
  "is never source". Add `**/.tao-project/lock.jsonc` to `.gitignore`, remove the file from the index,
  and — because history publishes too (`P20`) — rotate the ASC API key named by that `keyId` before
  the repository goes public. Rotation is cheap and makes the historical copy inert.

### P16 — `roPhone`, a personal device name, in shipped source and docs — High

The Developer's physical iPhone is named on 76 lines across 12 tracked files:

- `packages/ides/studio-tooling/studio-tooling-src/StudioCompanionDevice.ts:261–262` — in a source comment, as the
  worked example of the recipe's argument quoting.
- `packages/ides/studio/README.md:46` and `Docs/Tutorials/Tao now - two-week walkthrough.md:149` — as the
  documented command a reader is shown: `just studio-companion-install device="roPhone"`.
- 66 further lines across eight test files, as fixture data.

The README and tutorial cases are the real problem: they instruct a public reader to install onto a
device that does not exist for them. `packages/ides/studio-companion-app/README.md:13` already gets this
right with `device="<name>"`, which shows the fix.

- **Recommendation:** replace every documentation and source-comment occurrence with the
  `<name>` placeholder already used in the companion app README. Leave the test fixtures alone
  if you prefer — they are internal and harmless — but a single rename to something like
  `example-phone` across all 76 lines is cleaner and costs one commit. Worth doing regardless of
  `R2`, because the README and tutorial cases are simply wrong instructions for anyone but the Developer.

### P17 — `ro-state` hardcoded in the permission source — Medium

`.rulesync/permissions.jsonc:184` allows the Unix socket
`~/.local/state/watchman/ro-state/sock`, and that value propagates into the generated
`.claude/settings.json:100` and `.codex/config.toml:105`. Watchman names its state directory after
`$USER`, so `ro-state` is literally "the user named `ro`".

This is both an exposure and a portability bug: on any other developer's machine the socket is
`<their-user>-state/sock` and this rule never matches, so Watchman is silently denied and Metro falls
back to OS watching — the exact failure `packages/dev/dev-src/doctor/RepositoryDoctor.ts:315` warns
about.

- **Recommendation:** fix the source, not the generated files. Make the rule user-agnostic — a
  wildcard segment, or have `./agent setup` render `$USER` into the generated policy. Then
  regenerate with `just _agent-config`. This one is worth fixing whether or not the repository ever
  publishes, because it breaks the second developer.
- **Disposition (2026-09-22):** Fixed, without a wildcard or a rendered login. Both harnesses turn
  a socket entry into a Seatbelt `subpath` rule that matches the resolved path, so the source now
  allows the directory `~/.local/state/watchman`, which covers `<login>-state/sock` for any login
  and nothing a link planted there points at. A denied or stopped Watchman now fails `./agent doctor`
  by name, from `packages/testing/verification/verification-src/WatchmanHealth.ts` (the doctor path
  cited above has moved). What remains is recorded in
  [DEVENV-FILE-WATCHING-DEPENDS-ON-A-WATCHMAN-NO-AGENT-CAN-START](<../Roadmap/Developer environment upgrades/DEVENV-FILE-WATCHING-DEPENDS-ON-A-WATCHMAN-NO-AGENT-CAN-START.md>).
- **Follow-up (2026-09-25):** The rule is gone from both sandboxes: Codex could only be given it
  as an absolute path naming a login (see `P18`), so file-watching dev loops run on the host
  through named operations instead, and the doctor treats a sandbox without Watchman as expected.
  A stopped server now warns with a start command; a missing client still fails.

### P18 — Absolute `/Users/ro/…` paths in a generated harness config — Medium

`.codex/config.toml:105` and `:146` carry fully expanded paths — the Watchman socket above and
`/Users/ro/.docker/run/docker.sock`. The `.rulesync/profiles.jsonc:23` source correctly writes
`~/.docker/run/docker.sock`; the expansion happens during generation.

Three test files also embed absolute paths, but only one is personal:
`packages/ides/studio/studio-tests/studio-sketch-session.test.ts:590` uses
`/Users/ro/.codex/worktrees/...`. The others use neutral placeholders (`/Users/me`, `/Users/dev`,
`/Users/someone`) and need no change.

- **Recommendation:** have the generator emit `~`-relative paths into `.codex/config.toml` as the
  source already does, and change that one test fixture to `/Users/dev/...` to match its neighbours.
  Same commit as `P17`.
- **Disposition (2026-09-22):** Fixed by no longer tracking `.codex/config.toml`, since the
  recommendation cannot work: Codex 0.155.1 refuses to start its network proxy on a `~`, `$HOME`,
  or relative socket entry (`invalid network.allow_unix_sockets[0]`, measured), and accepts only an
  absolute path, which names a login. `./agent setup` renders the file per machine with absolute paths, and with
  the clone's own Git directory in place of a hardcoded `~/code/tao-lang-2/.git`. `.codex/hooks.json`
  and `.codex/rules/tao.rules` stay tracked. The cost is that Codex's first session in a fresh
  clone runs on its default permissions until that session's start hook has run setup. The personal
  fixture now uses a neutral path, and a test fails if any tracked harness file names a home
  directory or a `<login>-state` segment.
- **Follow-up (2026-09-23):** An untracked config was absent when Codex opened a fresh managed
  worktree, and task creation failed before its setup hook could run. The config is tracked again so
  the startup profile exists at checkout time. Its two absolute socket entries are still specific to
  the machine that generated it; setup refreshes them for another machine and that diff needs review.
- **Follow-up (2026-09-25):** The tracked config names no login. The generator gives Codex only
  socket paths that are absolute in the source and name no one: the Watchman rule left both
  sandboxes, since file-watching dev loops now run on the host (`./agent unsandboxed app-dev`,
  `studio`, `studio-native`), and Docker keeps only `/var/run/docker.sock`, the login-free link
  Docker Desktop creates and Codex follows, beside the host operations `local-instantdb start` and
  `stop`. The shared Git directory is written home-relative (`~/code/tao-lang-2/.git`), so it holds
  for any login whose clone sits at that path. The test that no tracked harness file names a home
  directory covers `.codex/config.toml` again.

### P19 — `local.properties` — Low, already handled

Checked because `A10` names it. It is listed in `.gitignore`, has never appeared in any commit, and
is not present in the worktree. No action.

### P20 — Author identity on all 1,451 commits — Medium

Every commit in history is authored by `Marcus Westin <marcus.westin@gmail.com>`. Publishing the
repository publishes that name and personal address permanently and unremovably short of a history
rewrite.

One further personal reference appears in content:
`Docs/Roadmap/Declaration model spike/Implementation - Declaration model spike.md:30` uses
`let Marcus = Person { Name "Marcus", Age 37 }` as a code example, pairing the real first name with a
plausibly real age.

No other real email address is tracked. Every other address found is an `example.com`,
`example.test`, or `example.invalid` fixture.

- **Recommendation:** decide the pen-name question now, because it is the one finding that history
  makes irreversible. The pen name this audit found in use has since been replaced throughout this
  repository's prose by "the Developer"; if a single pen name is still meant to be the public
  identity, set `user.name` and `user.email` to the identity you want before the first public push and
  accept that history carries the old one — or,
  if it matters enough, rewrite author metadata across the 1,451 commits while the repository is
  still private, which is the only moment that is cheap. Separately, change the
  `Marcus` / `Age 37` example to a neutral name.

## D. Secrets and credential material

### P21 — `secrets/secrets.jsonc` is genuinely encrypted — Low, no action

Verified structurally, without decrypting anything. The file is 29 lines and holds exactly one
entry, `ANTHROPIC_API_KEY`, noted "Studio agent chat", added 2026-09-04 and updated 2026-09-07.

- The value is an `age` ciphertext — the payload begins
  `-----BEGIN AGE ENCRYPTED FILE-----` and is stored as a base64 line array.
- There is exactly one recipient, and it is a `piv-p256` recipient: an age identity held in a Secure
  Enclave. The file's own header states the consequence correctly — the identity lives in one Mac's
  hardware, so a copy of the file is useless to anyone who clones the repository.
- Key names, notes, and timestamps are deliberately left in plaintext, which is the right trade: it
  makes the file reviewable without decryption.

Publishing the ciphertext is safe. One operational note that is not a publication issue: a single
Secure-Enclave recipient means the secret is unrecoverable if that Mac is lost.

- **Recommendation:** publish as-is, and no rotation is needed on account of publication. Separately
  from `R2`, consider adding a second recipient — a backup identity held elsewhere — so the single
  hardware dependency is not also a single point of loss.

### P22 — History holds no credential material — Low, no action

Every blob in the repository was scanned, not just the current tree: 15,141 blobs across 1,448
commits, checked against two pattern sets.

- **High-confidence credential shapes** — Anthropic `sk-ant-`, OpenAI `sk-proj-`, AWS `AKIA`/`ASIA`,
  GitHub `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`, Slack `xox*`, Google `AIza`, npm, GitLab, SendGrid,
  Figma tokens, and PEM `-----BEGIN … PRIVATE KEY-----` blocks: **zero matches**.
- **Assigned-literal shapes** — any `key`/`secret`/`password`/`token`/`bearer` assigned an 8+
  character quoted literal, plus JWT shapes: **20 matches, all synthetic test fixtures**. Every one is
  a placeholder such as `token: 'secret-token'`, `token: 'dead-owner'`,
  `secret = 'do-not-reflect-this-token'`, or `Token: 'DesignTokens'`. No real value among them.
- **Credential-shaped filenames ever tracked** — no `.env`, `.pem`, `.p8`, `.cer`, `.p12`, `.key`,
  `.keystore`, `.jks`, `.mobileprovision`, service-account, or `local.properties` file has ever been
  committed. The only matches on the word are the secrets implementation itself
  (`packages/dev/dev-src/secrets/`, its test, and `secrets/secrets.jsonc`).

Both `.env.secrets` and `.env.local` are gitignored with explanatory comments, and the agent
permission policy denies reading `.env`, `~/.ssh`, `~/.aws`, and `~/.config/gh` at both the file-tool
and the sandbox layer.

- **Recommendation:** no action. Record this scan's date and scope so it does not have to be redone
  before launch, and re-run it as a pre-publication check if significant history lands between now
  and then. Note that `P15`'s recommendation to rotate the ASC key stands on identifier exposure, not
  on anything found here.

## E. License exposure

### P23 — AGPL-3.0 reaches inside every app built with Tao — High, and `R1`'s decision

`LICENSE` is the GNU Affero General Public License v3 and it covers the whole repository, including
`packages/apps/runtime` and `packages/apps/stdlib`. The mechanism by which that reaches an end user's app is
concrete, not theoretical: `packages/apps/expo-host/metro.config.cjs:76` resolves `@runtime/TR`
and `@tao/runtime` to the runtime's own TypeScript source, so Metro bundles AGPL-licensed code
directly into the shipped application. `packages/apps/expo-host/package.json:45` depends on
`tao-runtime` as a workspace package.

So a developer who builds a product with Tao ships AGPL code inside it, and AGPL §13's
network-interaction clause then reaches their product, not merely their toolchain. `R1` states this
and is right about it. Many developers stop reading at AGPL for anything that links into their own
work, and the audience `A3` is written for is precisely that group.

- **Recommendation:** this is `R1`'s call, not the audit's, and `R1`'s own recommendation — AGPL for
  the toolchain with a permissive runtime and stdlib — is well matched to what the code actually
  does, because the split falls exactly where the Metro resolver does. The audit adds only this: the
  decision must be made **before** the first public push, not after. A permissive relicensing of
  `packages/apps/runtime` and `packages/apps/stdlib` is trivial while the Developer is the sole copyright holder across
  all 1,451 commits, and becomes a consent-gathering exercise the moment there is a second
  contributor.

### P24 — The license is unattributed, undeclared, and truncated — High

Three separate defects in how the license is applied, all cheap to fix:

1. **No copyright holder is named anywhere.** `LICENSE` is the bare AGPL text; the only copyright
   line in it is the FSF's notice on the license document itself. No file in the repository carries a
   `Copyright (C) <year> <holder>` line for Tao.
2. **`LICENSE` is truncated.** It ends at section 17 and omits both `END OF TERMS AND CONDITIONS` and
   the "How to Apply These Terms to Your New Programs" appendix — the part that tells you to add the
   copyright line from (1).
3. **No package declares a license.** Not one `package.json` in the repository has a `license` field,
   and no source file anywhere carries an `SPDX-License-Identifier` header. `tao-runtime` and
   `tao-stdlib` would publish to npm as `UNLICENSED`-by-omission, which tooling reports as a licence
   unknown — the worst of both worlds, since it neither reassures a permissive user nor enforces
   copyleft.

There is also no root `README.md` at all, so nothing states the licence in prose either. That is
already `A3`'s job.

- **Recommendation:** fix all three in one commit, immediately after `R1` decides, and before
  publication. Restore the full AGPL text including the appendix; add the copyright line naming the
  holder `R1`/`P20` settle on; add `license` fields to every `package.json` reflecting the `R1` split
  (AGPL-3.0-only for toolchain packages, the chosen permissive identifier for `tao-runtime` and
  `tao-stdlib`); and add SPDX headers to source files in the packages whose licence differs from the
  repository root, so the split survives being copied out of context. Without (3) in particular, an
  `R1` decision to split the licence is invisible to everyone downstream.

## Method and limits

What was examined: the full tracked file list; `.rulesync/`, `agents/`, and every generated harness
adapter; `Roadmap.md` and all 101 files under `Docs/Roadmap/`; `secrets/secrets.jsonc` structurally;
and all 15,141 blobs reachable from all refs across 1,448 commits, for the two pattern sets in `P22`.
Emails, absolute home paths, device names, Apple team and bundle identifiers, InstantDB identifiers,
and UUIDs were swept across the working tree.

What was not examined, and why:

- **No secret was decrypted**, so `P21` verifies the encryption's form and recipient type, not that
  the plaintext behind it is what the note says.
- **`~/.ssh`, `~/.aws`, `~/.config/gh`, and `.env` files were not read**, per the task's constraint
  and the repository's own permission policy. Findings about them rest on the absence of any tracked
  file, never on their contents.
- **Binary blobs over 2 MB were skipped** by the history scan. This excludes only large assets and
  lockfiles, where a credential is implausible but not impossible.
- **Semantic sensitivity was judged, not measured.** Sections B and C rest on reading; another reader
  may draw the line elsewhere on `P11`, `P12`, and `P13` in particular.
- **`Docs/MVP Roadmap/Agent MVP Roadmap.md` and `Developer MVP Roadmap.md`** were first read from commit
  `e72efab2` before they reached `main`; they now sit beside this report.

Scan date: 2026-09-17. Refreshed twice against a moving `main`: on 2026-09-18 at `90df2153`, which
added the subagent-delegation surface (`P25`), and on 2026-09-19 at `801865ac`, which restructured the
developer-environment ledger (`P10`) and again moved the counts in sections A and B.

Both refreshes re-checked the substantive findings rather than only the numbers. `P15` (App Store
Connect identifiers in a tracked lock file), `P16` (`roPhone` on 76 lines across 12 files), `P17`
(the `ro-state` socket, now at `.rulesync/permissions.jsonc:184`), and `P24` (the truncated,
unattributed, undeclared license) all still hold exactly as written. Nothing `main` landed has fixed
any of them, and no new credential material entered the tree. `P17` and `P18` were fixed on
2026-09-22; see their dispositions.

Repository state: `feat/publication-audit-report-d93f40`.
