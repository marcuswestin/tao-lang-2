import { ExpoApiSource, NativeBindings, ReactNativeApiSource } from '@native-bindings'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runCheck } from '../cli-src/source-commands'
import { checkedProjectFile, runTaoCliForTest, withTaoFixture } from './test-cli-files'

const fromDirectory = Repo.resolvePath('packages/apps/expo-host')

Describe('native binding CLI contracts', () => {
  Test('checks the generated Haptics Tao and TypeScript contracts', async () => {
    const generated = await NativeBindings.generate({
      source: ExpoApiSource,
      packageName: 'expo-haptics',
      fromDirectory,
    })
    await withTaoFixture({
      ...checkedProjectFile,
      ...generated.files,
      'Main.tao': `use SelectionAsync, ImpactAsync, NotificationAsync, PerformAndroidHapticsAsync,
   ImpactFeedbackStyle, NotificationFeedbackType, AndroidHaptics from ./Bindings.tao

action Exercise() {
   do SelectionAsync()
   do ImpactAsync()
   do ImpactAsync(Style: Soft)
   do NotificationAsync()
   do NotificationAsync(Type: Warning)
   do PerformAndroidHapticsAsync(Type: Gesture_Start)
}
`,
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      Expect(await FS.isFile(FS.resolvePath('.tao-ts/Bindings.tao.ts', root))).toBe(true)
    })
  })

  Test('checks the generated React Native Vibration Tao and TypeScript contracts', async () => {
    const generated = await NativeBindings.generate({
      source: ReactNativeApiSource,
      packageName: 'react-native',
      exportName: 'Vibration',
      fromDirectory,
    })
    await withTaoFixture({
      ...checkedProjectFile,
      ...generated.files,
      'Main.tao': `use Vibrate, Cancel from ./Bindings.tao
action Exercise() {
   do Vibrate()
   do Vibrate(Pattern: 200, Repeat: false)
   do Cancel()
}
`,
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
    })
  })

  Test('reruns the CLI with identical output and leaves unchanged files untouched', async () => {
    await withTaoFixture(checkedProjectFile, async root => {
      const out = FS.resolvePath('Generated', root)
      const args = ['bridge', 'expo-haptics', '--source', 'expo', '--from', fromDirectory, '--out', out]
      const generated = await runTaoCliForTest(args)
      Expect(generated.exitCode).toBe(0)
      Expect(generated.stdout).toContain('Generated native bindings')
      const path = FS.resolvePath('Bindings.tao', out)
      const original = await FS.readText(path)
      const originalMetadata = await FS.entryMetadata(path)
      Expect(original).toContain('PerformAndroidHapticsAsync')
      const repeated = await runTaoCliForTest(args)
      Expect(repeated.exitCode).toBe(0)
      Expect(repeated.stdout).toContain('Generated native bindings')
      Expect(await FS.readText(path)).toBe(original)
      Expect((await FS.entryMetadata(path)).modifiedMs).toBe(originalMetadata.modifiedMs)
    })
  })
})
