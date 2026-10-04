# Tao Lang for VS Code

Language support for `.tao` files in Visual Studio Code. The extension includes Tao syntax highlighting, diagnostics, formatting, go-to-definition, references, and source actions. It starts a bundled Tao language server for each workspace folder, so opening a Tao file does not require a separate `tao` executable.

## Install

Install **Tao Lang** from the Visual Studio Code Marketplace or Open VSX. For a local package, run **Extensions: Install from VSIX…** in VS Code and select the `.vsix` file. VS Code 1.104 or newer is required.

Open a folder containing a Tao project and then open a `.tao` file. Diagnostics and navigation use that folder's Tao packages; a multi-root workspace keeps each folder's package context separate. The extension bundles the Tao standard library and runs without a repository checkout.

For a project marked by a `.tao` directory, saved source files also produce TypeScript contracts in `.tao-ts`. The Explorer hides that project's root `tsconfig.json` and `node_modules` entries while keeping their files available to TypeScript. A stale-contract indicator means the last good contracts remain on disk and the current errors are shown. Tao editing diagnostics continue to work on unsaved text.

## Commands

- **Tao: Fix Source** formats and applies available source fixes.
- **Tao: Organize Source** organizes `use` statements and canonicalizes source.
- **Tao: Remove Unused Imports** removes unused `use` statements.
- **Tao: Move Renders Last** moves render statements to their canonical position.
- **Tao: Show Tooling** reveals the current project's root TypeScript config and `node_modules` in Explorer.
- **Tao: Open TypeScript Config** opens the current project's root config, which extends Tao's generated base config.

Command-click a mapped declaration in a generated `.tao-ts` contract to open its exact Tao source declaration.

The standalone `tao` CLI is a separate tool for creating, running, testing, and shipping apps. See the [Tao repository](https://github.com/marcuswestin/tao-lang-2) for its current availability and documentation.

## Licence

The packaged extension includes its licence in `LICENSE`.
