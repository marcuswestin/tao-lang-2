import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { MachineResourceFenceError, MachineResources } from '../host-control-src/host-control'

async function fixture() {
  const root = await mkTestDir('tao-resource-admission-')
  const avd = await MachineResources.acquire({
    command: 'owned AVD',
    name: 'android-avd:owned',
    registryRoot: root,
    repositoryRoot: root,
  })
  const serial = await MachineResources.acquire({
    command: 'owned serial',
    name: 'android-emulator:emulator-5580',
    registryRoot: root,
    repositoryRoot: root,
  })
  return { root, owners: [avd.owner, serial.owner] }
}

Test('machine-resource admission refuses either stale fence without invoking its synchronous action', async () => {
  for (const index of [0, 1]) {
    const f = await fixture()
    try {
      const expected = structuredClone(f.owners)
      expected[index]!.id = 'stale-generation'
      let spawned = false
      await Expect(MachineResources.withCurrentOwners({ owners: expected, registryRoot: f.root }, () => {
        spawned = true
      })).rejects.toBeInstanceOf(MachineResourceFenceError)
      Expect(spawned).toBe(false)
      Expect(await MachineResources.listOwners({ registryRoot: f.root })).toEqual(f.owners)
    } finally {
      await FS.remove(f.root)
    }
  }
})

Test('machine-resource admission rejects empty and duplicate snapshots before its action', async () => {
  const f = await fixture()
  try {
    for (const owners of [[], [f.owners[0]!, f.owners[0]!]]) {
      let called = false
      await Expect(MachineResources.withCurrentOwners({ owners, registryRoot: f.root }, () => {
        called = true
      })).rejects.toThrow('nonempty, duplicate-free')
      Expect(called).toBe(false)
    }
  } finally {
    await FS.remove(f.root)
  }
})

Test('machine-resource admission callback failure preserves both owners and releases the mutex', async () => {
  const f = await fixture()
  try {
    await Expect(MachineResources.withCurrentOwners({ owners: f.owners, registryRoot: f.root }, () => {
      Errors.throwHostEnvironment('Synchronous action failed')
    })).rejects.toThrow('Synchronous action failed')
    Expect(await MachineResources.listOwners({ registryRoot: f.root })).toEqual(f.owners)
    Expect(await FS.exists(FS.resolvePath('.mutex', f.root))).toBe(false)
    Expect(await MachineResources.withCurrentOwners({ owners: f.owners, registryRoot: f.root }, () => 'admitted'))
      .toBe('admitted')
  } finally {
    await FS.remove(f.root)
  }
})

Test('machine-resource admission rejects asynchronous actions and registry reentry', async () => {
  const f = await fixture()
  try {
    await Expect(MachineResources.withCurrentOwners(
      { owners: f.owners, registryRoot: f.root }, // @ts-expect-error Admission actions cannot return promises, even when explicitly async.
      async () => 'forbidden',
    )).rejects.toThrow('must be synchronous')
    let nested: Promise<unknown> | undefined
    await MachineResources.withCurrentOwners({ owners: f.owners, registryRoot: f.root }, () => {
      nested = MachineResources.retain({
        owners: f.owners,
        processes: [],
        quarantined: true,
        reason: 'forbidden reentry',
        registryRoot: f.root,
      })
      // Observe rejection immediately so it cannot become an unhandled promise.
      void nested.catch(() => {})
    })
    await Expect(nested).rejects.toThrow('cannot reenter')
    Expect(await MachineResources.listOwners({ registryRoot: f.root })).toEqual(f.owners)
  } finally {
    await FS.remove(f.root)
  }
})

async function isolated(root: string, body: string) {
  return await CLI.run(Platform.runtimeProcess.execPath, {
    args: [
      `--tsconfig=${Repo.resolvePath('packages/testing/host-control/tsconfig.json')}`,
      '-e',
      `
const shared = {...await import(${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/shared.ts'))})};
const {MockModule, until, testOverrideSlot} = await import(${
        JSON.stringify(Repo.resolvePath('packages/shared/shared-src/testing/Test-Bun.ts'))
      });
const FS = {...shared.FS};
MockModule('@shared', () => ({...shared, FS}));
const {MachineResources} = await import(${
        JSON.stringify(Repo.resolvePath('packages/testing/host-control/host-control-src/MachineResources.ts'))
      });
const root = ${JSON.stringify(root)};
const first = await MachineResources.acquire({name:'android-avd:owned',command:'owned AVD',registryRoot:root});
const second = await MachineResources.acquire({name:'android-emulator:emulator-5580',command:'owned serial',registryRoot:root});
const owners = [first.owner, second.owner];
${body}
`,
    ],
    processPolicy: 'test',
    timeoutMs: 30_000,
  })
}

Test(
  'machine-resource admission serializes a real competing rotation requested during the second owner read until after spawn',
  async () => {
    const root = await mkTestDir('tao-resource-admission-read-race-')
    try {
      const result = await isolated(
        root,
        `
const serialPath = FS.resolvePath('resource-android-emulator_emulator-5580.lease',root);
const readJson = FS.readJson;
const events = [];
let competing;
let requested = false;
const slot = testOverrideSlot({read:()=>FS.readJson,write:value=>{FS.readJson=value}});
const restore = slot.install(async path => {
  const value = await readJson(path);
  if (path === serialPath && !requested) {
    requested = true;
    competing = MachineResources.retain({owners:[owners[0]],processes:[],quarantined:true,reason:'competing AVD rotation during serial read',registryRoot:root}).then(owner=>{events.push('rotation');return owner});
    if (await FS.exists(FS.resolvePath('.mutex',root))) {
      await until(async()=> (await FS.listDir(FS.resolvePath('.mutex-contenders',root))).length >= 2);
    } else {
      await competing;
    }
  }
  return value;
});
try {
  await MachineResources.withCurrentOwners({owners,registryRoot:root},()=>{events.push('spawn');return 'captured-child'});
  const successor = await competing;
  const current = await MachineResources.listOwners({registryRoot:root});
  shared.Platform.runtimeConsole.info(JSON.stringify({requested,events,rotatedAvd:current.find(owner=>owner.name===owners[0].name).id===successor.id,preservedSerial:current.find(owner=>owner.name===owners[1].name).id===owners[1].id}));
} finally {restore();}
`,
      )
      Expect(result.stderr).toBe('')
      Expect(result.exitCode).toBe(0)
      Expect(JSON.parse(result.stdout)).toEqual({
        requested: true,
        events: ['spawn', 'rotation'],
        rotatedAvd: true,
        preservedSerial: true,
      })
    } finally {
      await FS.remove(root)
    }
  },
)

Test(
  'machine-resource admission preserves a synchronously captured child when registry finalization throws',
  async () => {
    const root = await mkTestDir('tao-resource-admission-finalizer-')
    try {
      const result = await isolated(
        root,
        `
const realPath = FS.realPath;
let child;
const slot = testOverrideSlot({read:()=>FS.realPath,write:value=>{FS.realPath=value}});
const restore = slot.install(path=>{
  if (child !== undefined && path === FS.resolvePath('.mutex',root)) shared.Errors.throwHostEnvironment('injected finalizer failure');
  return realPath(path);
});
let failure;
try {
  await MachineResources.withCurrentOwners({owners,registryRoot:root},()=>{child={id:'captured-owned-child'};return child});
} catch(error) {failure=error.message;} finally {restore();}
const current = await MachineResources.listOwners({registryRoot:root});
shared.Platform.runtimeConsole.info(JSON.stringify({child,failure,ownersUnchanged:current.every(owner=>owners.some(expected=>expected.name===owner.name&&expected.id===owner.id))}));
`,
      )
      Expect(result.exitCode).toBe(0)
      Expect(result.stderr).toBe('')
      Expect(JSON.parse(result.stdout)).toEqual({
        child: { id: 'captured-owned-child' },
        failure: 'injected finalizer failure',
        ownersUnchanged: true,
      })
    } finally {
      await FS.remove(root)
    }
  },
)
