import { Linking } from 'react-native'

/**
 * Opens a story with React Native's platform-neutral URL service. Behavior journeys exercise the
 * command without handing control to another application; native integration tests own that edge.
 */
export async function OpenUrl(url: string): Promise<void> {
  if (url.length === 0) {
    return
  }
  if (process.env.NODE_ENV !== 'test') {
    await Linking.openURL(url)
  }
}
