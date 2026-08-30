import { jest } from '@jest/globals'

let mockClipboardText = 'Device Kit clipboard'

jest.mock('expo-clipboard', () => ({
  getStringAsync: jest.fn(async () => mockClipboardText),
  setStringAsync: jest.fn(async (text: string) => {
    mockClipboardText = text
    return true
  }),
}), { virtual: true })

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Heavy: 'heavy', Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Error: 'error', Success: 'success', Warning: 'warning' },
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async (type: string) => {
    mockClipboardText = `Haptic ${type}`
  }),
  selectionAsync: jest.fn(async () => undefined),
}), { virtual: true })

const reactNative = jest.requireActual<Record<string, unknown>>('react-native')
Object.defineProperty(reactNative, 'Share', {
  configurable: true,
  value: {
    dismissedAction: 'dismissedAction',
    sharedAction: 'sharedAction',
    share: jest.fn(async () => ({ action: 'sharedAction' })),
  },
})
