# Publishing Tao Lang for VS Code

The first public release waits for the app-safe licence structure in
`Docs/MVP Roadmap/Developer MVP Roadmap.md` R1 and for the extension/standalone-CLI version relationship
in A6. The repository's current `AGPL-3.0-only` package is a local release candidate, not approval
to publish it.

The 2026-09-24 `R12` decision parks account-dependent Marketplace and Open VSX publication and
listing checks until the near-release pass. The guarded commands below remain available for that
pass. Local VSIX packaging, isolated installation, and editor acceptance can continue now; public
release readiness still requires both listings.

## One-time accounts and identity

1. The publisher ID is `dev-tao`, with `tao-lang` as the fallback if it is taken (decided
   2026-09-24). The ID appears in extension URLs and cannot be renamed in the VS Code Marketplace. The
   extension's `publisher` in `package.json` must equal that ID in both registries, and already says
   `dev-tao`. Check that `tao-ide-extension` and the display name `Tao Lang` are accepted by
   Marketplace.
2. In [Marketplace publisher management](https://marketplace.visualstudio.com/manage/publishers/),
   sign in with a Microsoft account and create that publisher. Create an Azure DevOps organization
   and a short-lived token with **Marketplace (Manage)** scope for **All accessible organizations**;
   export it as `VSCE_PAT` in the release terminal. Microsoft's current documentation says global
   Azure DevOps PATs retire on December 1, 2026; plan to move publishing to Entra/OIDC before then.
3. At [Open VSX](https://open-vsx.org/), sign in with the same GitHub account associated with an
   Eclipse account, sign the publisher agreement, create a token, and export it as `OVSX_PAT`.
   Create the namespace matching `publisher` with `bunx ovsx create-namespace <publisher>` or join
   it if someone already owns it. Claim namespace ownership to show the extension as verified.
   Never put either token in a command argument, source file, or tracked environment file.

## Per-version operator steps

Run from an ordinary host terminal after the release source is committed and the final licence is
applied:

```bash
./agent unsandboxed prepare-release ide-extension
# Inspect the VSIX and open a .tao file in the isolated VS Code profile named by the command.
just ide-extension-release-publish
```

Preparation builds one minified VSIX and installs it into a fresh VS Code user-data and extensions
directory, then verifies VS Code lists the exact publisher, name, and version. If `code` is not on
`PATH` or in the standard macOS app location, set `TAO_VSCODE_CLI` to its executable path.
Publication checks that the same VSIX and source commit remain, then uploads those exact bytes to
Marketplace with `@vscode/vsce` and Open VSX with `ovsx`. Both tools read their token from the
environment. Inspect both public listings before announcing the release.

If Marketplace upload succeeds but Open VSX fails, retry only Open VSX with
`just ide-extension-release-publish open-vsx`; `marketplace` similarly retries only Marketplace.
The existing `just ide-extension-package` and `just install-ide-extension` are lower-level local
commands and do not publish anything.
