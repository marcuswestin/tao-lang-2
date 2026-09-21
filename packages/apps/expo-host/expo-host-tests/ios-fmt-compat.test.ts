import { Describe, Expect, Test } from '@shared/test'

const { patchPodfile } = require('../plugins/with-ios-fmt-compat.cjs') as {
  patchPodfile: (source: string) => string
}

Describe('iOS fmt compatibility plugin', () => {
  Test('adds the Xcode 26 workaround to the React Native post-install block once', () => {
    const podfile = `post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
    )
  end
end
`
    const patched = patchPodfile(podfile)

    Expect(patched).toContain('fmt_patched = fmt_source.gsub')
    Expect(patchPodfile(patched)).toBe(patched)
  })

  Test('rejects an unknown generated Podfile shape', () => {
    Expect(() => patchPodfile('target "App" do\nend\n')).toThrow('React Native post_install block')
  })
})
