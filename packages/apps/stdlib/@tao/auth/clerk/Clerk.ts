import AsyncStorage from '@react-native-async-storage/async-storage'
import TR from '@runtime/TR'
import { createClerkConnection } from './ClerkConnection'
import { createClerkDriver } from './ClerkDriver'
import { ClerkHost } from './ClerkHost'

/** Clerk handles authentication; the configured gateway owns the application Account. */
export function ClerkAuthProvider(): TR.AuthProvider {
  return {
    Host: ClerkHost,
    connect({ configuration }) {
      return createClerkConnection(configuration, {
        driver: createClerkDriver(configuration),
        // Only non-secret logout tombstones are persisted here, never JWTs or gateway credentials.
        logoutStorage: AsyncStorage,
      })
    },
  }
}
