import { StudioRoutes, StudioSessionPath } from './StudioProtocol'
import type { StudioSessionListing } from './StudioSessionManager'

/*
 * Server-rendered Welcome surface; native shells may replace it without changing session ownership.
 *
 * The inline `<script>` below is plain browser JavaScript inside a template literal, not a module this
 * package compiles or bundles: it has no import graph, so it cannot reach `Assert` or `Errors` and its
 * one raw `Error` throw stays. `repo-lint` scans file text, so this file keeps its allowlist entry.
 */
export const StudioWelcome = {
  html(listing: StudioSessionListing): string {
    const current = listing.current.length === 0
      ? '<p class="empty">No projects are open.</p>'
      : `<ul>${
        listing.current.map(session => `
          <li>
            <a href="${StudioSessionPath.window(session.sessionId)}">
              <strong>${escapeHtml(session.appName)}</strong>
              <span>${escapeHtml(session.project)}</span>
            </a>
          </li>`).join('')
      }
        </ul>`
    const recent = listing.recent.length === 0
      ? '<p class="empty">Recently opened projects will appear here.</p>'
      : `<ul>${
        listing.recent.map(project => `
          <li><button type="button" data-app-name="${escapeHtml(project.appName)}" data-project="${
          escapeHtml(project.project)
        }"><strong>${escapeHtml(project.appName)}</strong><span>${escapeHtml(project.project)}</span></button></li>`)
          .join('')
      }
        </ul>`
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Welcome to Tao Studio</title>
  <style>
    :root { color: #f4f4f4; background: #0f0f0f; font: 14px/1.5 -apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    body { margin: 0; padding: 48px; }
    main { margin: 0 auto; max-width: 760px; }
    h1 { align-items: center; display: flex; font-size: 26px; font-weight: 600; gap: 12px; letter-spacing: -.01em; margin: 0 0 36px; }
    h1::before { align-items: center; background: #f4f4f4; border-radius: 8px; color: #0f0f0f; content: "T"; display: inline-flex; font-size: 17px; font-weight: 700; height: 30px; justify-content: center; width: 30px; }
    h2 { color: #6b6b6b; font-size: 11px; font-weight: 600; letter-spacing: .08em; margin-top: 30px; text-transform: uppercase; }
    ul { display: grid; gap: 8px; list-style: none; padding: 0; }
    li, a, button { background: #151515; border: 1px solid #262626; border-radius: 7px; color: inherit; display: grid; font: inherit; padding: 12px 14px; text-align: left; text-decoration: none; width: 100%; }
    a:hover, button:hover { border-color: #ff6a1f; cursor: pointer; }
    strong { font-weight: 600; }
    span, .empty { color: #a3a3a3; font-size: 12px; overflow-wrap: anywhere; }
  </style>
</head>
<body><main><h1>Tao Studio</h1><section id="current"><h2>Open projects</h2>${current}</section><section id="recent"><h2>Recent projects</h2>${recent}</section></main>
<script>
  const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const currentMarkup = listing => listing.current.length === 0
    ? '<p class="empty">No projects are open.</p>'
    : '<ul>' + listing.current.map(session => '<li><a href="/sessions/' + encodeURIComponent(session.sessionId) + '"><strong>' + escapeHtml(session.appName) + '</strong><span>' + escapeHtml(session.project) + '</span></a></li>').join('') + '</ul>'
  const recentMarkup = listing => listing.recent.length === 0
    ? '<p class="empty">Recently opened projects will appear here.</p>'
    : '<ul>' + listing.recent.map(project => '<li><button type="button" data-app-name="' + escapeHtml(project.appName) + '" data-project="' + escapeHtml(project.project) + '"><strong>' + escapeHtml(project.appName) + '</strong><span>' + escapeHtml(project.project) + '</span></button></li>').join('') + '</ul>'
  async function refresh() {
    const response = await fetch('${StudioRoutes.manager.sessions.path}')
    if (!response.ok) return
    const listing = await response.json()
    document.querySelector('#current').innerHTML = '<h2>Open projects</h2>' + currentMarkup(listing)
    document.querySelector('#recent').innerHTML = '<h2>Recent projects</h2>' + recentMarkup(listing)
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('button[data-project]')
    if (!button) return
    button.disabled = true
    try {
      const response = await fetch('${StudioRoutes.manager.openSession.path}', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appName: button.dataset.appName, projectPath: button.dataset.project }),
      })
      const opened = await response.json()
      if (!response.ok || typeof opened.url !== 'string') throw new Error(opened.error || 'Studio could not reopen this project.')
      location.assign(opened.url)
    } catch (error) {
      button.disabled = false
      alert(error instanceof Error ? error.message : String(error))
    }
  })
  setInterval(() => void refresh().catch(() => {}), 2000)
  void refresh().catch(() => {})
</script></body>
</html>`
  },
  sessionUnavailable(): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Project session unavailable — Tao Studio</title>
  <style>
    :root { color: #f4f4f4; background: #0f0f0f; font: 14px/1.5 -apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    body { align-items: center; display: grid; margin: 0; min-height: 100vh; padding: 32px; }
    main { background: #151515; border: 1px solid #262626; border-radius: 10px; box-sizing: border-box; margin: 0 auto; max-width: 620px; padding: 32px; width: 100%; }
    .eyebrow { color: #ff8a4c; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
    h1 { font-size: 24px; font-weight: 600; letter-spacing: -.01em; margin: 8px 0 12px; }
    p { color: #a3a3a3; margin: 0 0 24px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    a, button { background: #1e1e1e; border: 1px solid #363636; border-radius: 5px; color: inherit; font: inherit; font-weight: 500; padding: 8px 14px; text-decoration: none; }
    a { background: #ff6a1f; border-color: transparent; color: #140800; font-weight: 600; }
    a:hover { background: #ff8a4c; cursor: pointer; }
    button:hover { background: #232323; cursor: pointer; }
    small { color: #6b6b6b; display: block; margin-top: 22px; }
  </style>
</head>
<body><main>
  <div class="eyebrow">Project unavailable</div>
  <h1>This Studio session is no longer open.</h1>
  <p>The window refers to a session owned by an earlier Studio server. This commonly happens after Studio restarts or a previous development process exits.</p>
  <div class="actions">
    <a href="/welcome?native-window=welcome">Choose a project</a>
    <button type="button" id="close-window">Close window</button>
  </div>
  <small>You can also close this window with Command-W.</small>
</main>
<script>document.querySelector('#close-window').addEventListener('click', () => window.close())</script>
</body>
</html>`
  },
} as const

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
