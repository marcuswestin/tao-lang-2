const nodeFs = require('node:fs')
const nodePath = require('node:path')
const { withDangerousMod } = require('expo/config-plugins')

const marker = '# Tao: Xcode 26 compatibility for React Native fmt 11.0.2'

/** patchPodfile inserts an idempotent post-install patch for the Apple Clang consteval regression. */
function patchPodfile(source) {
  if (source.includes(marker)) {
    return source
  }
  const postInstallEnd = source.lastIndexOf('\n  end\nend')
  if (postInstallEnd < 0 || !source.includes('react_native_post_install(')) {
    throw new Error('Expected Expo prebuild to generate a React Native post_install block.')
  }
  const patch = `

    ${marker}
    fmt_base = File.join(installer.sandbox.pod_dir('fmt'), 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      fmt_source = File.read(fmt_base)
      fmt_patched = fmt_source.gsub(/^#  define FMT_USE_CONSTEVAL 1$/, '#  define FMT_USE_CONSTEVAL 0')
      if fmt_patched != fmt_source
        File.chmod(0644, fmt_base)
        File.write(fmt_base, fmt_patched)
      end
    end`
  return `${source.slice(0, postInstallEnd)}${patch}${source.slice(postInstallEnd)}`
}

/** withIosFmtCompat keeps React Native 0.81 buildable under the current Apple Clang toolchain. */
function withIosFmtCompat(config) {
  return withDangerousMod(config, [
    'ios',
    async modConfig => {
      const podfilePath = nodePath.join(modConfig.modRequest.platformProjectRoot, 'Podfile')
      const source = nodeFs.readFileSync(podfilePath, 'utf8')
      nodeFs.writeFileSync(podfilePath, patchPodfile(source))
      return modConfig
    },
  ])
}

module.exports = withIosFmtCompat
module.exports.patchPodfile = patchPodfile
