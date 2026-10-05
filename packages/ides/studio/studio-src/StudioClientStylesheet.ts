/** The Studio workbench stylesheet, inlined into the shell page `StudioClientAssets` serves. */
export const studioClientStylesheet = `
/* Tao Studio workbench stylesheet. One token sheet at the top; every rule below reads it. */
:root {
  --studio-accent: #ff6a1f;
  --studio-accent-ink: #140800;
  --studio-accent-soft: rgba(255, 106, 31, .16);
  --studio-accent-strong: #ff8a4c;
  --studio-accent-surface: rgba(255, 106, 31, .12);
  --studio-bezel: #000000;
  --studio-bg: #0f0f0f;
  --studio-bg-deep: #090909;
  --studio-canvas: #0a0a0a;
  --studio-divider: #262626;
  --studio-divider-active: #ff6a1f;
  --studio-error: #ff5c5c;
  --studio-info: #5aa9ff;
  --studio-panel: #151515;
  --studio-panel-raised: #1e1e1e;
  --studio-positive: #4ade80;
  --studio-stroke: #262626;
  --studio-stroke-strong: #363636;
  --studio-surface-active: #2a2a2a;
  --studio-surface-hover: #232323;
  --studio-text: #f4f4f4;
  --studio-text-dim: #8a8a8a;
  --studio-text-muted: #a3a3a3;
  --studio-warning: #fbbf24;
  --studio-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", ui-sans-serif, system-ui, "Segoe UI", sans-serif;
  --studio-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace;
  --studio-radius: 4px;
  --studio-radius-lg: 7px;
  background: var(--studio-bg);
  color: var(--studio-text);
  color-scheme: dark;
  font: 12px/1.45 var(--studio-font);
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; scrollbar-color: var(--studio-stroke-strong) transparent; scrollbar-width: thin; }
[hidden] { display: none !important; }
html, body, #tao-studio-root, #tao-studio-viewport { background: var(--studio-bg); height: 100%; margin: 0; width: 100%; }
#tao-studio-root, #tao-studio-viewport { inset: 0; position: fixed; }
#tao-studio-viewport { pointer-events: none; }
body { overflow: hidden; }
::selection { background: var(--studio-accent-soft); color: var(--studio-text); }
.tao-studio-product-host {
  bottom: 0 !important; height: auto !important; left: 0 !important; min-height: 0; min-width: 0;
  overflow: clip; pointer-events: auto; position: fixed !important; right: 0 !important; top: 0 !important;
  width: auto !important;
}
button, input, select, textarea { font: inherit; }
button { color: inherit; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--studio-accent); outline-offset: 1px;
}
kbd {
  background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke-strong); border-radius: 3px;
  color: var(--studio-text-muted); font: 500 10px/1 var(--studio-mono); padding: 2px 4px;
}

/* ---------- shared controls ---------- */
.studio-button {
  align-items: center; background: transparent; border: 1px solid transparent; border-radius: var(--studio-radius);
  color: var(--studio-text); cursor: pointer; display: inline-flex; font-weight: 500; gap: 6px; height: 26px;
  justify-content: center; min-width: 0; padding: 0 10px; white-space: nowrap;
}
.studio-button[data-variant="primary"] { background: var(--studio-accent); color: var(--studio-accent-ink); }
.studio-button[data-variant="primary"]:hover:not(:disabled) { background: var(--studio-accent-strong); }
.studio-button[data-variant="secondary"] { background: var(--studio-panel-raised); border-color: var(--studio-stroke-strong); }
.studio-button[data-variant="secondary"]:hover:not(:disabled) { background: var(--studio-surface-hover); }
.studio-button[data-variant="ghost"] { color: var(--studio-text-muted); }
.studio-button[data-variant="ghost"]:hover:not(:disabled) { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-button[data-variant="danger"] { color: var(--studio-error); }
.studio-button[data-variant="danger"]:hover:not(:disabled) { background: rgba(255, 92, 92, .12); }
.studio-button:disabled { cursor: default; opacity: .45; }
.studio-button[data-size="small"] { font-size: 11.5px; height: 24px; padding: 0 9px; }
.studio-icon-button {
  align-items: center; background: transparent; border: 0; border-radius: var(--studio-radius); color: var(--studio-text-dim);
  cursor: pointer; display: inline-flex; height: 24px; justify-content: center; padding: 0; width: 24px;
}
.studio-icon-button:hover:not(:disabled) { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-icon-button:disabled { cursor: default; opacity: .4; }
.studio-icon { fill: none; flex: none; height: 16px; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; width: 16px; }
.studio-icon[data-size="small"] { height: 13px; width: 13px; }
.studio-segmented {
  background: var(--studio-bg-deep); border: 1px solid var(--studio-stroke); border-radius: var(--studio-radius);
  display: flex; gap: 2px; padding: 2px;
}
.studio-segmented > button {
  background: transparent; border: 0; border-radius: 3px; color: var(--studio-text-muted); cursor: pointer; flex: 1 1 0;
  font-weight: 500; height: 22px; min-width: 0; overflow: hidden; padding: 0 6px; text-overflow: ellipsis; white-space: nowrap;
}
.studio-segmented > button:hover { color: var(--studio-text); }
.studio-segmented > button[aria-checked="true"], .studio-segmented > button[aria-current="true"], .studio-segmented > button[aria-selected="true"] {
  background: var(--studio-surface-active); box-shadow: 0 0 0 1px var(--studio-stroke-strong); color: var(--studio-text);
}
.studio-segmented[data-size="small"] > button { font-size: 11px; height: 20px; }
.studio-input, .studio-select {
  background: var(--studio-bg-deep); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius);
  color: var(--studio-text); height: 26px; min-width: 0; padding: 0 8px; width: 100%;
}
.studio-input[type="number"] { font-family: var(--studio-mono); }
.studio-input::placeholder { color: var(--studio-text-dim); }
.studio-input[aria-invalid="true"] { border-color: var(--studio-error); }
.studio-select { appearance: none; -webkit-appearance: none; background-image: linear-gradient(45deg, transparent 50%, var(--studio-text-dim) 50%), linear-gradient(135deg, var(--studio-text-dim) 50%, transparent 50%); background-position: calc(100% - 13px) 11px, calc(100% - 9px) 11px; background-repeat: no-repeat; background-size: 4px 4px; cursor: pointer; padding-right: 22px; }
.studio-switch { align-items: center; color: var(--studio-text-muted); cursor: pointer; display: inline-flex; gap: 7px; }
.studio-switch input { appearance: none; -webkit-appearance: none; background: var(--studio-stroke-strong); border: 0; border-radius: 8px; cursor: pointer; height: 15px; margin: 0; position: relative; transition: background 120ms ease; width: 26px; }
.studio-switch input::after { background: var(--studio-panel); border-radius: 50%; content: ""; height: 11px; left: 2px; position: absolute; top: 2px; transition: left 120ms ease; width: 11px; }
.studio-switch input:checked { background: var(--studio-accent); }
.studio-switch input:checked::after { left: 13px; }
.studio-switch input:disabled { cursor: default; opacity: .4; }
.studio-file-kind {
  background: var(--studio-panel-raised); border-radius: 3px; color: var(--studio-text-dim); flex: none;
  font: 600 9px/1 var(--studio-mono); letter-spacing: .02em; padding: 3px 4px; text-transform: lowercase;
}
.studio-file-icon { color: var(--studio-accent-strong); flex: none; height: 16px; width: 16px; }
.studio-section { border-top: 1px solid var(--studio-stroke); }
.studio-section > summary {
  align-items: center; color: var(--studio-text); cursor: pointer; display: flex; font-size: 11.5px; font-weight: 600; gap: 6px;
  height: 32px; list-style: none; padding: 0 12px 0 10px; user-select: none;
}
.studio-section > summary::-webkit-details-marker { display: none; }
.studio-section > summary::before {
  border-color: var(--studio-text-dim); border-style: solid; border-width: 0 1.5px 1.5px 0; content: ""; height: 5px;
  margin: -2px 3px 0 1px; transform: rotate(-45deg); transition: transform 120ms ease; width: 5px;
}
.studio-section[open] > summary::before { margin-top: -4px; transform: rotate(45deg); }
.studio-section-body { display: grid; gap: 6px; padding: 0 12px 12px; }
.studio-section-body > .studio-button, .studio-inspector-controls > .studio-button, .studio-section-body > .studio-preview-cell-replay-load { justify-self: start; }
.studio-section-body > .studio-preview-cell-replay-load { cursor: pointer; display: inline-flex; font-size: 11.5px; height: 24px; }
.studio-field-row { align-items: center; color: var(--studio-text-muted); display: grid; font-size: 11.5px; gap: 8px; grid-template-columns: 72px minmax(0, 1fr); min-width: 0; }
.studio-field-row > .studio-field-row-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-field-row > .studio-field-row-inputs { align-items: center; display: flex; gap: 6px; min-width: 0; }
.studio-field-row > .studio-field-row-inputs > .studio-inspector-field { flex: 1 1 0; grid-template-columns: minmax(0, 1fr); min-width: 0; position: relative; }
.studio-field-row > .studio-field-row-inputs > .studio-inspector-field > span:first-child { display: none; }
.studio-field-row > .studio-field-row-inputs > .studio-inspector-field + .studio-inspector-field { margin-left: 12px; }
.studio-field-row > .studio-field-row-inputs > .studio-inspector-field + .studio-inspector-field::before { color: var(--studio-text-dim); content: "×"; left: -14px; position: absolute; top: 50%; transform: translateY(-50%); }
.studio-note { color: var(--studio-text-dim); font-size: 11px; line-height: 1.4; }
.studio-actions { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 4px; }

/* ---------- shell frame ---------- */
.studio-shell {
  background: var(--studio-bg); display: grid; grid-template-rows: 48px minmax(0, 1fr); height: 100%; inset: 0;
  min-height: 0; min-width: 0; position: fixed; width: 100%;
}
.studio-toolbar {
  align-items: center; background: var(--studio-panel); border-bottom: 1px solid var(--studio-stroke); display: grid; gap: 14px;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); min-width: 0; padding: 0 12px;
}
.studio-toolbar-context, .studio-toolbar-mode, .studio-toolbar-actions { align-items: center; display: flex; min-width: 0; }
.studio-toolbar-context { gap: 6px; }
.studio-toolbar-mode { gap: 10px; justify-self: center; }
.studio-toolbar-actions { gap: 8px; justify-content: flex-end; justify-self: stretch; }
.studio-window-controls { align-items: center; display: flex; flex: none; gap: 8px; margin: 0 10px 0 2px; }
.studio-window-controls i { border-radius: 50%; display: block; height: 12px; width: 12px; }
.studio-window-controls i:nth-child(1) { background: #ff5f57; }
.studio-window-controls i:nth-child(2) { background: #febc2e; }
.studio-window-controls i:nth-child(3) { background: #28c840; }
.studio-wordmark { align-items: center; display: inline-flex; flex: none; gap: 7px; margin-right: 4px; }
.studio-wordmark i {
  align-items: center; background: var(--studio-text); border-radius: 6px; color: var(--studio-bg); display: inline-flex;
  font: 700 12px/1 var(--studio-font); height: 20px; justify-content: center; width: 20px;
}
.studio-wordmark b { font-weight: 600; letter-spacing: -.01em; }
.studio-toolbar-separator { color: var(--studio-text-dim); flex: none; }
.studio-picker { background: transparent; border: 0; color: var(--studio-text-muted); cursor: pointer; max-width: 260px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-project {
  appearance: none; -webkit-appearance: none; background: transparent; border: 0; color: var(--studio-text); cursor: pointer;
  font-weight: 600; max-width: 260px; padding: 0 4px;
}
.studio-project:not(:disabled) {
  background-image: linear-gradient(45deg, transparent 50%, var(--studio-text-dim) 50%), linear-gradient(135deg, var(--studio-text-dim) 50%, transparent 50%);
  background-position: calc(100% - 9px) 9px, calc(100% - 5px) 9px; background-repeat: no-repeat; background-size: 4px 4px; padding-right: 18px;
}
.studio-project:disabled { cursor: default; opacity: 1; }
.studio-project:hover, .studio-app-picker:hover:not(:disabled) { color: var(--studio-accent-strong); }
.studio-app-picker {
  appearance: none; -webkit-appearance: none; background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke-strong);
  border-radius: var(--studio-radius); color: var(--studio-text); height: 24px; max-width: 200px; padding: 0 8px;
}
.studio-app-picker:disabled { background: transparent; border-color: transparent; color: var(--studio-text-muted); }
.studio-layout-presets { background: var(--studio-bg-deep); border: 1px solid var(--studio-stroke); border-radius: var(--studio-radius); display: flex; gap: 2px; padding: 2px; }
.studio-layout-presets button { background: transparent; border: 0; border-radius: 3px; color: var(--studio-text-muted); cursor: pointer; font-weight: 500; height: 24px; min-width: 60px; padding: 0 12px; }
.studio-layout-presets button:hover { color: var(--studio-text); }
.studio-layout-presets button[aria-current="true"] { background: var(--studio-surface-active); box-shadow: 0 0 0 1px var(--studio-stroke-strong); color: var(--studio-text); }
.studio-command-palette {
  align-items: center; background: var(--studio-bg-deep); border: 1px solid var(--studio-stroke); border-radius: var(--studio-radius);
  color: var(--studio-text-dim); cursor: text; display: inline-flex; gap: 8px; height: 28px; padding: 0 7px 0 9px; width: 250px;
}
.studio-command-palette:hover { border-color: var(--studio-stroke-strong); color: var(--studio-text-muted); }
.studio-command-palette > span { flex: 1; min-width: 0; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.studio-status {
  align-items: center; background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke-strong); border-radius: 12px;
  color: var(--studio-text-muted); display: flex; font-size: 11px; gap: 7px; height: 24px; margin-right: 2px; max-width: min(420px, 30vw);
  min-width: 0; overflow: hidden; padding: 0 10px 0 9px; text-overflow: ellipsis; white-space: nowrap;
}
.studio-status::before { background: var(--studio-text-dim); border-radius: 50%; content: ""; flex: none; height: 7px; width: 7px; }
.studio-status[data-state="compiled"] { color: var(--studio-text); }
.studio-status[data-state="compiled"]::before { background: var(--studio-positive); box-shadow: 0 0 0 3px rgba(74, 222, 128, .18); }
.studio-status[data-state="compiling"]::before { background: var(--studio-info); }
.studio-status[data-state="error"] { border-color: rgba(255, 92, 92, .35); color: var(--studio-error); }
.studio-status[data-state="error"]::before { background: var(--studio-error); box-shadow: 0 0 0 3px rgba(255, 92, 92, .18); }
.studio-status[data-phone-unsynced-revision] { border-color: var(--studio-warning); }
.studio-status[data-phone-unsynced-revision]::after { color: var(--studio-warning); content: "Phone unsynced"; flex: none; }
.studio-status-diagnostic {
  background: transparent; border: 0; color: inherit; cursor: pointer; max-width: 100%; overflow: hidden; padding: 0;
  text-align: left; text-overflow: ellipsis; white-space: nowrap;
}
.studio-status-diagnostic:hover { text-decoration: underline; text-underline-offset: 3px; }
.studio-device, .studio-interaction-mode, .studio-reload, .studio-beta-ship, .studio-canvas-focus {
  align-items: center; background: transparent; border: 1px solid transparent; border-radius: var(--studio-radius);
  color: var(--studio-text-muted); cursor: pointer; display: inline-flex; font-weight: 500; gap: 6px; height: 26px; padding: 0 9px; white-space: nowrap;
}
.studio-device:hover, .studio-interaction-mode:hover, .studio-reload:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-device[aria-expanded="true"] { background: var(--studio-accent-surface); color: var(--studio-text); }
.studio-device[data-state="connected"] { color: var(--studio-positive); }
.studio-device[data-state="pairing"] { color: var(--studio-warning); }
.studio-device[data-state="behind"] { color: var(--studio-error); }
.studio-interaction-mode { background: var(--studio-bg-deep); border-color: var(--studio-stroke); }
.studio-interaction-mode::before { border-radius: 50%; content: ""; flex: none; height: 7px; width: 7px; }
.studio-interaction-mode[data-mode="edit"] { color: var(--studio-text); }
.studio-interaction-mode[data-mode="edit"]::before { background: var(--studio-accent); }
.studio-interaction-mode[data-mode="run"] { color: var(--studio-text); }
.studio-interaction-mode[data-mode="run"]::before { background: var(--studio-positive); }
.studio-reload { padding: 0; width: 26px; }
.studio-beta-ship { background: var(--studio-accent); color: var(--studio-accent-ink); font-weight: 600; }
.studio-beta-ship:hover:not(:disabled) { background: var(--studio-accent-strong); }
.studio-beta-ship:disabled { cursor: wait; opacity: .6; }

.studio-body {
  --studio-left-size: 260px; --studio-right-size: 280px;
  background: var(--studio-bg); display: grid; grid-template-columns: 44px var(--studio-left-size) 4px minmax(420px, 1fr);
  min-height: 0; min-width: 0;
}
/* Each pane names its column. A collapsed pane is hidden, which takes it out of the grid entirely,
   and auto-placement would then shift every pane after it one column to the left. */
.studio-rail { grid-column: 1; }
.studio-pane-left { grid-column: 2; }
.studio-divider-left { grid-column: 3; }
.studio-center { grid-column: 4; }
.studio-rail { align-items: center; background: var(--studio-panel); border-right: 1px solid var(--studio-stroke); display: flex; flex-direction: column; gap: 4px; padding: 0 0 8px; }
.studio-rail-button {
  align-items: center; background: transparent; border: 0; border-radius: var(--studio-radius); color: var(--studio-text-dim); cursor: pointer;
  display: inline-flex; height: 32px; justify-content: center; position: relative; width: 32px;
}
.studio-rail-button .studio-icon { height: 17px; width: 17px; }
.studio-rail-button::before { background: transparent; border-radius: 0 2px 2px 0; bottom: 8px; content: ""; left: -6px; position: absolute; top: 8px; width: 2px; }
.studio-rail-button:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-rail-button[aria-current="true"], .studio-search-button[aria-pressed="true"] { background: var(--studio-surface-active); color: var(--studio-text); }
.studio-rail-button[aria-current="true"]::before, .studio-search-button[aria-pressed="true"]::before { background: var(--studio-accent); }
.studio-rail-separator { background: var(--studio-stroke); border: 0; display: block; flex: none; height: 1px; margin: 4px 0; width: 32px; }
.studio-rail-spacer { flex: 1; }
.studio-search-affordance {
  align-items: center; border-bottom: 1px solid var(--studio-stroke); display: flex; flex: none; height: 36px;
  justify-content: center; width: 100%;
}
.studio-search-field {
  align-items: center; border-bottom: 1px solid var(--studio-stroke); display: flex; height: 36px; min-width: 0; padding: 0 8px;
}
.studio-search-field .studio-search-input { flex: 1; min-width: 0; width: 100%; }
.studio-sidebar { background: var(--studio-panel); display: grid; grid-template-rows: auto auto minmax(0, 1fr); min-height: 0; min-width: 0; }
.studio-sidebar[data-search-open] { grid-template-rows: auto minmax(0, 1fr); }
.studio-sidebar > .studio-left-panel { min-height: 0; overflow: auto; }
.studio-pane-header {
  align-items: center; background: var(--studio-panel); border-bottom: 1px solid var(--studio-stroke); display: flex; gap: 8px; height: 36px;
  justify-content: space-between; padding: 0 8px 0 12px;
}
.studio-pane-header strong { color: var(--studio-text); font-size: 12px; font-weight: 600; }
.studio-pane-header button {
  align-items: center; background: transparent; border: 0; border-radius: var(--studio-radius); color: var(--studio-text-dim); cursor: pointer;
  display: inline-flex; font-size: 16px; height: 24px; justify-content: center; line-height: 1; width: 24px;
}
.studio-pane-header button:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-divider { background: transparent; position: relative; z-index: 2; }
.studio-divider::before { background: var(--studio-divider); content: ""; inset: 0 1px; position: absolute; transition: background 120ms ease; }
.studio-divider-bottom::before { inset: 1px 0; }
.studio-divider:hover::before, .studio-divider:active::before { background: var(--studio-divider-active); }
.studio-divider::after { content: ""; inset: -4px; position: absolute; }
.studio-divider-left, .studio-divider-right, .studio-divider-preview { cursor: col-resize; }
.studio-divider-bottom { cursor: row-resize; }
.studio-center {
  --studio-bottom-size: 180px; --studio-preview-size: 440px; background: var(--studio-bg); display: grid;
  grid-template-columns: var(--studio-right-size) 4px minmax(360px, 1fr) 4px minmax(280px, var(--studio-preview-size));
  grid-template-rows: minmax(240px, 1fr) 4px var(--studio-bottom-size); min-height: 0; min-width: 0;
}
.studio-workbench { display: contents; }
.studio-editor-pane { grid-column: 3; grid-row: 1; }
.studio-divider-preview { grid-column: 4; grid-row: 1 / 4; }
.studio-preview { grid-column: 5; grid-row: 1 / 4; }
.studio-inspector { grid-column: 1; grid-row: 1; }
.studio-divider-right { grid-column: 2; grid-row: 1 / 4; }
.studio-divider-bottom { grid-column: 1 / 4; grid-row: 2; }
.studio-drawer { grid-column: 1 / 4; grid-row: 3; }
/* Design mode makes the canvas the hero: it takes half the workbench, with the divider still free
   to change that, so several views are visible around each other while the source stays in reach. */
/* The canvas track is a fixed size rather than a maximum: beside a fraction-sized editor a minmax
   track never grows past its floor, because free space is spent on the fraction first. */
.tao-studio-product-host[data-layout-preset="design"] .studio-center {
  grid-template-columns: var(--studio-right-size) 4px minmax(240px, 1fr) 4px var(--studio-preview-size);
}
.tao-studio-product-host[data-layout-preset="code"] .studio-center { grid-template-columns: 0 0 minmax(420px, 1fr) 0 0; }
.tao-studio-product-host[data-layout-preset="code"] .studio-preview,
.tao-studio-product-host[data-layout-preset="code"] .studio-divider-preview,
.tao-studio-product-host[data-layout-preset="code"] .studio-inspector,
.tao-studio-product-host[data-layout-preset="code"] .studio-divider-right { display: none; }
.tao-studio-product-host[data-layout-preset="run"] .studio-center { grid-template-columns: 0 0 0 0 minmax(420px, 1fr); grid-template-rows: minmax(0, 1fr); }
.tao-studio-product-host[data-layout-preset="run"] .studio-editor-pane,
.tao-studio-product-host[data-layout-preset="run"] .studio-inspector,
.tao-studio-product-host[data-layout-preset="run"] .studio-divider-right,
.tao-studio-product-host[data-layout-preset="run"] .studio-divider-preview,
.tao-studio-product-host[data-layout-preset="run"] .studio-divider-bottom,
.tao-studio-product-host[data-layout-preset="run"] .studio-drawer,
.tao-studio-product-host[data-layout-preset="draw"] .studio-divider-bottom,
.tao-studio-product-host[data-layout-preset="draw"] .studio-drawer { display: none; }
.tao-studio-product-host[data-layout-preset="run"] .studio-preview { grid-column: 1 / 6; grid-row: 1; }
/* Draw is the workbench frame: code on the left with the view's inputs pinned under it, the canvas in
   the middle, and the whole inspector on the right. The inspector's two panes are placed apart by
   letting the aside dissolve into the grid, so no mounted pane moves in the DOM. The preview size
   is the code column here and both side dividers are mirrored (StudioShell). The percentage caps only
   guard a shrinking window; a drag is clamped in StudioShell so the canvas keeps its floor. */
.tao-studio-product-host[data-layout-preset="draw"] .studio-center {
  grid-template-columns:
    min(var(--studio-preview-size), 55%) 4px minmax(320px, 1fr) 4px min(var(--studio-right-size), 45%);
  grid-template-rows: minmax(160px, 1fr) minmax(0, auto);
}
.tao-studio-product-host[data-layout-preset="draw"] .studio-inspector { display: contents; }
.tao-studio-product-host[data-layout-preset="draw"] .studio-editor-pane { grid-column: 1; grid-row: 1; min-width: 0; }
.tao-studio-product-host[data-layout-preset="draw"] .studio-environment-pane {
  border-top: 1px solid var(--studio-divider); grid-column: 1; grid-row: 2; max-height: 45vh; min-width: 0; overflow: auto;
}
.tao-studio-product-host[data-layout-preset="draw"] .studio-environment-pane .studio-collapse-right { display: none; }
.tao-studio-product-host[data-layout-preset="draw"] .studio-visual-pane { grid-column: 5; grid-row: 1 / 3; min-width: 0; overflow: auto; }
.tao-studio-product-host[data-layout-preset="draw"] .studio-divider-preview { grid-column: 2; grid-row: 1 / 3; }
.tao-studio-product-host[data-layout-preset="draw"] .studio-preview { grid-column: 3; grid-row: 1 / 3; }
.tao-studio-product-host[data-layout-preset="draw"] .studio-divider-right { grid-column: 4; grid-row: 1 / 3; }
.studio-draw-canvas { display: none; height: 100%; min-height: 0; overflow: auto; }
.tao-studio-product-host[data-layout-preset="draw"] .studio-preview > :not(.studio-draw-canvas):not(.studio-preview-grid):not(.studio-draw-tools):not(.studio-canvas-zoom):not(.studio-canvas-zoom-menu):not(.studio-edit-log):not(.studio-selection-hud) { display: none; }
.tao-studio-product-host[data-layout-preset="draw"] .studio-draw-canvas { display: block; }
.tao-studio-product-host[data-layout-preset="run"] .studio-draw-canvas,
.tao-studio-product-host[data-layout-preset="run"] [data-tao-studio-sketch-host] { display: none; }

/* ---------- files ---------- */
.studio-files { padding: 6px 6px 12px; }
[data-studio-files-surface="compact"] { color: var(--studio-text-muted); min-width: 0; }
.studio-file-create { align-items: center; display: flex; gap: 4px; min-width: 0; padding: 2px 2px 8px; }
.studio-file-create .studio-input { height: 24px; }
.studio-file-create .studio-icon-button { flex: none; }
.studio-tree-folder > button[aria-expanded] .studio-tree-chevron { transition: transform 120ms ease; }
.studio-tree-folder > button[aria-expanded="true"] .studio-tree-chevron { transform: rotate(90deg); }
.studio-tree-row { align-items: center; display: flex; min-width: 0; }
.studio-tree-button {
  align-items: center; background: transparent; border: 0; border-radius: var(--studio-radius); color: inherit; cursor: default; display: flex;
  flex: 1 1 auto; gap: 6px; min-height: 26px; min-width: 0; padding: 0 6px 0 8px; text-align: left;
}
.studio-tree-folder > .studio-tree-button { color: var(--studio-text); font-weight: 500; }
.studio-tree-button:hover, [data-studio-tree-file]:hover > .studio-tree-row > .studio-tree-button { background: var(--studio-surface-hover); color: var(--studio-text); }
[data-studio-tree-file][data-current="true"] > .studio-tree-row > .studio-tree-button { background: var(--studio-surface-active); color: var(--studio-text); }
.studio-tree-chevron { align-items: center; color: var(--studio-text-dim); display: inline-flex; flex: none; height: 13px; justify-content: center; width: 13px; }
.studio-tree-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-tree-children { margin-left: 14px; }
.studio-tree-action {
  align-items: center; background: transparent; border: 0; border-radius: var(--studio-radius); color: var(--studio-text-dim); cursor: pointer;
  display: inline-flex; flex: 0 0 22px; height: 22px; justify-content: center; opacity: 0; padding: 0; transition: opacity 100ms ease;
}
[data-studio-tree-file]:hover .studio-tree-action, .studio-tree-action:focus-visible { opacity: 1; }
.studio-tree-action:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-tree-action[data-action="delete"]:hover { color: var(--studio-error); }
.studio-tree-dirty { background: var(--studio-accent); border-radius: 50%; flex: none; height: 6px; margin-left: auto; width: 6px; }
.studio-tree-diagnostics {
  background: var(--studio-error); border-radius: 8px; color: #fff; flex: none; font: 600 10px/16px var(--studio-mono); margin-left: auto;
  min-width: 16px; padding: 0 5px; text-align: center;
}
.studio-tree-dirty + .studio-tree-diagnostics { margin-left: 4px; }
.studio-inline-editor { align-items: center; display: flex; gap: 4px; min-width: 0; padding: 3px 4px 5px; }
.studio-inline-editor .studio-input { height: 24px; }
.studio-delete-confirmation {
  align-items: center; background: rgba(255, 92, 92, .1); border: 1px solid rgba(255, 92, 92, .3); border-radius: var(--studio-radius); display: flex;
  gap: 4px; margin: 2px 4px 4px; padding: 4px 4px 4px 8px;
}
.studio-delete-confirmation > span { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- side panels ---------- */
.studio-tao-panel { padding: 6px 8px 12px; }
.studio-tao-panel > h2, .studio-palette h2, .studio-inspector h2 {
  color: var(--studio-text-dim); font-size: 10.5px; font-weight: 600; letter-spacing: .06em; margin: 8px 0 6px; padding: 0 2px; text-transform: uppercase;
}
.studio-palette { padding: 4px 8px 14px; }
.studio-components, .studio-project-views { display: flex; flex-wrap: wrap; gap: 6px; }
.studio-palette-button {
  align-items: center; background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius);
  color: var(--studio-text); cursor: grab; display: inline-flex; font-size: 11.5px; font-weight: 500; height: 24px; max-width: 100%; overflow: hidden; padding: 0 9px; text-overflow: ellipsis; white-space: nowrap;
}
.studio-palette-button[data-tao-studio-project-view] { border-style: dashed; }
.studio-palette-button:hover:not(:disabled) { background: var(--studio-surface-hover); }
.studio-palette-button:disabled { cursor: default; opacity: .45; }
.studio-panel-note { color: var(--studio-text-dim); font-size: 12px; }
.studio-panel-note { padding: 12px; }
.studio-screens { display: grid; align-content: start; gap: 6px; padding: 8px; }
.studio-search-panel { align-content: start; display: grid; gap: 2px; min-height: 0; overflow: auto; padding: 6px 8px; }
.studio-screen-item {
  background: transparent; border: 0; border-radius: var(--studio-radius); color: var(--studio-text); cursor: pointer; display: grid; gap: 2px;
  padding: 6px 8px; text-align: left; width: 100%;
}
.studio-screen-item:hover { background: var(--studio-surface-hover); }
.studio-screen-item strong { font-size: 12px; font-weight: 500; }
.studio-screen-item span { color: var(--studio-text-dim); font: 10.5px var(--studio-mono); overflow-wrap: anywhere; }
.studio-search-input {
  background: var(--studio-bg-deep); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius); color: var(--studio-text);
  font: inherit; height: 28px; letter-spacing: 0; outline: none; padding: 0 8px; text-transform: none;
}
.studio-search-input:focus { border-color: var(--studio-accent); }
.studio-search-results { align-content: start; align-items: start; display: grid; gap: 2px; justify-content: start; }
.studio-search-results > * { align-content: start; justify-content: flex-start; width: 100%; }
.studio-design-values { padding: 6px 8px 12px; }
.studio-design-token-kind { display: grid; gap: 0; }
.studio-design-token-kind > h3 {
  color: var(--studio-text-dim); font-size: 10.5px; font-weight: 600; letter-spacing: .06em;
  margin: 10px 0 2px; padding: 0 2px; text-transform: uppercase;
}
.studio-design-token-kind:first-child > h3 { margin-top: 2px; }
.studio-design-token {
  background: transparent; border: 0; border-radius: var(--studio-radius); color: var(--studio-text);
  cursor: pointer; display: grid; gap: 1px; padding: 3px 6px; text-align: left; width: 100%;
}
.studio-design-token:hover { background: var(--studio-surface-hover); }
.studio-design-token strong { font-size: 12px; font-weight: 500; }
.studio-design-token-value {
  align-items: center; color: var(--studio-text-dim); display: flex; font: 10.5px var(--studio-mono);
  gap: 6px; min-width: 0; overflow-wrap: anywhere;
}
.studio-design-token-swatch {
  background: var(--studio-stroke); border: 1px solid var(--studio-stroke-strong); border-radius: 3px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .2); flex: 0 0 auto; height: 12px; width: 12px;
}

/* ---------- editor ---------- */
.studio-editor-pane { background: var(--studio-bg); display: grid; grid-template-rows: 36px 26px minmax(0, 1fr); min-height: 0; min-width: 0; }
.studio-editor-tabs { align-items: stretch; background: var(--studio-panel); border-bottom: 1px solid var(--studio-stroke); display: flex; gap: 2px; overflow-x: auto; padding: 0 6px; }
.studio-editor-tab-item { align-items: center; display: flex; flex: 0 0 auto; max-width: 240px; position: relative; }
.studio-editor-tab-item::after { background: transparent; border-radius: 2px; bottom: -1px; content: ""; height: 2px; left: 8px; position: absolute; right: 8px; }
.studio-editor-tab-item[aria-current="page"]::after { background: var(--studio-accent); }
.studio-editor-tab { background: transparent; border: 0; color: var(--studio-text-muted); cursor: pointer; font-weight: 500; max-width: 200px; overflow: hidden; padding: 0 4px 0 10px; text-overflow: ellipsis; white-space: nowrap; }
.studio-editor-tab-item[aria-current="page"] .studio-editor-tab { color: var(--studio-text); }
.studio-editor-tab-close { background: transparent; border: 0; border-radius: 3px; color: var(--studio-text-dim); cursor: pointer; padding: 2px 6px 3px; }
.studio-editor-tab-close:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-breadcrumbs { align-items: center; background: var(--studio-bg); border-bottom: 1px solid var(--studio-stroke); color: var(--studio-text-dim); display: flex; font-size: 11px; gap: 6px; overflow: hidden; padding: 0 14px; white-space: nowrap; }
.studio-breadcrumb-separator { color: var(--studio-stroke-strong); }
.studio-editor { background: var(--studio-bg); min-height: 0; overflow: hidden; }
.studio-editor .cm-editor { background: var(--studio-bg); height: 100%; }
.studio-editor[data-tao-editor-mounted="true"] > .cm-editor { display: none !important; }
.studio-editor-tao-surface { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
.studio-editor-tao-surface > [data-testid="studio-active-editor"] { flex: 1 1 auto; min-height: 0; }
.studio-editor-tao-surface > [data-testid="studio-active-editor"] > div:first-child { height: 100%; }
.studio-editor .cm-scroller { font: 12.5px/1.6 var(--studio-mono); }
/* The syntax lens bar sits above the editor: fold presets and facets as quiet toggles. */
.studio-lens-bar { align-items: center; background: var(--studio-panel); border-bottom: 1px solid var(--studio-stroke); display: flex; flex: 0 0 auto; flex-wrap: wrap; font-size: 11px; gap: 2px 4px; min-height: 28px; padding: 2px 6px; }
.studio-lens-bar-group { align-items: center; display: flex; gap: 2px; }
.studio-lens-bar-divider { background: var(--studio-stroke-strong); height: 16px; margin: 0 6px; width: 1px; }
.studio-lens-preset, .studio-lens-facet, .studio-lens-refold { background: transparent; border: 1px solid transparent; border-radius: var(--studio-radius); color: var(--studio-text-muted); cursor: pointer; font: inherit; font-weight: 500; line-height: 1.3; padding: 1px 6px; white-space: nowrap; }
.studio-lens-preset:hover, .studio-lens-facet:hover, .studio-lens-refold:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-lens-preset[aria-pressed="true"] { background: var(--studio-surface-active); box-shadow: 0 0 0 1px var(--studio-stroke-strong); color: var(--studio-text); }
.studio-lens-facet[aria-pressed="true"] { background: var(--studio-surface-active); color: var(--studio-text); }
.studio-lens-facet[aria-pressed="false"] .studio-lens-glyph { opacity: .45; }
.studio-lens-glyph { display: inline-block; margin-right: 4px; }
.studio-lens-refold { margin-left: auto; }
.studio-editor .cm-gutters { background: var(--studio-bg); border-right: 1px solid var(--studio-stroke); color: var(--studio-text-dim); }
.studio-editor .cm-activeLine, .studio-editor .cm-activeLineGutter { background: rgba(255, 255, 255, .04); }
.studio-editor .cm-activeLineGutter { color: var(--studio-text-muted); }
.studio-editor .cm-selectionBackground, .studio-editor .cm-focused .cm-selectionBackground { background: rgba(255, 106, 31, .28) !important; }
.studio-editor .cm-cursor { border-left-color: var(--studio-accent); }
.studio-editor .cm-matchingBracket { background: var(--studio-accent-soft); outline: 1px solid var(--studio-accent); }

/* ---------- drawer ---------- */
.studio-drawer { background: var(--studio-panel); display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; overflow: hidden; }
.studio-drawer-tabs { align-items: center; background: var(--studio-panel); border-bottom: 1px solid var(--studio-stroke); display: flex; gap: 2px; min-height: 32px; padding: 0 8px; }
.studio-drawer-tabs button { background: transparent; border: 0; border-radius: var(--studio-radius); color: var(--studio-text-muted); cursor: pointer; font-weight: 500; height: 24px; padding: 0 9px; }
.studio-drawer-tabs button:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-drawer-tabs button[aria-current="true"] { background: var(--studio-surface-active); color: var(--studio-text); }
.studio-drawer-tabs .studio-pane-collapse, .studio-inspector-pane-header .studio-pane-collapse {
  align-items: center; background: transparent; color: var(--studio-text-dim); display: inline-flex; font-size: 15px; justify-content: center; margin-left: auto; min-width: 24px; padding: 0 5px;
}
.studio-drawer-tabs .studio-pane-collapse:hover, .studio-inspector-pane-header .studio-pane-collapse:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-drawer-content { color: var(--studio-text-muted); font-size: 11.5px; min-height: 0; overflow: auto; padding: 8px 12px 12px; }
.studio-drawer-content dl { display: grid; grid-template-columns: max-content 1fr; margin: 0; }
.studio-drawer-content dt, .studio-drawer-content dd { border-bottom: 1px solid var(--studio-stroke); margin: 0; padding: 4px 8px; }

/* ---------- inspector ---------- */
/* The Scenario pane takes what it needs up to 62% of the column; fit-content keeps an auto track from growing past that cap. */
.studio-inspector { background: var(--studio-panel); display: grid; grid-template-rows: fit-content(62%) minmax(0, 1fr); min-height: 0; min-width: 0; overflow: hidden; }
.studio-inspector-pane { min-height: 0; min-width: 0; overflow: auto; }
.studio-environment-pane { border-bottom: 1px solid var(--studio-stroke); display: flex; flex-direction: column; }
/* The scenario slot and the environment slot are two portals; flattening them lets the sections order as one list. */
.studio-environment-pane > .studio-inspector-pane-header { flex: none; order: -3; }
.studio-scenario-inspector-content, .studio-scenario-inspector[data-scenario-available="true"], .studio-inspector-tao-environment, .studio-inspector-tao-environment > div { display: contents; }
.studio-environment-pane .studio-scenario-identity { order: -2; }
.studio-environment-pane .studio-section[data-studio-section="View arguments"] { order: -1; }
.studio-environment-pane .studio-section[data-studio-section="Record interaction"] { order: 1; }
.studio-environment-pane .studio-section[data-studio-section="Captured state"] { order: 1; }
.studio-environment-pane .studio-section { flex: none; }
.studio-inspector-pane-header {
  align-items: center; background: var(--studio-panel); border-bottom: 1px solid var(--studio-stroke); display: flex; gap: 8px; height: 36px;
  justify-content: space-between; padding: 0 8px 0 12px; position: sticky; top: 0; z-index: 2;
}
.studio-inspector-pane-header strong { color: var(--studio-text); font-size: 12px; font-weight: 600; }
.studio-scenario-inspector-content, .studio-inspector-tao-environment { min-width: 0; }
.studio-inspector-content { min-width: 0; padding: 0 12px 12px; }
.studio-scenario-inspector { display: grid; }
.studio-scenario-inspector > h2 { display: none; }
.studio-scenario-inspector[data-scenario-available="false"] { color: var(--studio-text-dim); font-size: 12px; padding: 24px 16px; text-align: center; }
.studio-scenario-identity { display: grid; gap: 3px; padding: 10px 12px 10px; }
.studio-scenario-inspector-label { color: var(--studio-text); display: block; font-size: 12.5px; font-weight: 600; overflow-wrap: anywhere; }
.studio-scenario-source { align-items: center; color: var(--studio-text-dim); display: flex; flex-wrap: wrap; font: 11px var(--studio-mono); gap: 4px 8px; min-width: 0; }
.studio-scenario-source b { color: var(--studio-text-muted); font-weight: 500; }
.studio-scenario-source .studio-scenario-cell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-inspector-tao-context { min-width: 0; }
.studio-context-panel-surface { min-width: 0; }
.studio-context-summary { border-bottom: 1px solid var(--studio-stroke); color: var(--studio-text-dim); display: flex; flex-wrap: wrap; font: 11px var(--studio-mono); gap: 4px 9px; min-width: 0; padding: 10px 12px; }
.studio-context-summary strong { color: var(--studio-text-muted); flex: 1 1 100%; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-context-selected { color: var(--studio-accent-strong); }
.studio-inspector-summary { color: var(--studio-text-muted); display: grid; font-size: 11.5px; gap: 3px; padding: 10px 12px; }
.studio-inspector-summary dt { color: var(--studio-text-dim); }
.studio-inspector-summary dd { margin: 0; overflow-wrap: anywhere; }
.studio-inspector-accordion { border-top: 1px solid var(--studio-stroke); }
.studio-inspector-accordion > h2 { margin: 0; padding: 10px 12px 6px; }
.studio-inspector-accordion > .studio-inspector-controls { display: grid; gap: 6px; padding: 0 12px 12px; }
.studio-inspector-controls { display: grid; gap: 6px; }
.studio-inspector-field { align-items: center; color: var(--studio-text-muted); display: grid; font-size: 11.5px; gap: 8px; grid-template-columns: 72px minmax(0, 1fr); min-width: 0; }
.studio-inspector-field > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* A stdlib TextInput arrives as a wrapper with its own label and mobile-sized inline styles; the field supplies the label, the sheet the size. */
.studio-inspector-field > div:not(.studio-segmented) { display: contents; }
.studio-inspector-field > div:not(.studio-segmented) > div[dir="auto"] { display: none; }
.studio-inspector-field input, .studio-inspector-field select, .studio-inspector-controls input:not([type="checkbox"]):not([type="file"]) {
  background: var(--studio-bg-deep) !important; border: 1px solid var(--studio-stroke-strong) !important; border-radius: var(--studio-radius) !important;
  color: var(--studio-text) !important; font-size: 12px !important; height: 26px !important; min-height: 0 !important; min-width: 0; padding: 0 8px !important; width: 100%;
}
.studio-inspector-field input[type="number"] { font-family: var(--studio-mono); }
.studio-inspector-field input[aria-invalid="true"] { border-color: var(--studio-error) !important; }
.studio-inspector-controls > [data-tao-studio-undo] { padding-top: 4px; }
.studio-scenario-inspector .studio-section .studio-inspector-controls { padding: 0; }
.studio-empty { color: var(--studio-text-dim); display: grid; height: 100%; padding: 24px; place-items: center; text-align: center; }
/* Tao-rendered text arrives with the wireframe defaults (14px, dark ink); on the workbench it reads as body copy. */
.tao-studio-product-host div[dir="auto"][class*="css-text"] { color: var(--studio-text-muted) !important; font-size: 12px !important; font-weight: 400 !important; line-height: 1.45 !important; }

/* ---------- data rail panel ---------- */
.studio-data { color: var(--studio-text-muted); padding: 8px 12px 12px; }

/* ---------- freehand sketches ---------- */
[data-tao-studio-sketch-host] { flex: none; }
.studio-canvas-bar {
  align-items: center; background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke); border-radius: 8px;
  display: flex; gap: 12px; justify-content: space-between; left: 12px; padding: 8px 12px; position: absolute; right: 12px;
  top: 12px; z-index: 5;
}
.studio-canvas-bar span { color: var(--studio-text-muted); font-size: 12px; }
.studio-canvas-focus[data-state="focused"] { background: #343a35; color: #f0f2ef; }
[data-tao-studio-sketch-workspace] { align-items: flex-start; border: 1px dashed var(--studio-stroke-strong); border-radius: var(--studio-radius-lg); box-sizing: border-box; cursor: default; min-height: 140px; min-width: 400px; position: relative; }
[data-tao-studio-sketch-workspace]:is([data-tao-studio-sketch-tool="rect"], [data-tao-studio-sketch-tool="text"]),
[data-tao-studio-sketch-workspace]:is([data-tao-studio-sketch-tool="rect"], [data-tao-studio-sketch-tool="text"]) [data-tao-studio-sketch-rect] { cursor: crosshair; }
.studio-draw-canvas [data-tao-studio-sketch-workspace] { min-height: 100%; min-width: 100%; }
[data-tao-studio-sketch-create-surface] [data-tao-studio-sketch-workspace]::before { color: var(--studio-text-dim); content: "Press R and drag empty space to draw a view"; font-size: 11px; left: 10px; pointer-events: none; position: absolute; top: 6px; }
[data-tao-studio-sketch-outer-preview] { background: rgba(255, 106, 31, .08); border: 1px dashed var(--studio-accent); box-sizing: border-box; pointer-events: none; position: absolute; }
[data-tao-studio-sketch-marquee] { background: rgba(255, 106, 31, .08); border: calc(1px * var(--studio-canvas-counter-scale, 1)) solid var(--studio-accent); box-sizing: border-box; }
/* The one Draw tool strip: V selects, R draws a view or a rectangle, T draws text. It sits on the
   canvas's top edge beside the zoomed surface, so it keeps one size and place at any zoom. */
.studio-draw-tools {
  background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke); border-radius: 8px; box-shadow: 0 8px 24px #0004;
  display: none; gap: 2px; left: 50%; padding: 3px; position: absolute; top: 12px; transform: translateX(-50%); z-index: 5;
}
.tao-studio-product-host[data-layout-preset="draw"] .studio-draw-tools { display: flex; }
.studio-draw-tools button {
  background: transparent; border: 0; border-radius: 5px; color: var(--studio-text-muted); cursor: pointer;
  font: 600 12px var(--studio-mono); height: 26px; width: 28px;
}
.studio-draw-tools button:hover { color: var(--studio-text); }
.studio-draw-tools button[aria-pressed="true"] { background: var(--studio-accent-surface); color: var(--studio-accent); }
[data-tao-studio-sketch] { background: #f4f1ea; border: 1px solid #c4b8a5; border-radius: 8px; box-shadow: 0 8px 20px rgba(0, 0, 0, .28); color: #242a33; }
[data-tao-studio-sketch-name] { align-items: center; color: var(--studio-text); display: flex; font-size: 12px; font-weight: 600; gap: 6px; line-height: 16px; pointer-events: none; white-space: nowrap; }
.studio-sketch-badge { cursor: default; order: -1; pointer-events: auto; position: relative; }
[data-tao-studio-sketch-badge] { background: var(--studio-accent-surface); border: 1px solid var(--studio-accent); border-radius: 999px; color: var(--studio-accent); cursor: pointer; font: inherit; font-size: 10px; font-weight: 600; line-height: 14px; padding: 0 7px; }
[data-tao-studio-sketch-badge][data-role="render"] { background: rgba(90, 169, 255, .12); border-color: var(--studio-info); color: var(--studio-info); }
[data-tao-studio-sketch-badge-menu] { background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius-lg); box-shadow: 0 8px 24px rgba(0, 0, 0, .35); display: grid; gap: 2px; left: 0; max-width: 280px; min-width: 180px; padding: 4px; position: absolute; top: calc(100% + 4px); white-space: normal; z-index: 20; }
[data-tao-studio-sketch-badge-menu] button { background: none; border: 0; border-radius: var(--studio-radius); color: var(--studio-text); cursor: pointer; font: inherit; font-weight: 500; padding: 5px 8px; text-align: left; }
[data-tao-studio-sketch-badge-menu] button:hover, [data-tao-studio-sketch-badge-menu] button:focus-visible { background: var(--studio-bg-deep); }
[data-tao-studio-sketch-badge-menu] p { color: var(--studio-text-dim); font-weight: 400; margin: 0; padding: 5px 8px; }
.studio-sketch-card { border: 1px dashed var(--studio-info); border-radius: 8px; box-sizing: border-box; color: var(--studio-text); cursor: default; display: grid; gap: 6px; align-content: start; overflow: hidden; padding: 10px; }
[data-tao-studio-sketch-card="definition"] .studio-sketch-card { border-color: var(--studio-accent); }
[data-tao-studio-sketch-broken] .studio-sketch-card { border-color: var(--studio-stroke-strong); color: var(--studio-text-dim); opacity: .7; }
[data-tao-studio-sketch-badge][data-broken] { background: none; border-color: var(--studio-stroke-strong); color: var(--studio-text-dim); }
.studio-sketch-card code { font-family: var(--studio-mono); font-size: 11px; }
.studio-sketch-card small { color: var(--studio-text-dim); font-size: 11px; line-height: 1.45; }
[data-tao-studio-sketch-rect] { background: #dce6f5; border: 1px solid #7693bc; box-sizing: border-box; cursor: move; overflow: visible; }
[data-tao-studio-sketch-rect-kind="Text"] { background: transparent; border-color: #9ca8b8; }
/* The canvas writes the inverse of its zoom, so selection strokes and handles keep one on-screen size. */
[data-tao-studio-sketch-rect][data-selected="true"] { outline: calc(2px * var(--studio-canvas-counter-scale, 1)) solid var(--studio-accent); outline-offset: calc(1px * var(--studio-canvas-counter-scale, 1)); }
[data-tao-studio-sketch-handle] { background: #fff; border: 1px solid var(--studio-accent); border-radius: 50%; height: 8px; padding: 0; position: absolute; transform: scale(var(--studio-canvas-counter-scale, 1)); width: 8px; }
[data-tao-studio-sketch-handle="north-west"] { cursor: nwse-resize; left: -5px; top: -5px; }
[data-tao-studio-sketch-handle="north"] { cursor: ns-resize; left: calc(50% - 4px); top: -5px; }
[data-tao-studio-sketch-handle="north-east"] { cursor: nesw-resize; right: -5px; top: -5px; }
[data-tao-studio-sketch-handle="east"] { cursor: ew-resize; right: -5px; top: calc(50% - 4px); }
[data-tao-studio-sketch-handle="south-east"] { bottom: -5px; cursor: nwse-resize; right: -5px; }
[data-tao-studio-sketch-handle="south"] { bottom: -5px; cursor: ns-resize; left: calc(50% - 4px); }
[data-tao-studio-sketch-handle="south-west"] { bottom: -5px; cursor: nesw-resize; left: -5px; }
[data-tao-studio-sketch-handle="west"] { cursor: ew-resize; left: -5px; top: calc(50% - 4px); }
[data-tao-studio-sketch-inspector] { background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius-lg); cursor: default; display: grid; gap: 6px; padding: 8px; }
[data-tao-studio-sketch-inspector][hidden] { display: none; }
[data-tao-studio-sketch-inspector] input, [data-tao-studio-sketch-inspector] select { background: var(--studio-bg-deep); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius); color: var(--studio-text); min-width: 0; padding: 5px 6px; }
/* A root rectangle is selected, dragged, and removed as a whole from its header row. */
[data-tao-studio-sketch-name] { cursor: grab; pointer-events: auto; user-select: none; }
[data-tao-studio-sketch-frame][data-tao-studio-sketch-moving] { opacity: .85; z-index: 10; }
[data-tao-studio-sketch-frame][data-tao-studio-sketch-moving] [data-tao-studio-sketch-name] { cursor: grabbing; }
[data-tao-studio-sketch-frame][data-selected="true"] > [data-tao-studio-sketch],
[data-tao-studio-sketch-frame][data-selected="true"] > .studio-sketch-card { outline: calc(2px * var(--studio-canvas-counter-scale, 1)) solid var(--studio-accent); outline-offset: calc(2px * var(--studio-canvas-counter-scale, 1)); }
[data-tao-studio-sketch-context-menu] { background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius-lg); box-shadow: 0 8px 24px rgba(0, 0, 0, .35); cursor: default; display: grid; min-width: 120px; padding: 4px; position: absolute; z-index: 20; }
[data-tao-studio-sketch-context-menu] button { background: none; border: 0; border-radius: var(--studio-radius); color: var(--studio-text); cursor: pointer; font: inherit; font-weight: 500; padding: 5px 8px; text-align: left; }
[data-tao-studio-sketch-context-menu] button:hover, [data-tao-studio-sketch-context-menu] button:focus-visible { background: var(--studio-bg-deep); }

/* ---------- preview canvas ---------- */
.studio-preview { background: var(--studio-canvas); border-left: 1px solid var(--studio-stroke); min-height: 0; position: relative; }
.studio-preview iframe { border: 0; display: block; height: 100%; width: 100%; }
.studio-preview-notice {
  background: rgba(255, 92, 92, .12); border-top: 2px solid var(--studio-error); bottom: 0; color: var(--studio-text); display: grid; gap: 4px;
  left: 0; padding: 10px 14px; position: absolute; right: 0; z-index: 4;
}
.studio-preview-notice strong { font-size: 12px; }
.studio-preview-notice small { color: var(--studio-text-muted); font: 11px var(--studio-mono); }
.studio-preview-grid {
  align-content: start; background: var(--studio-canvas); background-image: radial-gradient(rgba(255, 255, 255, .06) 1px, transparent 1px); background-size: 16px 16px;
  display: grid; gap: 22px; height: 100%; min-width: 0; overflow-x: hidden; overflow-y: auto; padding: 16px 18px 28px;
}
/* The canvas surface: the grid becomes one transformed plane the person pans and zooms, so every
   scenario group is laid out at its natural size and the host clips rather than scrolls. */
.studio-preview[data-canvas-surface="on"] { overflow: hidden; touch-action: none; }
.studio-preview[data-canvas-surface="on"] > .studio-preview-grid,
.studio-preview[data-canvas-surface="on"] > .studio-draw-canvas {
  background: none; height: auto; left: 0; min-height: 100%; min-width: 100%; overflow: visible; position: absolute;
  top: 0; transform-origin: 0 0; width: max-content; will-change: transform;
}
.studio-preview[data-canvas-surface="on"] > .studio-draw-canvas { height: 100%; width: 100%; }
.studio-preview[data-canvas-surface="on"] > .studio-preview-grid > .studio-preview-group > .studio-preview-group-cells {
  overflow: visible;
}
/* Draw lays the grid beneath its transparent canvas under the same transform and shows only the rows
   it moved under a drawn view's slot, so each view runs under its drawing without its iframe
   reloading. Other boards paint over the running views, and the drawing keeps every pointer. */
.tao-studio-product-host[data-layout-preset="draw"] .studio-preview > .studio-preview-grid { pointer-events: none; visibility: hidden; }
.tao-studio-product-host[data-layout-preset="draw"] .studio-preview-grid > [data-tao-studio-draw-live] {
  display: block; position: absolute; visibility: visible; width: max-content;
}
.tao-studio-product-host[data-layout-preset="draw"] [data-tao-studio-draw-live] > .studio-preview-group-label,
.tao-studio-product-host[data-layout-preset="draw"] [data-tao-studio-draw-live] .studio-preview-cell-controls { display: none; }
.tao-studio-product-host[data-layout-preset="draw"] [data-tao-studio-draw-live] > .studio-preview-group-cells { padding: 6px; }
/* A running view takes its frame's size rather than its scenario's device, so it lays out in the space
   it was drawn in and the frame stays the size it was drawn. Placement supplies both lengths. */
.tao-studio-product-host[data-layout-preset="draw"] [data-tao-studio-draw-live] .studio-preview-cell { width: auto !important; }
.tao-studio-product-host[data-layout-preset="draw"] [data-tao-studio-draw-live] .studio-preview-cell-details { display: none; }
.tao-studio-product-host[data-layout-preset="draw"] [data-tao-studio-draw-live] .studio-preview-cell-viewport {
  height: var(--studio-draw-frame-height) !important; width: var(--studio-draw-frame-width) !important;
}
/* A running view makes its frame tall; the frame's empty box and its filled slot let pointers through
   to the boards and frames around them. */
.tao-studio-product-host[data-layout-preset="draw"] [data-tao-studio-sketch-frame] { pointer-events: none; }
.tao-studio-product-host[data-layout-preset="draw"] [data-tao-studio-sketch-frame] > * { pointer-events: auto; }
.tao-studio-product-host[data-layout-preset="draw"] [data-tao-studio-sketch-frame] > [data-tao-studio-draw-live-filled] { color: transparent; pointer-events: none; }
[data-tao-studio-sketch-frame][data-tao-studio-sketch-drop-into] > [data-tao-studio-sketch-name] { color: var(--studio-accent); }
.tao-studio-product-host[data-layout-preset="draw"] [data-tao-studio-draw-live] .studio-preview-cell[data-tao-studio-drop-into-target] .studio-preview-cell-viewport {
  box-shadow: 0 0 0 5px var(--studio-bezel), 0 0 0 8px var(--studio-accent);
}
.studio-preview { cursor: grab; }
.studio-preview[data-canvas-pan-ready="true"] { cursor: grab; }
.studio-preview[data-canvas-panning="true"] { cursor: grabbing; }
/* Keep one transparent surface above every preview for the entire held-Space gesture, including
   between drags. Pointer hit testing targets the canvas host, never an embedded app or edit handle. */
.studio-preview[data-canvas-pan-ready="true"]::after,
.studio-preview[data-feed-dragging="true"]::after,
.studio-preview[data-canvas-panning="true"]::after {
  content: ""; cursor: inherit; inset: 0; pointer-events: auto; position: absolute; z-index: 6;
}
.studio-canvas-zoom {
  background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke); border-radius: 999px; bottom: 12px;
  color: var(--studio-text-muted); cursor: pointer; font: 11px var(--studio-mono); padding: 5px 11px; position: absolute;
  right: 12px; z-index: 5;
}
.studio-canvas-zoom:hover { color: var(--studio-text); }
.studio-canvas-zoom-menu {
  background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke); border-radius: 8px;
  bottom: 46px; box-shadow: 0 8px 24px #0004; display: grid; min-width: 190px; padding: 5px;
  position: absolute; right: 12px; z-index: 5;
}
.studio-canvas-zoom-menu[hidden] { display: none; }
/* The edit log shares the canvas's bottom edge with the zoom pill: left corner, Design and Draw only. */
.studio-edit-log {
  background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke); border-radius: 8px; bottom: 12px;
  box-shadow: 0 8px 24px #0004; display: none; font-size: 12px; left: 12px; max-width: min(280px, 45%);
  padding: 6px 4px 4px; position: absolute; z-index: 5;
}
.tao-studio-product-host:is([data-layout-preset="design"], [data-layout-preset="draw"]) .studio-edit-log:not([hidden]) { display: block; }
.studio-edit-log header { align-items: baseline; display: flex; gap: 8px; justify-content: space-between; padding: 0 6px 4px; }
.studio-edit-log header span { color: var(--studio-text-muted); font-size: 11px; white-space: nowrap; }
.studio-edit-log ol { display: grid; list-style: none; margin: 0; padding: 0; }
.studio-edit-log li { align-items: center; border-radius: 4px; display: flex; gap: 8px; min-height: 24px; padding: 0 6px; }
.studio-edit-log li:first-child { background: var(--studio-stroke); }
.studio-edit-log-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-edit-log time { color: var(--studio-text-muted); font: 11px var(--studio-mono); }
.studio-edit-log button {
  background: transparent; border: 1px solid var(--studio-stroke); border-radius: 4px; color: var(--studio-text);
  cursor: pointer; font: 11px var(--studio-sans); padding: 1px 6px;
}
/* The selection HUD sits just under the selected element and moves with pan, zoom and layout. */
.studio-selection-hud {
  align-items: center; background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke); border-radius: 8px;
  box-shadow: 0 8px 24px #0004; display: none; flex-wrap: wrap; font-size: 11px; gap: 6px; left: 0;
  max-width: calc(100% - 16px); padding: 4px 6px; position: absolute; top: 0; white-space: nowrap; z-index: 6;
}
/* Whether it shows is the HUD's own call: Design, Draw, or the preview's edit mode in any layout. */
.studio-selection-hud:not([hidden]) { display: flex; }
.studio-selection-hud-actions { position: relative; }
.studio-selection-hud-actions-toggle { align-items: center; display: flex; padding: 2px 3px; }
.studio-selection-hud-menu {
  background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke); border-radius: 8px;
  box-shadow: 0 8px 24px #0004; display: flex; flex-direction: column; left: -7px; min-width: 140px; padding: 4px;
  position: absolute; top: calc(100% + 9px); z-index: 1;
}
.studio-selection-hud-menu[hidden] { display: none; }
.studio-selection-hud-menu[data-above="true"] { bottom: calc(100% + 9px); top: auto; }
.studio-selection-hud .studio-selection-hud-menu button { border: 0; padding: 4px 8px; text-align: left; }
.studio-selection-hud .studio-selection-hud-menu button:hover:not(:disabled) { background: var(--studio-surface-hover); }
.studio-selection-hud-name { color: var(--studio-text-muted); font: 11px var(--studio-mono); padding-right: 2px; }
.studio-selection-hud label { align-items: center; color: var(--studio-text-muted); display: flex; gap: 4px; }
.studio-selection-hud :is(button, input, select) {
  background: transparent; border: 1px solid var(--studio-stroke); border-radius: 4px; color: var(--studio-text);
  font: 11px var(--studio-sans); padding: 2px 5px;
}
.studio-selection-hud button { cursor: pointer; }
.studio-selection-hud input { width: 5ch; }
.studio-selection-hud :is(button, input, select):disabled { cursor: default; opacity: .5; }
.studio-canvas-zoom-menu button {
  background: transparent; border: 0; border-radius: 4px; color: var(--studio-text); cursor: pointer;
  font: 12px var(--studio-sans); padding: 8px 10px; text-align: left;
}
.studio-canvas-zoom-menu button:hover, .studio-canvas-zoom-menu button:focus-visible { background: var(--studio-stroke); }
.studio-canvas-zoom-menu button:disabled { color: var(--studio-text-muted); cursor: default; opacity: .5; }
.studio-preview-group { display: grid; gap: 10px; min-width: 0; width: 100%; }
.studio-preview-group-label { color: var(--studio-text); font-size: 12.5px; font-weight: 600; margin: 0; position: sticky; left: 0; }
.studio-preview-group-cells {
  align-items: start; display: flex; gap: 24px; max-width: 100%; min-width: 0; overflow-x: auto;
  overscroll-behavior-x: contain; padding: 4px 8px 14px 4px; scroll-snap-type: x proximity;
}
.studio-preview-group-cells > .studio-preview-cell { scroll-snap-align: start; }
.studio-preview-cell { cursor: pointer; display: grid; flex: none; gap: 8px; justify-items: start; min-width: 0; }
.studio-whole-app-preview { grid-template-rows: auto minmax(0, 1fr); height: 100%; width: 100%; padding: 8px; }
.studio-whole-app-preview > .studio-preview-cell-viewport { height: 100%; width: 100%; }
.studio-preview-cell:focus-visible { outline: 2px solid var(--studio-accent); outline-offset: 8px; }
.studio-preview-cell-label {
  align-items: center; color: var(--studio-text); display: flex; font-size: 12px; font-weight: 600; gap: 8px; width: 100%;
}
.studio-preview-activation-toggle { flex: none; width: 26px; height: 26px; display: inline-grid; place-items: center; border: 0; background: transparent; color: #898d96; cursor: pointer; }
.studio-preview-activation-toggle svg, .studio-preview-inactive-activate svg { width: 17px; height: 17px; fill: none; }
.studio-preview-activation-toggle[aria-pressed="true"] { color: #c5a32f; }
.studio-preview-activation-toggle[aria-pressed="true"] svg { fill: #ead57b; }
.studio-preview-inactive-activate { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 100%; border: 0; border-radius: inherit; padding: 0; background: transparent; color: var(--studio-text-dim); cursor: pointer; font: inherit; font-size: 12px; }
.studio-preview-inactive-activate:focus-visible { outline: 2px solid var(--studio-accent); outline-offset: -4px; }
.studio-preview-cell-details { margin-left: auto; color: var(--studio-text-dim); font: 11px var(--studio-mono); font-weight: 400; }
.studio-preview-cell[data-preview-interactive="true"] > .studio-preview-cell-label { color: var(--studio-accent-strong); }
.studio-preview-cell-viewport {
  background: var(--studio-panel); border-radius: 26px; box-shadow: 0 0 0 5px var(--studio-bezel), 0 0 0 6px var(--studio-stroke-strong), 0 24px 48px -12px rgba(0, 0, 0, .8);
  flex: none; overflow: hidden; position: relative;
}
.studio-preview-focus-shield {
  appearance: none; background: transparent; border: 0; border-radius: inherit; cursor: pointer; inset: 0; padding: 0; position: absolute; z-index: 2;
}
.studio-preview-focus-shield[hidden] { display: none; }
.studio-preview-focus-shield:focus-visible { outline: 2px solid var(--studio-accent); outline-offset: -3px; }
.studio-preview > iframe[data-preview-interactive="true"] { outline: 2px solid var(--studio-accent); outline-offset: -2px; }
.studio-preview-cell[data-preview-interactive="true"] .studio-preview-cell-viewport {
  box-shadow: 0 0 0 5px var(--studio-bezel), 0 0 0 7px var(--studio-accent), 0 24px 48px -12px rgba(0, 0, 0, .8);
}
.studio-preview-cell-controls { display: grid; gap: 8px; width: 100%; }
.studio-preview-control-group { border: 0; margin: 0; min-width: 0; padding: 0; }
.studio-preview-control-group legend { color: var(--studio-text-dim); font-size: 10.5px; font-weight: 600; letter-spacing: .06em; padding: 0 0 4px; text-transform: uppercase; }
.studio-preview-control-fields { display: grid; gap: 4px; }
.studio-preview-control-field { align-items: center; color: var(--studio-text-muted); display: grid; font-size: 11px; gap: 6px; grid-template-columns: minmax(50px, .75fr) minmax(70px, 1.25fr); min-width: 0; }
.studio-preview-control-input { display: flex; min-width: 0; }
.studio-preview-control-input input:not([type="checkbox"]), .studio-preview-control-input select, .studio-preview-control-input textarea, .studio-preview-fixture-name {
  background: var(--studio-bg-deep); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius); color: var(--studio-text); font: inherit; min-width: 0; padding: 3px 6px; width: 100%;
}
.studio-preview-control-input textarea { font-family: var(--studio-mono); resize: vertical; }
.studio-preview-control-note { color: var(--studio-text-dim); font-size: 11px; line-height: 1.3; }
.studio-preview-cell-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 6px; }
.studio-preview-cell-apply, .studio-preview-cell-promote, .studio-preview-cell-capture, .studio-preview-cell-generate, .studio-preview-cell-replay-load, .studio-preview-runtime-failure-actions button {
  background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius); color: var(--studio-text); cursor: pointer; font-size: 11.5px; font-weight: 500; padding: 4px 9px;
}
.studio-preview-cell-apply { background: var(--studio-accent); border-color: transparent; color: var(--studio-accent-ink); }
.studio-preview-cell-apply:disabled, .studio-preview-cell-promote:disabled, .studio-preview-cell-capture:disabled, .studio-preview-cell-generate:disabled, .studio-preview-runtime-failure-actions button:disabled { cursor: default; opacity: .5; }
.studio-preview-cell-status { color: var(--studio-text-dim); font-size: 11px; overflow-wrap: anywhere; }
.studio-preview-cell-status[data-state="error"] { color: var(--studio-error); }
.studio-preview-runtime-failure {
  background: rgba(255, 92, 92, .1); border: 1px solid rgba(255, 92, 92, .3); border-radius: var(--studio-radius-lg); color: var(--studio-text); display: grid; gap: 5px; padding: 9px 10px; width: 100%;
}
.studio-preview-runtime-failure-context { color: var(--studio-text-muted); font: 10.5px var(--studio-mono); }
.studio-preview-runtime-failure-actions { align-items: center; display: flex; gap: 6px; }
.studio-preview-runtime-failure small { color: var(--studio-text-muted); }

/* ---------- command palette ---------- */
.studio-command-overlay {
  background: var(--studio-panel); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius-lg); box-shadow: 0 24px 64px rgba(0, 0, 0, .7);
  left: 50%; max-width: 620px; overflow: hidden; position: fixed; top: 72px; transform: translateX(-50%); width: calc(100% - 32px); z-index: 20;
}
.studio-command-overlay label { display: grid; }
.studio-command-overlay label span { display: none; }
.studio-command-overlay input {
  background: transparent; border: 0; border-bottom: 1px solid var(--studio-stroke); color: var(--studio-text); font-size: 13.5px; outline: none; padding: 12px 14px; width: 100%;
}
.studio-command-overlay input::placeholder { color: var(--studio-text-dim); }
.studio-command-results { display: grid; gap: 2px; max-height: min(65vh, 520px); overflow: auto; padding: 6px; }
.studio-command-result {
  background: transparent; border: 0; border-radius: var(--studio-radius); color: var(--studio-text); cursor: pointer; display: grid; gap: 2px; padding: 7px 9px; text-align: left;
}
.studio-command-result:hover, .studio-command-result:focus { background: var(--studio-surface-hover); outline: none; }
.studio-command-result strong { font-weight: 500; }
.studio-command-result span { color: var(--studio-text-dim); font-size: 11px; }

/* ---------- overlays ---------- */
.studio-global-loading {
  -webkit-backdrop-filter: grayscale(1) brightness(.5); align-items: center; backdrop-filter: grayscale(1) brightness(.5);
  background: rgba(0, 0, 0, .55); display: grid; inset: 0; justify-items: center; padding: 24px; position: fixed; z-index: 60;
}
.studio-global-loading[hidden] { display: none; }
.studio-global-loading-panel {
  align-items: center; background: var(--studio-panel); border: 1px solid var(--studio-stroke-strong); border-radius: 12px;
  box-shadow: 0 20px 80px rgba(0, 0, 0, .8); display: flex; gap: 14px; max-width: 420px; min-width: 300px; padding: 18px 20px;
}
.studio-global-loading-panel > span:last-child { display: grid; gap: 3px; }
.studio-global-loading strong { color: var(--studio-text); font-size: 12px; }
.studio-global-loading small { color: var(--studio-text-muted); font-size: 10.5px; }
.studio-global-loading-spinner { animation: studio-loading-spin 700ms linear infinite; border: 2px solid var(--studio-stroke-strong); border-radius: 50%; border-top-color: var(--studio-accent); height: 18px; width: 18px; }
@keyframes studio-loading-spin { to { transform: rotate(360deg); } }
.studio-ship-overlay { align-items: center; background: rgba(0, 0, 0, .78); display: grid; inset: 0; padding: 24px; place-items: center; position: fixed; z-index: 100; }
.studio-ship-overlay[hidden] { display: none; }
.studio-ship-progress {
  background: var(--studio-panel); border: 1px solid var(--studio-stroke-strong); border-radius: 12px; box-shadow: 0 24px 90px rgba(0, 0, 0, .8);
  display: grid; gap: 10px; max-width: 460px; padding: 24px; text-align: center; width: min(100%, 460px);
}
.studio-ship-progress progress { accent-color: var(--studio-accent); width: 100%; }
.studio-ship-progress strong { color: var(--studio-text); font-size: 15px; }
.studio-ship-progress small { color: var(--studio-text-muted); font-size: 11px; line-height: 1.5; }

/* ---------- dialogs ---------- */
.studio-dialog-backdrop { align-items: center; background: rgba(0, 0, 0, .6); display: grid; inset: 0; justify-items: center; padding: 24px; position: fixed; z-index: 110; }
.studio-dialog {
  background: var(--studio-panel); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius-lg); box-shadow: 0 24px 80px rgba(0, 0, 0, .75);
  display: grid; gap: 12px; max-height: calc(100vh - 48px); max-width: 640px; overflow: auto; padding: 18px 20px; width: min(100%, 640px);
}
.studio-dialog-title { font-size: 13px; font-weight: 600; margin: 0; }
.studio-dialog-detail { color: var(--studio-text-muted); line-height: 1.5; margin: 0; }
.studio-dialog-diff { background: var(--studio-bg-deep); border: 1px solid var(--studio-stroke); border-radius: var(--studio-radius); display: grid; font: 11.5px/1.55 var(--studio-mono); margin: 0; max-height: 40vh; overflow: auto; padding: 8px 0; }
.studio-dialog-diff-line { display: block; padding: 0 12px; white-space: pre; }
.studio-dialog-diff-line[data-kind="added"] { background: rgba(74, 222, 128, .12); color: var(--studio-positive); }
.studio-dialog-diff-line[data-kind="removed"] { background: rgba(255, 92, 92, .12); color: var(--studio-error); }
.studio-dialog-diff-line[data-kind="hunk"] { color: var(--studio-info); }
.studio-dialog-diff-line[data-kind="file"] { color: var(--studio-text-dim); }
.studio-dialog-input { height: 30px; }
.studio-dialog-actions { display: flex; gap: 8px; justify-content: flex-end; }

/* ---------- search hits and data rows ---------- */
.studio-search-hit { background: transparent; border: 0; border-radius: var(--studio-radius); color: var(--studio-text); cursor: pointer; display: grid; gap: 2px; padding: 6px 8px; text-align: left; width: 100%; }
.studio-search-hit:hover { background: var(--studio-surface-hover); }
.studio-search-hit-line { color: var(--studio-text-muted); font: 11px var(--studio-mono); }
.studio-search-hit-line b { color: var(--studio-accent-strong); font-weight: 500; }
.studio-search-hit-text { font: 11.5px/1.4 var(--studio-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-search-hit-kind { color: var(--studio-text-dim); font-size: 11px; }
.studio-data-table { border-collapse: collapse; display: block; font: 11px var(--studio-mono); overflow-x: auto; width: 100%; }
.studio-data-table th, .studio-data-table td { border: 1px solid var(--studio-stroke); max-width: 280px; overflow: hidden; padding: 4px 7px; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.studio-data-table th { color: var(--studio-text-dim); font-weight: 500; }
.studio-data-table td { color: var(--studio-text); }

/* ---------- device popover ---------- */
.studio-device-popover {
  background: var(--studio-panel); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius-lg); box-shadow: 0 18px 60px rgba(0, 0, 0, .7);
  color: var(--studio-text); display: grid; font-size: 11.5px; gap: 12px; max-height: calc(100vh - 72px); overflow: auto; padding: 14px; position: fixed; right: 12px; top: 56px;
  width: min(440px, calc(100vw - 24px)); z-index: 90;
}
.studio-device-popover[hidden] { display: none; }
.studio-device-section { display: grid; gap: 6px; }
.studio-device-section h3 { color: var(--studio-text-dim); font-size: 10.5px; font-weight: 600; letter-spacing: .06em; margin: 0; text-transform: uppercase; }
.studio-device-row { align-items: center; display: grid; gap: 8px; grid-template-columns: 96px minmax(0, 1fr) auto; }
.studio-device-row-label { color: var(--studio-text-dim); }
.studio-device-row-value { min-width: 0; overflow-wrap: anywhere; }
.studio-device-note { color: var(--studio-text-muted); line-height: 1.45; margin: 0; }
.studio-device-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 6px; }
.studio-device-actions button, .studio-device-row button {
  background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius); color: var(--studio-text); cursor: pointer; font-size: 11.5px; font-weight: 500; height: 26px; padding: 0 9px;
}
.studio-device-actions button:hover, .studio-device-row button:hover { background: var(--studio-surface-hover); }
.studio-device-actions button:disabled, .studio-device-row button:disabled { cursor: default; opacity: .5; }
.studio-device-trust { background: var(--studio-accent) !important; border-color: transparent !important; color: var(--studio-accent-ink) !important; font-weight: 600; }
.studio-device-revoke, .studio-device-decline { color: var(--studio-error) !important; }
.studio-device-scenario {
  background: var(--studio-bg-deep); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius); color: var(--studio-text); font-size: 11.5px; max-width: 100%; padding: 4px 6px;
}
.studio-device-code-block {
  background: var(--studio-bg-deep); border: 1px solid var(--studio-stroke); border-radius: var(--studio-radius); display: block; font: 11px var(--studio-mono); overflow-wrap: anywhere; padding: 6px 8px; user-select: all;
}
.studio-device-code { display: block; font: 700 30px var(--studio-mono); letter-spacing: .12em; padding: 4px 0; text-align: center; }
.studio-device-countdown { color: var(--studio-text-muted); }
.studio-device-qr-box { background: #fff; border-radius: 8px; justify-self: center; padding: 8px; width: 200px; }
.studio-device-qr-box svg { display: block; height: auto; width: 100%; }
.studio-device-revision[data-revision="applied"] { color: var(--studio-positive); }
.studio-device-revision[data-revision="behind"] { color: var(--studio-error); }
.studio-device-diagnostics { display: grid; gap: 4px; list-style: none; margin: 0; padding: 0; }
.studio-device-diagnostic { color: var(--studio-warning); }
.studio-device-diagnostic::before { content: "⚠ "; }
.studio-device-status { color: var(--studio-text-muted); margin: 0; }
.studio-device-status[data-state="error"] { color: var(--studio-error); }
.studio-device-status[hidden] { display: none; }

/* ---------- agent ---------- */
.studio-agent-host { display: contents; }
.studio-agent-panel {
  background: var(--studio-panel); border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius-lg);
  bottom: 12px; box-shadow: 0 16px 48px rgba(0, 0, 0, .6), 0 0 0 1px var(--studio-stroke); color: var(--studio-text);
  display: flex; flex-direction: column; font: 12px/1.45 var(--studio-font); height: 500px; left: 52px;
  max-height: calc(100vh - 72px); max-width: calc(100vw - 64px); min-height: 0; overflow: hidden; position: fixed;
  transition: width 150ms ease, height 150ms ease, box-shadow 150ms ease; width: 480px; z-index: 85;
}
.studio-agent-panel[data-minimized="true"] {
  box-shadow: 0 4px 16px rgba(0, 0, 0, .4), 0 0 0 1px var(--studio-stroke); height: 34px; width: 200px;
}
.studio-agent-panel[data-dragging="true"] {
  box-shadow: 0 24px 64px rgba(0, 0, 0, .75), 0 0 0 1px var(--studio-accent);
  cursor: grabbing; transition: none !important; user-select: none;
}
.studio-agent-panel[data-dragging="true"] .studio-agent-header {
  cursor: grabbing;
}
.studio-agent-panel[data-minimized="true"] .studio-agent-body { display: none; }
.studio-agent-header {
  align-items: center; background: var(--studio-panel-raised); border-bottom: 1px solid var(--studio-stroke); cursor: grab;
  display: flex; flex: none; gap: 8px; height: 34px; justify-content: space-between; padding: 0 8px 0 12px; touch-action: none; user-select: none;
}
.studio-agent-panel[data-minimized="true"] .studio-agent-header { border-bottom: 0; }
.studio-agent-header-title { align-items: center; color: var(--studio-text); display: flex; font-size: 12px; font-weight: 600; gap: 7px; }
.studio-agent-header-title .studio-icon { color: var(--studio-accent); height: 14px; width: 14px; }
.studio-agent-header-actions { align-items: center; display: flex; gap: 4px; }
.studio-agent-collapse {
  align-items: center; background: transparent; border: 0; border-radius: var(--studio-radius); color: var(--studio-text-dim);
  cursor: pointer; display: inline-flex; font-family: var(--studio-mono); font-size: 14px; font-weight: 700; height: 22px;
  justify-content: center; line-height: 1; padding: 0; width: 22px;
}
.studio-agent-collapse:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-agent-body { display: grid; flex: 1; grid-template-rows: minmax(0, 1fr); min-height: 0; overflow: hidden; }
.studio-agent-chat { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; height: 100%; min-height: 0; }
.studio-agent-chat-controls { align-items: center; border-bottom: 1px solid var(--studio-stroke); display: flex; gap: 8px; padding: 8px 12px; }
.studio-agent-chat-controls .studio-select { width: auto; }
.studio-agent-chat-controls .studio-switch { margin-left: auto; }
.studio-agent-status { color: var(--studio-text-dim); font-size: 11px; line-height: 1.4; padding: 8px 12px 0; }
.studio-agent-status[data-state="on"] { color: var(--studio-positive); }
.studio-agent-log { display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow: auto; padding: 10px 12px; }
.studio-agent-message { display: grid; font-size: 12px; gap: 4px; line-height: 1.5; min-width: 0; }
.studio-agent-message[data-role="you"] { background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke-strong); border-radius: 10px 10px 3px 10px; justify-self: end; max-width: 90%; padding: 6px 10px; }
.studio-agent-message[data-role="you"] .studio-agent-who { display: none; }
.studio-agent-who { align-items: center; color: var(--studio-text-dim); display: flex; font-size: 11px; gap: 6px; }
.studio-agent-who::before { background: var(--studio-accent); border-radius: 3px; color: var(--studio-accent-ink); content: "T"; display: inline-flex; font: 700 8px/1 var(--studio-font); height: 14px; justify-content: center; align-items: center; width: 14px; }
.studio-agent-text { overflow-wrap: anywhere; white-space: pre-wrap; }
.studio-agent-line { color: var(--studio-text-dim); font-size: 11.5px; overflow-wrap: anywhere; }
.studio-agent-line[data-tone="error"] { color: var(--studio-error); }
.studio-agent-line[data-tone="warn"] { color: var(--studio-warning); }
.studio-agent-line[data-tone="ok"] { color: var(--studio-positive); }
.studio-agent-line[data-tone="quiet"] { color: var(--studio-text-dim); font-size: 11px; }
.studio-agent-link { color: var(--studio-accent-strong); cursor: pointer; text-decoration: none; }
.studio-agent-link:hover { text-decoration: underline; text-underline-offset: 2px; }
.studio-agent-tools { border-left: 2px solid var(--studio-stroke-strong); color: var(--studio-text-dim); font: 11px var(--studio-mono); padding-left: 8px; }
.studio-agent-tools > summary { cursor: pointer; }
.studio-agent-tools div { margin: 3px 0 3px 4px; overflow-wrap: anywhere; }
.studio-agent-tools span { color: var(--studio-text-muted); }
.studio-agent-card { border: 1px solid var(--studio-stroke-strong); border-radius: var(--studio-radius-lg); display: grid; gap: 6px; padding: 8px 10px; }
.studio-agent-card > strong { font-size: 12px; }
.studio-agent-card[data-tone="warn"] { border-color: rgba(251, 191, 36, .45); }
.studio-agent-card[data-tone="warn"] > strong { color: var(--studio-warning); }
.studio-agent-card[data-tone="error"] { border-color: rgba(255, 92, 92, .45); }
.studio-agent-card[data-tone="error"] > strong { color: var(--studio-error); }
.studio-agent-card[data-tone="ok"] { border-color: rgba(74, 222, 128, .45); }
.studio-agent-card[data-tone="ok"] > strong { color: var(--studio-positive); }
.studio-agent-card[data-tone="info"] { border-color: rgba(90, 169, 255, .45); }
.studio-agent-card[data-tone="info"] > strong { color: var(--studio-info); }
.studio-agent-card pre { background: var(--studio-bg-deep); border-radius: var(--studio-radius); font: 11px/1.5 var(--studio-mono); margin: 0; max-height: 220px; overflow: auto; padding: 6px 8px; white-space: pre-wrap; }
.studio-agent-card-actions { display: flex; gap: 6px; }
.studio-agent-composer { align-items: center; border-top: 1px solid var(--studio-stroke); display: flex; gap: 6px; padding: 10px 12px 12px; }
.studio-agent-composer .studio-input { height: 30px; }

/* ---------- responsive ---------- */
@media (max-width: 1400px) {
  .studio-center {
    --studio-right-size: 0px !important;
    grid-template-columns: 0 0 minmax(280px, 1fr) 4px minmax(280px, var(--studio-preview-size));
  }
  .studio-pane-right, .studio-divider-right { display: none; }
  .studio-reload { display: none; }
  .studio-command-palette { width: 160px; }
  .studio-toolbar { gap: 8px; }
  .studio-toolbar-actions { gap: 5px; }
  .studio-status { max-width: 26vw; }
}
@media (max-width: 760px) {
  .tao-studio-product-host { overflow: clip; }
  .studio-toolbar { grid-template-columns: minmax(0, 1fr) auto; padding-inline: 8px; }
  .studio-toolbar-mode { justify-self: end; }
  .studio-toolbar-actions, .studio-window-controls, .studio-picker, .studio-app-picker, .studio-command-palette { display: none; }
  .studio-body { grid-template-columns: 0 0 0 minmax(0, 1fr); }
  .studio-rail, .studio-sidebar, .studio-divider-left { display: none; }
  .studio-agent-panel { left: 12px; width: calc(100vw - 24px); }
  .studio-agent-panel[data-minimized="true"] { width: 180px; }
  .studio-center {
    --studio-bottom-size: 0px !important;
    grid-column: 4;
    grid-template-columns: 0 0 minmax(0, 1fr) 4px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
  .studio-divider-bottom, .studio-drawer { display: none; }
  .studio-editor-pane, .studio-preview { min-width: 0; }
  .tao-studio-product-host[data-layout-preset="code"] .studio-center {
    grid-template-columns: 0 0 minmax(0, 1fr) 0 0;
  }
  .tao-studio-product-host[data-layout-preset="design"] .studio-center {
    grid-template-columns: 0 0 minmax(0, 1fr) 4px minmax(0, 1fr);
  }
  .tao-studio-product-host[data-layout-preset="run"] .studio-center,
  .tao-studio-product-host[data-layout-preset="draw"] .studio-center {
    grid-template-columns: 0 0 0 0 minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
  .tao-studio-product-host[data-layout-preset="draw"] .studio-editor-pane,
  .tao-studio-product-host[data-layout-preset="draw"] .studio-inspector-pane,
  .tao-studio-product-host[data-layout-preset="draw"] .studio-divider-preview,
  .tao-studio-product-host[data-layout-preset="draw"] .studio-divider-right { display: none; }
  .tao-studio-product-host[data-layout-preset="draw"] .studio-preview { grid-column: 1 / 6; grid-row: 1; }
}
`
