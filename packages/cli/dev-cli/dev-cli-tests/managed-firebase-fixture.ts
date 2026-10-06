import { FS, Repo } from '@shared'
import { createManagedFirebaseSubjectGuard } from '../dev-cli-src/dev-loop/ManagedFirebaseAcceptance'

export const firebaseFixtureConnection = {
  apiKey: 'public-fixture-key',
  appId: 'fixture-app',
  projectId: 'fixture-project',
}
// Pinned independently of the implementation; mutations must fail the same guard used on the host.
export const assertFirebaseFixtureSubject = createManagedFirebaseSubjectGuard(
  '1a0f1ae10d7165d076bf339e74dfbb336409a681af45535ea4da7aea4b876d68',
)

export async function writeFirebaseFixture(checkout: string): Promise<string> {
  const projectRoot = FS.resolvePath('Apps/Firebase Live Acceptance', checkout)
  for (const path of ['App.tao', 'Auth.tao', 'Items/Items.tao', 'Data.tao']) {
    await FS.writeText(
      FS.resolvePath(path, projectRoot),
      await FS.readText(Repo.resolvePath(`Apps/Firebase Live Acceptance/${path}`)),
    )
  }
  await FS.writeJson(FS.resolvePath('.tao/local/connections.json', projectRoot), {
    firebase: firebaseFixtureConnection,
  })
  return projectRoot
}
