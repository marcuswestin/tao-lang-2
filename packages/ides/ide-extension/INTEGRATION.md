# Editor tooling integration seam

The extension source registers two public commands. The integration owner added these entries to `packages/ides/ide-extension/package.json` under `contributes.commands`:

```json
{ "command": "tao.showTooling", "title": "Tao: Show Tooling" },
{ "command": "tao.openTypeScriptConfig", "title": "Tao: Open TypeScript Config" }
```

Both command IDs are contributed to `contributes.menus.commandPalette` without an `editorLangId` condition. The origin-navigation command `tao.openSourceOrigin` is internal and needs no palette contribution. The manifest command-list test includes both entries.

The project tooling watcher imports `chokidar`; its shared dependency manifest and lock change belong to the integration owner after dependency approval. Do not replace its watcher in the extension.

The packaging implementation stages runtime source under `_gen/runtime`, dereferenced host TypeScript peers under `_gen/host/node_modules`, and TypeScript declaration libraries alongside the extension bundle. The resource helper checks the copied package closure and rejects escaping file links. Focused resource tests pass; the actual VSIX build and installed editor diagnostics, navigation, and watcher behavior still require acceptance after the dependency step.
