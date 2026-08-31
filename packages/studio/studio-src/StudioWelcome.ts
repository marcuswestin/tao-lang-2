import type { StudioSessionListing } from './StudioSessionManager'

/** Server-rendered Welcome surface; native shells may replace it without changing session ownership. */
export const StudioWelcome = {
  html(listing: StudioSessionListing): string {
    const current = listing.current.length === 0
      ? '<p class="empty">No projects are open.</p>'
      : `<ul>${
        listing.current.map(session => `
          <li>
            <a href="/sessions/${encodeURIComponent(session.sessionId)}">
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
    :root { color: #e8e7e3; background: #171918; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; padding: 48px; }
    main { margin: 0 auto; max-width: 760px; }
    h1 { font-size: 28px; margin: 0 0 36px; }
    h2 { color: #aeb5ae; font-size: 12px; letter-spacing: .1em; margin-top: 30px; text-transform: uppercase; }
    ul { display: grid; gap: 8px; list-style: none; padding: 0; }
    li, a, button { background: #202321; border: 1px solid #353936; border-radius: 8px; color: inherit; display: grid; padding: 12px 14px; text-align: left; text-decoration: none; width: 100%; }
    a:hover, button:hover { background: #2b302c; cursor: pointer; }
    span, .empty { color: #8f9790; font-size: 12px; overflow-wrap: anywhere; }
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
    const response = await fetch('/api/sessions')
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
      const response = await fetch('/api/sessions/open', {
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
} as const

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
