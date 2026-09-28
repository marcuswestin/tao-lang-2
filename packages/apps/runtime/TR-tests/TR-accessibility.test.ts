import { Describe, Expect, Test } from '@shared/test'
import { accessibilityVerbProps, focusAccessibilityHost } from '../TaoRuntime-src/TR-accessibility'
import type { ReactNativeRuntime } from '../TaoRuntime-src/TR-react-native'

function runtime(
  os: string,
  sendAccessibilityEvent?: (host: object, eventType: 'focus') => void,
): ReactNativeRuntime {
  const component = '' as unknown as ReactNativeRuntime['View']
  return {
    ...(sendAccessibilityEvent === undefined ? {} : { AccessibilityInfo: { sendAccessibilityEvent } }),
    ActivityIndicator: component,
    Image: component,
    KeyboardAvoidingView: component,
    Platform: { OS: os },
    Pressable: component,
    ScrollView: component,
    Switch: component,
    Text: component,
    TextInput: component,
    View: component,
  }
}

Describe('TR accessibility projection', () => {
  Test('generated verb actions preserve existing host actions and dispatch through one semantic identity', () => {
    const invoked: string[] = []
    const forwarded: string[] = []
    const props = accessibilityVerbProps(
      {
        accessibilityActions: [{ label: 'Adjust', name: 'adjust' }],
        onAccessibilityAction: (event: { nativeEvent?: { actionName?: string } }) =>
          forwarded.push(event.nativeEvent?.actionName ?? ''),
      },
      [{ identity: 'Pin', label: 'Pin workspace' }],
      identity => invoked.push(identity),
    )

    Expect(props['accessibilityActions']).toEqual([
      { label: 'Adjust', name: 'adjust' },
      { label: 'Pin workspace', name: 'tao:Pin' },
    ])
    const dispatch = props['onAccessibilityAction'] as (event: { nativeEvent: { actionName: string } }) => void
    dispatch({ nativeEvent: { actionName: 'tao:Pin' } })
    dispatch({ nativeEvent: { actionName: 'adjust' } })
    Expect(invoked).toEqual(['Pin'])
    Expect(forwarded).toEqual(['adjust'])
  })

  Test('moves DOM focus when Tao attention targets a web host', () => {
    let focuses = 0
    let accessibilityEvents = 0
    const host = { focus: () => focuses += 1 }

    focusAccessibilityHost(runtime('web', () => accessibilityEvents += 1), host)

    Expect(focuses).toBe(1)
    Expect(accessibilityEvents).toBe(0)
  })

  Test('requests native accessibility focus without moving keyboard focus', () => {
    let focusedHost: object | undefined
    let eventType: string | undefined
    let fallbackFocuses = 0
    const host = { focus: () => fallbackFocuses += 1 }

    focusAccessibilityHost(
      runtime('ios', (nextHost, nextEventType) => {
        focusedHost = nextHost
        eventType = nextEventType
      }),
      host,
    )

    Expect(focusedHost).toBe(host)
    Expect(eventType).toBe('focus')
    Expect(fallbackFocuses).toBe(0)
  })

  Test('falls back to host focus when a native adapter cannot send an accessibility event', () => {
    let focuses = 0

    focusAccessibilityHost(runtime('test'), { focus: () => focuses += 1 })

    Expect(focuses).toBe(1)
  })
})
