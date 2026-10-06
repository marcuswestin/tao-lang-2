# Telling us what you ran into

Tao is a UI-app programming language. The only thing that tells us whether it is any good is what
happens when somebody sits down to build something with it, so that is what we ask about. There is
no bug-report form here on purpose: at this stage we learn more from an unfinished attempt with its
intent intact than from a reduced repro with the intent edited out.

Four doors, depending on how far you got:

| You | Where |
| --- | --- |
| Tried to build something and could not | [Issue: I tried to build something and could not](https://github.com/tao-dev-org/tao-lang/issues/new?template=could-not-build-it.yml) |
| Read or wrote something that did not mean what you thought | [Issue: This confused me](https://github.com/tao-dev-org/tao-lang/issues/new?template=this-confused-me.yml) |
| Can see the app you want, but not how Tao would say it | [Discussion: Ideas](https://github.com/tao-dev-org/tao-lang/discussions/new?category=ideas) |
| Are not stuck yet, just unsure how to say something | [Discussion: Q&A](https://github.com/tao-dev-org/tao-lang/discussions/new?category=q-a) |

If you cannot tell which one fits, pick either issue form. Sorting them is our job.

## What to include

Describe the app, not the construct. "A packing list where checking an item moves it to the bottom"
is a better first line than "a list with a sort predicate": the second one has already decided what
Tao should have offered you, and the first one leaves that to us.

Paste what you wrote as it was when you stopped. Invented syntax is welcome — Tao is designed from
how people want to say things, so a spelling that reads right and does not exist yet is a finding,
not a mistake.

## The environment fingerprint

Every form has an optional **Environment** field. From an installed Tao CLI, fill it in with:

```bash
tao doctor --fingerprint
```

That prints a JSON block reporting your OS and architecture, Tao release version, available `bun`
and `node` versions, the installed resource bundle hash, and Xcode if present. `tao bug-report`
prepares a short draft and links to the issue forms with the same fingerprint ready to paste.

It contains no file paths, home directory, account name, or machine name. Host tool output is
accepted only in known version, platform, and hash shapes; anything else is dropped. Read it before
you paste it if you would rather check for yourself.

For repository contributors, `./agent doctor` still prints a fuller checkout diagnosis that names
paths and branch. Use only its `--fingerprint` output in a public report.

## Looking around first

`Docs/Spec/` is what Tao implements today, `Docs/Tutorials/` is the way in, and `Apps/` holds the
apps we build the language against. If any of them disagrees with what you saw, that disagreement is
worth one of the forms above.

## Sending a change

A pull request is merged once its author has accepted the
[Tao Contributor License Agreement](../CLA.md). Post this in the pull request's description or a
comment, once; it covers every later contribution too, and the "Contributor agreement" check on your
pull request turns green when it finds it:

> I have read the Tao Contributor License Agreement, version 1.0, and I agree to it.

You keep the copyright in what you contribute. The agreement lets the maintainer license Tao, your
contribution included, under any terms, which is what lets apps built with Tao stay yours under the
[Tao Application Exception](../LICENSE-APP-EXCEPTION.md).
