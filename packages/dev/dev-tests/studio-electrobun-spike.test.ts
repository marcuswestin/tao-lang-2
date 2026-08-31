import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { StudioElectrobunSpike } from '../dev-src/studio/StudioElectrobunSpike'

const options = {
  outputRoot: '/tmp/unused-by-source-tests',
  previewUrl: 'http://localhost:8081',
  studioUrl: 'http://127.0.0.1:55101',
} as const

Describe('Studio Electrobun feasibility spike', () => {
  Test('generates a direct-Hutch Bun app covering every settled spike capability', () => {
    const generated = StudioElectrobunSpike.sources(options)

    Expect(StudioElectrobunSpike.capabilities(generated)).toEqual({
      differentialUpdates: true,
      fileDialogs: true,
      iframeToMetroOrigin: true,
      multiWindow: true,
      nativeMenus: true,
      shortcuts: true,
      signedMacBuildConfigured: true,
      websocketToStudioServer: true,
    })
    Expect(generated.config).toContain("mainProcess: 'bun'")
    Expect(generated.config).toContain("entrypoint: 'src/bun/index.ts'")
    Expect(generated.main).toContain('import Electrobun, {')
    Expect(generated.main).toContain("} from 'electrobun/main'")
    Expect(generated.main).toContain("Electrobun.events.on('application-menu-clicked'")
    Expect(generated.main).toContain('new WebSocket(websocketUrl(')
    Expect(generated.main).toContain("document.createElement('iframe')")
    Expect(generated.hutchConfig).toContain("install: ['hutch', 'install']")
    Expect(generated.hutchConfig).toContain('// @hutch cli=0.24.3 cottontail=0.5.0')
    Expect(generated.hutchConfig).toContain('electrobun: { version: "2.0.2-beta.12" }')
    Expect(generated.hutchConfig).not.toContain('packageManager')
    Expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(generated.main)).not.toThrow()
  })

  Test('copies the packaged service beside the generated Bun entrypoint and drains it before quit', () => {
    const generated = StudioElectrobunSpike.sources({ ...options, packagedService: true })

    Expect(generated.config).toContain("copy: { 'service/payload': 'service' }")
    Expect(generated.main).toContain("import.meta.dir + '/../service/packages/runtime-toolchain'")
    Expect(generated.main).toContain('event.response = { allow: false }')
    Expect(generated.main).toContain('quitting ??= packagedService.stop()')
    Expect(generated.main).toContain('quitAfterCleanup = true')
  })

  Test('routes native project opens and window closes through opaque Studio sessions', () => {
    const main = StudioElectrobunSpike.sources(options).main

    Expect(main).toContain("fetch(new URL('/api/sessions/open', studioUrl)")
    Expect(main).toContain('projectSessionUrl(process.env.TAO_STUDIO_PROJECT_URL)')
    Expect(main).toContain("createStudioWindow('Project', projectSessionUrl(opened.url), openedPreviewUrl)")
    Expect(main).toContain('value.pathname.match(/^\\/sessions\\/([A-Za-z0-9_-]{1,128})')
    Expect(main).toContain("'/api/sessions/' + encodeURIComponent(sessionId) + '/close'")
    Expect(main).toContain("method: 'POST'")
    Expect(main).toContain('url.origin !== studioUrl.origin')
    Expect(main).toContain("searchParams.get('native-preview-url')")
    Expect(main).toContain("navigated?.pathname === '/welcome'")
  })

  Test('materializes an executable spike project and exact Hutch commands', async () => {
    const outputRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-electrobun-', FS.tmpdir()))
    try {
      const project = await StudioElectrobunSpike.create({
        ...options,
        outputRoot,
        runProbe: true,
        showWindow: false,
      })

      Expect(await FS.isFile(project.mainPath)).toBe(true)
      Expect(await FS.isFile(project.configPath)).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('hutch.config.ts', project.root))).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('package.json', project.root))).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('tsconfig.json', project.root))).toBe(true)
      Expect(project.install).toEqual({ args: ['install'], command: 'hutch', cwd: project.root })
      Expect(project.prepare).toEqual({ args: ['electrobun', 'prepare'], command: 'hutch', cwd: project.root })
      Expect(project.sync).toEqual({ args: ['electrobun', 'sync'], command: 'hutch', cwd: project.root })
      Expect(project.dev).toMatchObject({
        args: ['run', 'dev'],
        command: 'hutch',
        cwd: project.root,
        env: {
          TAO_STUDIO_ELECTROBUN_RUN_PROBE: 'true',
          TAO_STUDIO_ELECTROBUN_SHOW_WINDOWS: 'false',
          TAO_STUDIO_PREVIEW_URL: 'http://localhost:8081/',
          TAO_STUDIO_PROJECT_URL: 'http://127.0.0.1:55101/',
          TAO_STUDIO_URL: 'http://127.0.0.1:55101/',
        },
      })
      Expect(project.buildCanary.args).toEqual(['run', 'build:canary'])
      Expect(project.buildStable.args).toEqual(['run', 'build:stable'])
    } finally {
      await FS.remove(outputRoot)
    }
  })

  Test('refuses non-loopback shell and preview URLs', () => {
    Expect(() =>
      StudioElectrobunSpike.sources({
        ...options,
        studioUrl: 'https://studio.example.com',
      })
    ).toThrow('Studio server must be a loopback HTTP URL.')
    Expect(() =>
      StudioElectrobunSpike.sources({
        ...options,
        previewUrl: 'http://192.168.1.20:8081',
      })
    ).toThrow('Studio preview must be a loopback HTTP URL.')
  })
})
