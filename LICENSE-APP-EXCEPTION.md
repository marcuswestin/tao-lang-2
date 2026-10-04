# Tao Application Exception

Version 1.0, 4 October 2026

Copyright (C) 2026 Marcus Westin

This is an additional permission under section 7 of the GNU Affero General Public License, version 3
(the "AGPL"). It accompanies the AGPL in [LICENSE](LICENSE) and applies to Tao as distributed from
this repository.

Tao is a programming language and the tools that build apps written in it. The apps people build
with Tao belong to the people who build them. The AGPL governs Tao itself; this exception makes sure
it never reaches into an app because Tao was used to build it.

## 1. Definitions

- **"Tao"** is the software in this repository, the "Program" of the AGPL.
- **"Your Code"** is everything you author for an application: Tao source, TypeScript, native code,
  assets, configuration, and anything else you write or obtain from someone other than Tao.
- **"Output"** is whatever Tao's tools produce from Your Code: compiled TypeScript or TSX, bundles,
  native projects, binaries, generated bindings, and code produced by Tao's code-generation and
  AI-assisted tools.
- **"Runtime Material"** is any part of Tao that Tao's tools compile, copy, bundle, link, or generate
  into an application or its build output in the ordinary course of building, running, testing, or
  shipping it. It includes at least `packages/apps/runtime`, `packages/apps/stdlib`,
  `packages/apps/expo-host`, `packages/apps/native-bindings`, and `packages/apps/providers`.
- **"Example Material"** is the code samples in `Docs/`, the project starters in `Apps/Starters`, and
  any template Tao's tools copy into a new project.
- **"Excluded Work"** is software whose primary purpose is to provide the functionality of Tao
  itself: a programming language implementation, compiler, language server, editor or development
  environment, a build, preview, or deployment tool or service for apps, or any other product that
  substitutes for Tao or a part of it, whether or not that software is itself built with Tao.
- **"Your Application"** is software you create using Tao, consisting of Your Code, Output, Runtime
  Material, and Example Material, that is not an Excluded Work.

## 2. Ownership

Nothing in Tao's license claims any right, title, or interest in Your Code, Output, or Your
Application. They belong to you, or to whomever they would belong to had you not used Tao. Using Tao's
tools to build, run, test, or ship an application places no obligation on that application.

## 3. Permission

You may use, copy, modify, distribute, sell, license, and offer over a network Your Application, in
whole or in part, under terms of your choice, without being bound by the AGPL with respect to:

1. Your Code and Output;
2. Runtime Material included in Your Application, either unmodified or as modified by Tao's own
   tools; and
3. Example Material you copied into Your Application, whether or not you modified it.

In particular you need not license Your Application under the AGPL, provide or offer its source code,
or give the notice of section 13 of the AGPL to its users, and you may keep it entirely proprietary.
Third-party components in Your Application remain under their own licenses.

## 4. Runtime Material you change yourself

If you modify Runtime Material yourself, other than through Tao's own tools, the files you modified
remain under the AGPL, and you must make those modified files available under it, including to users
who interact with Your Application over a network. That obligation covers only the modified Runtime
Material files. For the purposes of the AGPL, the rest of Your Application, including Your Code and
Output, is not part of the covered work and is never its Corresponding Source.

## 5. What this exception does not cover

1. It grants nothing for an Excluded Work. Tao's toolchain, Studio, IDE extensions, and every other
   part of Tao that is not Runtime Material or Example Material stay under the AGPL alone, wherever
   they are used or distributed.
2. It grants no right to Tao's names, logos, or other marks.

## 6. Modified versions of Tao

When you convey a modified version of Tao, you may extend this exception to your modified version,
but you are not obligated to do so. If you remove it, your modified version is under the AGPL alone,
and this exception continues to apply to applications built with the versions of Tao that carried it.
