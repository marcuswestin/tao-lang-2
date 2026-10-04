import { Errors, FS, HCI, Platform, ProjectIdentity, Repo, Time } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'
import { activateSmokePreviews } from '../studio-tooling-src/StudioSmokePreviews'

const themeSource = (color: string, size: number) =>
  `public design Theme {
   ink ${color}
   title [fg ink, size ${size}]
}
`

function appSource(focused: boolean, sameFile: boolean, theme: string): string {
  return `use Button, Col, Text from @tao/ui
use StackNav from @tao/nav
${sameFile ? theme : 'use Theme from ./Theme'}
${focused ? '' : 'use Counter from ./Counter'}

app DesignSmoke {
   id "tao-studio-design-refresh"
   version "1.0.0"
   name "Design smoke"
   Navigator StackNav { Initial Main }
   Design Theme
}
scene Main() {
   Title "Root"
   render Button("Next") { on press -> { present Detail() } }
}
scene Detail() {
   Title "Detail"
   render Counter()
}
${focused ? counterSource : ''}
${
    focused
      ? `fixture Empty { }
scenarios Counter "design" {
   fixture Empty
   device phone
   scenario "first" { render Counter() }
   scenario "second" { render Counter() }
}`
      : ''
  }
`
}

const counterSource = `public view Counter() {
   state Count = 0
   action Increment() { set Count += 1 }
   render Col() {
      Button("Increment") { on press Increment }
      Text("Count: {Count}")
      Text("DesignProbe") [title]
   }
}
`

/** Observe actual computed-style replacement, then two visible animation frames; text stays constant. */
const designProbe = `(() => {
  if (!location.search.includes('taoStudioPreviewInstanceId=')) return
  const probe = window.__taoDesignProbe = { watch: [], samples: {}, hmr: [] }
  const now = () => performance.timeOrigin + performance.now()
  const check = () => {
    const leaf = [...document.querySelectorAll('[data-tao-studio]')]
      .filter(node => node.textContent?.trim() === 'DesignProbe')
      .sort((a, b) => a.querySelectorAll('[data-tao-studio]').length - b.querySelectorAll('[data-tao-studio]').length)[0]
    if (!leaf) return
    const style = getComputedStyle(leaf)
    for (const expected of probe.watch) {
      if (probe.samples[expected.key] || style.color !== expected.color || style.fontSize !== expected.fontSize) continue
      const sample = probe.samples[expected.key] = { domAt: now() }
      requestAnimationFrame(() => requestAnimationFrame(() => { sample.paintAt = now() }))
    }
  }
  new MutationObserver(check).observe(document, { attributes: true, characterData: true, childList: true, subtree: true })
  const NativeSocket = window.WebSocket
  function ProbedSocket(...args) {
    const socket = new NativeSocket(...args)
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return
      const type = /"type":"([a-z-]+)"/.exec(event.data)?.[1]
      if (type?.startsWith('update')) { probe.hmr.push({ at: now(), type }); check() }
    })
    return socket
  }
  ProbedSocket.prototype = NativeSocket.prototype
  Object.assign(ProbedSocket, { CLOSED: 3, CLOSING: 2, CONNECTING: 0, OPEN: 1 })
  window.WebSocket = ProbedSocket
})()`

const styleExpression = `(() => {
  const leaf = [...document.querySelectorAll('[data-tao-studio]')]
    .filter(node => node.textContent?.trim() === 'DesignProbe')
    .sort((a, b) => a.querySelectorAll('[data-tao-studio]').length - b.querySelectorAll('[data-tao-studio]').length)[0]
  return leaf ? { color: getComputedStyle(leaf).color, fontSize: getComputedStyle(leaf).fontSize } : null
})()`

for (
  const configuration of [
    { focused: true, sameFile: false, name: 'imported design in two focused previews' },
    { focused: false, sameFile: false, name: 'imported design in a whole-app preview' },
    { focused: true, sameFile: true, name: 'same-file design in two focused previews' },
  ]
) {
  Test(
    `Studio delivers ${configuration.name} with ${configuration.focused ? 'held state' : 'retained navigation'}`,
    async () => {
      const projectRoot = await mkTestDir('tao-studio-design-refresh-')
      const appPath = FS.resolvePath('DesignSmoke.tao', projectRoot)
      const themePath = configuration.sameFile ? appPath : FS.resolvePath('Theme.tao', projectRoot)
      let browser: StudioCdp | undefined
      let studio: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
      const rows: Array<{ edit: number; loadAverage: number; saveAt: number; samples: unknown[]; totalMs: number }> = []
      try {
        await FS.mkdir(FS.resolvePath('.tao', projectRoot))
        await ProjectIdentity.ensure(projectRoot)
        const writeTheme = async (color: string, size: number): Promise<void> => {
          const theme = themeSource(color, size)
          await FS.writeText(
            themePath,
            configuration.sameFile
              ? appSource(configuration.focused, true, theme)
              : theme,
          )
        }
        await FS.writeText(
          appPath,
          appSource(configuration.focused, configuration.sameFile, themeSource('#224466', 16)),
        )
        if (!configuration.focused) {
          await FS.writeText(
            FS.resolvePath('Counter.tao', projectRoot),
            'use Button, Col, Text from @tao/ui\n' + counterSource,
          )
        }
        await writeTheme('#224466', 16)
        studio = await startStudioSmokeLaunch({ appName: 'DesignSmoke', projectRoot })
        browser = await StudioCdp.launchChrome({ artifactRoot: studio.readiness.artifactRoot })
        await browser.addInitScript(designProbe)
        await browser.setViewport(2_000, 1_400)
        await browser.goto(studio.readiness.sessionUrl)
        await browser.waitFor('document.querySelector(".studio-preview-activation-toggle") !== null')
        await browser.evaluate('document.querySelector("[data-preset=run]").click()')
        await activateSmokePreviews(browser)
        const urls = await browser.evaluate<string[]>(
          'Array.from(document.querySelectorAll(".studio-preview-cell iframe")).map(frame => frame.src)',
        )
        Expect(urls.length).toBe(configuration.focused ? 2 : 1)
        for (const [index, url] of urls.entries()) {
          if (!configuration.focused) {
            await browser.waitForInFrame(url, 'document.body.textContent.includes("Next")', { timeoutMs: 60_000 })
            await clickText(browser, url, 'Next')
          }
          await browser.waitForInFrame(url, 'document.body.textContent.includes("DesignProbe")', { timeoutMs: 60_000 })
          Expect(await browser.evaluateInFrame(url, styleExpression)).toEqual({
            color: 'rgb(34, 68, 102)',
            fontSize: '16px',
          })
          for (let press = 0; press <= index; press++) {
            await clickText(browser, url, 'Increment')
          }
          await browser.waitForInFrame(url, `document.body.textContent.includes('Count: ${index + 1}')`)
        }
        await Time.sleep(1_000)
        await browser.evaluate(`(() => {
        window.__taoDesignLoads = 0
        document.addEventListener('load', event => {
          if (event.target instanceof HTMLIFrameElement) window.__taoDesignLoads += 1
        }, true)
      })()`)
        for (let edit = 1; edit <= 8; edit++) {
          const blue = 102 + edit * 8
          const size = 16 + Math.ceil(edit / 2)
          const color = edit % 2 === 1 ? `#2244${blue.toString(16)}` : `#3344${blue.toString(16)}`
          const expected = {
            key: `edit${edit}`,
            color: `rgb(${edit % 2 === 1 ? 34 : 51}, 68, ${blue})`,
            fontSize: `${size}px`,
          }
          for (const url of urls) {
            await browser.evaluateInFrame(url, `window.__taoDesignProbe.watch.push(${JSON.stringify(expected)})`, {
              world: 'page',
            })
          }
          const saveAt = Date.now()
          await writeTheme(color, size)
          const samples: Array<{ domAt: number; paintAt: number }> = []
          for (const [index, url] of urls.entries()) {
            const painted = await Time.pollUntil(() =>
              browser!.evaluateInFrame<boolean>(
                url,
                `window.__taoDesignProbe.samples[${JSON.stringify(expected.key)}]?.paintAt !== undefined`,
                { world: 'page' },
              ), { intervalMs: 50, timeoutMs: 30_000 })
            Expect(painted).toBe(true)
            samples.push(
              await browser.evaluateInFrame(url, `window.__taoDesignProbe.samples[${JSON.stringify(expected.key)}]`, {
                world: 'page',
              }),
            )
            if (configuration.focused) {
              Expect(await browser.evaluateInFrame(url, `document.body.textContent.includes('Count: ${index + 1}')`))
                .toBe(true)
            } else {
              // Whole-app local state already resets on imported-module HMR in the baseline.
              // Step 7 proves live design delivery and retained navigation; containing that
              // importing app refresh belongs to the later design delivery/subscription slice.
              Expect(await browser.evaluateInFrame(url, 'document.body.textContent.includes("Detail")')).toBe(true)
            }
          }
          rows.push({
            edit,
            loadAverage: Platform.loadAverage(),
            saveAt,
            samples,
            totalMs: Math.round(Math.max(...samples.map(sample => sample.paintAt)) - saveAt),
          })
          Expect(await browser.evaluate('window.__taoDesignLoads')).toBe(0)
          await Time.sleep(250)
        }
        // A bundle rename and its consumer must arrive together without an old-view/new-design error.
        const coordinated = { key: 'coordinated', color: 'rgb(68, 85, 119)', fontSize: '24px' }
        for (const url of urls) {
          await browser.evaluateInFrame(url, `window.__taoDesignProbe.watch.push(${JSON.stringify(coordinated)})`, {
            world: 'page',
          })
        }
        const renamedTheme = themeSource('#445577', 24).replace('title [', 'headline [')
        if (configuration.sameFile) {
          await FS.writeText(
            appPath,
            appSource(configuration.focused, true, renamedTheme).replace('[title]', '[headline]'),
          )
        } else {
          await FS.writeText(themePath, renamedTheme)
          await FS.writeText(
            configuration.focused ? appPath : FS.resolvePath('Counter.tao', projectRoot),
            (configuration.focused
              ? appSource(true, false, '')
              : 'use Button, Col, Text from @tao/ui\n' + counterSource)
              .replace('[title]', '[headline]'),
          )
        }
        for (const url of urls) {
          Expect(
            await Time.pollUntil(() =>
              browser!.evaluateInFrame<boolean>(
                url,
                'window.__taoDesignProbe.samples.coordinated?.paintAt !== undefined',
                { world: 'page' },
              ), { intervalMs: 50, timeoutMs: 30_000 }),
          ).toBe(true)
          if (!configuration.focused) {
            Expect(await browser.evaluateInFrame(url, 'document.body.textContent.includes("Detail")')).toBe(true)
          }
        }
        Expect(await browser.evaluate('window.__taoDesignLoads')).toBe(0)
        const warm = rows.slice(1).map(row => row.totalMs).sort((a, b) => a - b)
        const path = Repo.resolvePath(
          `.artifacts/tests/studio-smoke/preview-latency/design-${configuration.focused ? 'focused' : 'whole-app'}-${
            configuration.sameFile ? 'same-file' : 'imported'
          }-${Date.now()}.json`,
        )
        await FS.writeJson(path, {
          configuration,
          rows,
          p50Ms: warm[Math.floor(warm.length / 2)],
          browserEvents: browser.browserEvents(),
        })
        HCI.writeLine(`Design refresh ${configuration.name}: p50 ${warm[Math.floor(warm.length / 2)]}ms; ${path}`)
        Expect(browser.consoleErrors()).toEqual([])
      } catch (error) {
        if (browser !== undefined) {
          const path = Repo.resolvePath(
            `.artifacts/tests/studio-smoke/preview-latency/design-failure-${Date.now()}.json`,
          )
          const frames = await browser.evaluate<string[]>(
            'Array.from(document.querySelectorAll(".studio-preview-cell iframe")).map(frame => frame.src)',
          ).catch(() => [])
          const states = await Promise.all(
            frames.map(url =>
              browser!.evaluateInFrame(
                url,
                `({ text: document.body.textContent, style: ${styleExpression}, probe: window.__taoDesignProbe })`,
                { world: 'page' },
              ).catch(() => undefined)
            ),
          )
          await FS.writeJson(path, {
            configuration,
            rows,
            states,
            events: browser.browserEvents(),
            output: studio?.output(),
          })
          await browser.captureScreenshot('design-refresh-failure')
        }
        throw error
      } finally {
        await browser?.close()
        await studio?.stop()
        await FS.remove(projectRoot)
      }
    },
    300_000,
  )
}

async function clickText(browser: StudioCdp, url: string, text: string): Promise<void> {
  const pressed = await browser.evaluateInFrame<boolean>(
    url,
    `(() => {
    const node = [...document.querySelectorAll('button, [role=button]')]
      .find(node => node.textContent?.trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())})
    if (!node) return false
    node.click()
    return true
  })()`,
  )
  if (!pressed) {
    Errors.throwUnexpected(`Missing ${text} action in the design preview.`)
  }
}
