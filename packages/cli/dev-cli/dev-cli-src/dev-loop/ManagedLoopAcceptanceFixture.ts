import { Errors, FS, ProjectIdentity, ProjectLocal, Repo } from '@shared'

export type ManagedLoopFixture = { root: string; appPath: string; sourceIdentity: string }

/** An inspection failure quarantines only that projection; independent rollback continues. */
export async function cleanupManagedLoopAcceptanceFixtures(
  fixtures: ManagedLoopAcceptanceFixtures,
  canRemove: (fixture: ManagedLoopFixture) => boolean,
  failure: (fixture: ManagedLoopFixture, error: unknown) => void,
): Promise<void> {
  for (const fixture of fixtures.projects) {
    try {
      if (!await fixtures.cleanup(fixture, canRemove(fixture))) {
        failure(
          fixture,
          new Errors.HostEnvironmentError('Owned resource shutdown was not proved; source projection retained.'),
        )
      }
    } catch (error) {
      failure(fixture, error)
      try {
        await fixtures.cleanup(fixture, false)
      } catch (retentionError) {
        failure(fixture, retentionError)
      }
    }
  }
}

type DirectoryRecord = {
  path: string
  owner: string
  purpose: string
  cleanupCondition: string
  state: 'active' | 'removed' | 'retained'
  reason?: string
}

/** Tao discovery ignores .artifacts; only discoverable source projects leave the checkout. */
export class ManagedLoopAcceptanceFixtures {
  readonly projects: ManagedLoopFixture[] = []
  private readonly records: DirectoryRecord[] = []

  constructor(private readonly artifactRoot: string) {}

  async create(shape: 'single' | 'ambiguous' | 'invalid' = 'single'): Promise<ManagedLoopFixture> {
    const root = await FS.realPath(await FS.mkTmpDir('tao-managed-loop-project-'))
    this.records.push({
      path: root,
      owner: this.artifactRoot,
      purpose: `Disposable Data MVP Memory source projection (${shape}).`,
      cleanupCondition: 'Remove only after invocation-owned processes, project owner and device cleanup are proved.',
      state: 'active',
    })
    // Register before reading source so an allocation failure still reaches owned rollback.
    const appPath = FS.resolvePath('Data MVP.tao', root)
    const fixture = { root, appPath, sourceIdentity: '' }
    this.projects.push(fixture)
    await this.save()
    await FS.mkdir(FS.resolvePath('.tao', root))
    await ProjectIdentity.ensure(root)
    let source = await FS.readText(Repo.resolvePath('Apps/Test Apps/Data MVP/Data MVP.tao'))
    if (shape === 'ambiguous') {
      source +=
        '\napp OtherMemoryApp {\n   name "Other Memory"\n   id "dev.tao.acceptance.other"\n   version "1.0.0"\n   Navigator StackNav { Initial MainView }\n   Datasource Memory { }\n}\n'
    }
    if (shape === 'invalid') {
      // Discovery still finds a well-formed app; compilation must reject the disposable scene.
      source = source.replace('state WorkspaceDraft = ""', 'state WorkspaceDraft = MissingAcceptanceDeclaration')
    }
    await FS.writeText(appPath, source)
    fixture.sourceIdentity = await FS.filesIdentity([['Data MVP.tao', appPath]])
    return fixture
  }

  async cleanup(fixture: ManagedLoopFixture, resourcesStopped: boolean): Promise<boolean> {
    const record = this.records.find(entry => entry.path === fixture.root)
    if (record === undefined) {
      Errors.throwUnexpected('Expected an invocation-owned source projection before cleanup.')
    }
    // A dead owner can leave escaped children. Require both the caller's kernel proof and disposal
    // of the project owner; never delete an active project based on its age or PID alone.
    const ownerPath = ProjectLocal.localResolve('sessions/owner.json', fixture.root)
    if (!resourcesStopped || await FS.exists(ownerPath)) {
      record.state = 'retained'
      record.reason = resourcesStopped ? 'The project owner record remains.' : 'Owned resource shutdown was not proved.'
      await this.save()
      return false
    }
    await FS.remove(fixture.root)
    record.state = 'removed'
    await this.save()
    return true
  }

  private async save(): Promise<void> {
    await FS.writeJson(FS.resolvePath('external-directories.json', this.artifactRoot), this.records, { mode: 0o600 })
  }
}
