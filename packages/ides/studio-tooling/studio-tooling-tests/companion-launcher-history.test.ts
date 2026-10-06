import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

const plugin = require('../../studio-companion-app/plugins/with-launcher-history.cjs') as {
  patchHistorySource(file: string, source: string): string
  patchPodfile(source: string): string
}

Describe('Companion launcher history projection', () => {
  Test('projects the pinned launcher sources without changing the installed package', async () => {
    const clientRoot = FS.dirname(require.resolve('expo-dev-client/package.json', {
      paths: [Repo.resolvePath('packages/ides/studio-companion-app')],
    }))
    const root = FS.dirname(require.resolve('expo-dev-launcher/package.json', { paths: [clientRoot] }))
    const read = (file: string) => FS.readText(FS.resolvePath(`ios/${file}`, root))
    const registry = await read('EXDevLauncherRecentlyOpenedAppsRegistry.swift')
    const model = await read('SwiftUI/DevLauncherViewModel.swift')
    const views = await read('SwiftUI/DevLauncherViews.swift')
    Expect(plugin.patchHistorySource('EXDevLauncherRecentlyOpenedAppsRegistry.swift', registry))
      .toContain('registry.removeValue(forKey: url)')
    const patchedModel = plugin.patchHistorySource('SwiftUI/DevLauncherViewModel.swift', model)
    Expect(patchedModel).toContain('TimeInterval(timestampInt64) / 1000')
    Expect(patchedModel).toContain('extractPort(from: url) == extractPort(from: selected.url)')
    Expect(patchedModel).toContain('registry.removeApp(url)')
    const patchedViews = plugin.patchHistorySource('SwiftUI/DevLauncherViews.swift', views)
    Expect(patchedViews).toContain('Last used ')
    Expect(patchedViews).toContain('Delete \\(app.name) from recents')
    Expect(patchedViews).toContain('viewModel.removeRecentlyOpenedApp(app)')
    Expect(await read('EXDevLauncherRecentlyOpenedAppsRegistry.swift')).toBe(registry)
    Expect(await read('SwiftUI/DevLauncherViewModel.swift')).toBe(model)
    Expect(await read('SwiftUI/DevLauncherViews.swift')).toBe(views)
  })

  Test('links only the three projected sources and rejects an incompatible SDK shape', () => {
    const podfile =
      'target "Companion" do\n  post_install do |installer|\n    react_native_post_install(installer)\n  end\nend'
    const patched = plugin.patchPodfile(podfile)
    Expect(plugin.patchPodfile(patched)).toBe(patched)
    Expect(patched).toContain("File.join(__dir__, 'tao-launcher-history', name)")
    Expect(patched).toContain("reference.source_tree = '<absolute>'")
    Expect(patched).toContain('expected.all?')
    Expect(() => plugin.patchPodfile('incompatible')).toThrow('Expected an Expo')
    Expect(() => plugin.patchHistorySource('SwiftUI/DevLauncherViewModel.swift', 'changed')).toThrow('source changed')
  })
})
