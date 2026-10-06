import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { TaoAppModules } from '../cli-src/app-modules'

Describe('native runtime CLI packaging', () => {
  Test('carries native autolinking configuration and platform sources into a relocated runtime', async () => {
    const root = await mkTestDir('tao-runtime-native-package-')
    try {
      const source = FS.resolvePath('runtime', root)
      const cli = FS.resolvePath('cli', root)
      const files = {
        'TaoRuntime-src/TR.ts': 'export default {}\n',
        'swiftui/TaoValues.swift': 'struct TaoValues {}\n',
        'expo-module.config.json': '{"platforms":["apple","android"]}\n',
        'ios/TaoContinuousClockModule.swift': 'struct Clock {}\n',
        'ios/TaoRuntimeNative.podspec': 'Pod::Spec.new {}\n',
        'android/build.gradle': 'plugins {}\n',
        'android/src/main/java/tao/runtime/TaoContinuousClockModule.kt': 'class Clock\n',
        'package.json': '{"name":"tao-runtime"}\n',
      }
      for (const [file, contents] of Object.entries(files)) {
        await FS.writeText(FS.resolvePath(file, source), contents)
      }
      const packaged = await TaoAppModules.packageRuntime(cli, source)
      Expect(TaoAppModules.runtimeRoot(cli)).toBe(packaged)
      for (const [file, contents] of Object.entries(files)) {
        Expect(await FS.readText(FS.resolvePath(file, packaged))).toBe(contents)
      }

      await FS.remove(FS.resolvePath('ios', source))
      await FS.remove(FS.resolvePath('android', source))
      await FS.remove(FS.resolvePath('expo-module.config.json', source))
      await TaoAppModules.packageRuntime(cli, source)
      Expect(await FS.exists(FS.resolvePath('ios', packaged))).toBe(false)
      Expect(await FS.exists(FS.resolvePath('android', packaged))).toBe(false)
      Expect(await FS.exists(FS.resolvePath('expo-module.config.json', packaged))).toBe(false)
      Expect(await FS.readText(FS.resolvePath('TaoRuntime-src/TR.ts', packaged))).toBe(files['TaoRuntime-src/TR.ts'])
    } finally {
      await FS.remove(root)
    }
  })
})
