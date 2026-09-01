/*
 * The components Tao's generated views render through. Each stub is its own host element name, so a
 * rendered tree reads as the React Native component that produced it and assertions can name it directly.
 */
const REACT_NATIVE_COMPONENTS = [
  'ActivityIndicator',
  'Image',
  'KeyboardAvoidingView',
  'Pressable',
  'ScrollView',
  'Switch',
  'Text',
  'TextInput',
  'View',
] as const

/**
 * reactNativeStubs returns the React Native module surface Tao runtime tests render against, for use as a
 * `MockModule('react-native', ...)` factory. Pass `overrides` for anything a test needs beyond the
 * components — `Platform` in particular, so a test that depends on the host OS declares which one it means.
 */
export function reactNativeStubs(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    ...Object.fromEntries(REACT_NATIVE_COMPONENTS.map(name => [name, name])),
    ...overrides,
  }
}
