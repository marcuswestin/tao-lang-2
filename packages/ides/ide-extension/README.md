# Tao Lang for VS Code

Language support for `.tao` files in Visual Studio Code. The extension includes Tao syntax highlighting, diagnostics, formatting, go-to-definition, references, and source actions. It starts a bundled Tao language server for each workspace folder, so opening a Tao file does not require a separate `tao` executable.

## Install

The release-1 plan calls for **Tao Lang** in both the Visual Studio Code Marketplace and Open VSX;
publication and installation from either marketplace remain to be proved. For repository development,
run `./agent ide-extension-package` from the repository root, then run **Extensions: Install from
VSIX…** in VS Code and select the produced `.vsix` file.
VS Code 1.104 or newer is required.

Open a folder containing a Tao project and then open a `.tao` file. Diagnostics and navigation use that folder's Tao packages; a multi-root workspace keeps each folder's package context separate. The extension bundles the Tao standard library and runs without a repository checkout.

## Commands

- **Tao: Fix Source** formats and applies available source fixes.
- **Tao: Organize Source** organizes `use` statements and canonicalizes source.
- **Tao: Remove Unused Imports** removes unused `use` statements.
- **Tao: Move Renders Last** moves render statements to their canonical position.

The standalone `tao` CLI is a separate tool. Its planned first release creates, checks, tests, and
runs web apps; iOS Simulator arrives in release 2 and TestFlight shipping in release 5. See the
[repository README](../../../README.md) for current availability and checkout instructions.

## Licence

The packaged extension includes its licence in `LICENSE`.
