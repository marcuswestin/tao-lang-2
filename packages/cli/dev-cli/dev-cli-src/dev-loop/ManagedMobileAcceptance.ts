import { devLoopRequest } from '@shared/DevLoopControl'
import type { ManagedMobileFixtureEvidence } from '../../../../testing/e2e-testing/native/ManagedMobileFixture'
import { readDevLoopConnection } from './DevLoopStore'

/** Authenticates the fixed finite fixture; input authority remains inside the live reservation holder. */
export async function executeManagedMobileAcceptance(
  session: string,
  target: 'ios' | 'android',
  artifactRoot: string,
  fixture: 'mobile-interaction' | 'firebase-sync' = 'mobile-interaction',
): Promise<ManagedMobileFixtureEvidence> {
  return await devLoopRequest(
    await readDevLoopConnection(session),
    fixture === 'firebase-sync' ? '/firebase-sync' : '/mobile-acceptance',
    { target, artifactRoot },
  )
}
