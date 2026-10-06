const fs = require('node:fs')
const path = require('node:path')
const { withDangerousMod } = require('expo/config-plugins')

const marker = '# Tao: project-local Companion launcher history sources'
const files = [
  'EXDevLauncherRecentlyOpenedAppsRegistry.swift',
  'SwiftUI/DevLauncherViewModel.swift',
  'SwiftUI/DevLauncherViews.swift',
]

function replaceOnce(source, before, after) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error('Expo launcher history source changed; review the SDK integration before rebuilding Companion.')
  }
  return source.replace(before, after)
}

function patchHistorySource(file, source) {
  if (file === files[0]) {
    return replaceOnce(
      source,
      '  @objc\n  public func clearRegistry()',
      `  @objc
  public func removeApp(_ url: String) {
    var registry = appRegistry
    registry.removeValue(forKey: url)
    appRegistry = registry
  }

  @objc
  public func clearRegistry()`,
    )
  }
  if (file === files[1]) {
    source = replaceOnce(source, 'TimeInterval(timestampInt64))', 'TimeInterval(timestampInt64) / 1000)')
    return replaceOnce(
      source,
      '  func clearRecentlyOpenedApps() {',
      `  func removeRecentlyOpenedApp(_ selected: RecentlyOpenedApp) {
    let registry = EXDevLauncherController.sharedInstance().recentlyOpenedAppsRegistry
    // A visible row groups entries with the same name and port. Remove the entire group,
    // so an older duplicate cannot reappear after a refresh.
    for entry in registry.recentlyOpenedApps() {
      guard let url = entry["url"] as? String,
            let name = entry["name"] as? String,
            name == selected.name,
            extractPort(from: url) == extractPort(from: selected.url) else { continue }
      registry.removeApp(url)
    }
    loadRecentlyOpenedApps()
  }

  func clearRecentlyOpenedApps() {`,
    )
  }
  if (file !== files[2]) {
    throw new Error(`Unexpected launcher source: ${file}`)
  }
  const start = source.indexOf('struct RecentlyOpenedAppRow: View {')
  if (start < 0) {
    throw new Error('Expo launcher recent row changed; review the SDK integration.')
  }
  const next = source.indexOf('\nstruct ', start + 1)
  const end = next < 0 ? source.length : next
  const row = `struct RecentlyOpenedAppRow: View {
  let app: RecentlyOpenedApp
  let onTap: () -> Void
  @EnvironmentObject var viewModel: DevLauncherViewModel

  private var isServerActive: Bool {
    guard let port = URL(string: app.url)?.port else { return false }
    return viewModel.devServers.contains { URL(string: $0.url)?.port == port }
  }

  var body: some View {
    HStack(spacing: 12) {
      Button(action: onTap) {
        HStack {
          Circle()
            .fill(isServerActive ? Color.green : Color.gray)
            .frame(width: 12, height: 12)
          VStack(alignment: .leading, spacing: 4) {
            Text(app.name).font(.headline).foregroundColor(.primary)
            Text(app.url).font(.caption).foregroundColor(.secondary).lineLimit(1)
            Text("Last used \\(app.timestamp.formatted(.relative(presentation: .named)))")
              .font(.caption).foregroundColor(.secondary)
          }
          Spacer()
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(PlainButtonStyle())
      Button(role: .destructive) {
        viewModel.removeRecentlyOpenedApp(app)
      } label: {
        Image(systemName: "trash").padding(10)
      }
      .accessibilityLabel("Delete \\(app.name) from recents")
      .buttonStyle(PlainButtonStyle())
    }
    .padding()
    .background(Color.expoSecondarySystemBackground)
    .clipShape(RoundedRectangle(cornerRadius: 12))
  }
}
`
  return source.slice(0, start) + row + source.slice(end)
}

function patchPodfile(source) {
  if (source.includes(marker)) {
    return source
  }
  const end = source.lastIndexOf('\n  end\nend')
  if (end < 0 || !source.includes('react_native_post_install(')) {
    throw new Error('Expected an Expo React Native post_install block for Companion history.')
  }
  const patch = `

    ${marker}
    launcher = installer.pods_project.targets.find { |target| target.name == 'expo-dev-launcher' }
    raise 'Companion history requires the expo-dev-launcher pod' unless launcher
    replaced = []
    launcher.source_build_phase.files.each do |build_file|
      reference = build_file.file_ref
      next unless reference
      name = File.basename(reference.path)
      candidate = File.join(__dir__, 'tao-launcher-history', name)
      next unless File.file?(candidate)
      reference.path = candidate
      reference.source_tree = '<absolute>'
      replaced << name
    end
    expected = %w[EXDevLauncherRecentlyOpenedAppsRegistry.swift DevLauncherViewModel.swift DevLauncherViews.swift]
    raise 'Companion history sources were not linked into the launcher pod' unless expected.all? { |name| replaced.include?(name) }`
  return source.slice(0, end) + patch + source.slice(end)
}

/** Project local source projection: never mutate the shared installed Expo package. */
function withLauncherHistory(config) {
  return withDangerousMod(config, ['ios', async mod => {
    const project = mod.modRequest.platformProjectRoot
    const clientRoot = path.dirname(require.resolve('expo-dev-client/package.json', {
      paths: [mod.modRequest.projectRoot],
    }))
    const launcherRoot = path.dirname(require.resolve('expo-dev-launcher/package.json', { paths: [clientRoot] }))
    const output = path.join(project, 'tao-launcher-history')
    fs.mkdirSync(output, { recursive: true })
    for (const file of files) {
      const source = fs.readFileSync(path.join(launcherRoot, 'ios', file), 'utf8')
      fs.writeFileSync(path.join(output, path.basename(file)), patchHistorySource(file, source))
    }
    const podfile = path.join(project, 'Podfile')
    fs.writeFileSync(podfile, patchPodfile(fs.readFileSync(podfile, 'utf8')))
    return mod
  }])
}

module.exports = withLauncherHistory
module.exports.patchHistorySource = patchHistorySource
module.exports.patchPodfile = patchPodfile
