# Telling us what you ran into

Tao is a UI-app programming language. The only thing that tells us whether it is any good is what
happens when somebody sits down to build something with it, so that is what we ask about. There is
no bug-report form here on purpose: at this stage we learn more from an unfinished attempt with its
intent intact than from a reduced repro with the intent edited out.

Four doors, depending on how far you got:

| You | Where |
| --- | --- |
| Tried to build something and could not | [Issue: I tried to build something and could not](https://github.com/marcuswestin/tao-lang-2/issues/new?template=could-not-build-it.yml) |
| Read or wrote something that did not mean what you thought | [Issue: This confused me](https://github.com/marcuswestin/tao-lang-2/issues/new?template=this-confused-me.yml) |
| Can see the app you want, but not how Tao would say it | [Discussion: Ideas](https://github.com/marcuswestin/tao-lang-2/discussions/new?category=ideas) |
| Are not stuck yet, just unsure how to say something | [Discussion: Q&A](https://github.com/marcuswestin/tao-lang-2/discussions/new?category=q-a) |

If you cannot tell which one fits, pick either issue form. Sorting them is our job.

## What to include

Describe the app, not the construct. "A packing list where checking an item moves it to the bottom"
is a better first line than "a list with a sort predicate": the second one has already decided what
Tao should have offered you, and the first one leaves that to us.

Paste what you wrote as it was when you stopped. Invented syntax is welcome — Tao is designed from
how people want to say things, so a spelling that reads right and does not exist yet is a finding,
not a mistake.

## The environment fingerprint

Every form has an optional **Environment** field. If you are working in a checkout of this
repository, fill it in with:

```bash
./agent doctor --fingerprint
```

That prints a JSON block reporting your OS and architecture, the Tao commit you are on and whether
your tree is modified, the versions of `bun`, `node`, `git`, `just`, `dprint` and `watchman`, the
hash of the pinned toolchain profile and of the `bun.lock` and `devenv.lock` you built against, and
your Xcode version if you have one.

It contains no file paths, no home directory, no account name, no machine name, and no branch
name — by construction, not by scrubbing: every value is parsed out of a tool's output and kept
only if it already reads as a version, a hash, or a plain word, and anything else is dropped.
`packages/cli/dev-cli/dev-cli-tests/environment-fingerprint.test.ts` holds that to it. Read it before you paste
it if you would rather check for yourself.

Running `./agent doctor` on its own prints the full diagnosis of your checkout, which *does* name
your paths and branch — that one is for you, not for a report. The fingerprint is the part meant to
travel.

## Looking around first

`Docs/Spec/` is what Tao implements today, `Docs/Tutorials/` is the way in, and `Apps/` holds the
apps we build the language against. If any of them disagrees with what you saw, that disagreement is
worth one of the forms above.
