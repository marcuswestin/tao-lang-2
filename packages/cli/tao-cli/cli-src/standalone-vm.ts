import { CLI, Errors, FS, HCI, Platform } from '@shared'

/**
 * Host-side operations for the disposable VM gates; binary output must stay on inherited stdout.
 * A contributor run (`tao-contributor-*`) shares boot, push, and exec with a standalone acceptance
 * run (`tao-acceptance-*`) but carries no browser bundle and records no filesystem audit. A base
 * build (`tao-basebuild-*`) adds only the pinned guest agent to the vanilla image, once. A Linux
 * contributor run names each guest after its phase (`-cold`, `-tools`, `-cached`).
 */
type Entity = { 'dev-entry'?: string; 'mount-point'?: string }
type Attachment = { 'image-path': string; 'system-entities': Entity[] }
type DiskOperation = 'bootstrap-agent' | 'snapshot' | 'collect'

/** The upstream images give the guest `admin` this uid; only a host account with it can read ownership. */
const GUEST_ADMIN_UID = 501
const AGENT_DIRECTORY = 'Library/Application Support/tart-guest-agent'
/** The vendor images' global LaunchAgent; launchd loads it only when root owns it. */
const AGENT_PLIST = 'Library/LaunchAgents/org.cirruslabs.tart-guest-agent.plist'

try {
  const [operation, name, argument, ...args] = Platform.runtimeProcess.argv.slice(2)
  if (
    name === undefined || !/^tao-(acceptance|contributor|basebuild)-[0-9]+-[0-9]+(-(cold|tools|cached))?$/.test(name)
  ) {
    Errors.throwUserInput('Expected an owned standalone acceptance, contributor, or base-build VM name.')
  }
  if (operation === 'exec' && argument !== undefined && args.length > 0) {
    Platform.runtimeProcess.exit(await guestCommand(name, argument, args, false))
  } else if (
    operation === 'push' && argument !== undefined && args.length === 1 && /^\/(Users|home)\/admin(\/|$)/.test(args[0]!)
    && !args[0]!.split('/').includes('..')
  ) {
    // The archive arrives on this process's stdin; the guest only ever extracts it under the admin home,
    // /Users/admin on macOS and /home/admin on Linux.
    Platform.runtimeProcess.exit(await guestCommand(name, argument, ['/usr/bin/tar', '-xf', '-', '-C', args[0]!], true))
  } else if (
    (operation === 'bootstrap-agent' && name.startsWith('tao-basebuild-'))
    || (operation === 'snapshot' && !name.startsWith('tao-basebuild-'))
    || operation === 'collect'
  ) {
    if (argument === undefined || args.length > 0) {
      Errors.throwUserInput(`Usage: standalone-vm.ts ${operation} <vm> <run-root>`)
    }
    await withDisk(name, FS.resolvePath(argument), operation)
  } else if (operation === 'idle' && argument !== undefined && args.length === 0) {
    await requireIdle()
  } else if (operation === 'boot' && argument !== undefined && args.length === 0) {
    await requireIdle()
    const result = await CLI.run('tart', {
      args: ['run', '--no-graphics', '--no-clipboard', name],
      stdio: ['ignore', 'inherit', 'inherit'],
      processPolicy: 'test',
      timeoutMs: 7_200_000,
    })
    if (result.error) {
      HCI.writeErrorLine(Errors.formatForUser(result.error))
    }
    Platform.runtimeProcess.exit(result.exitCode ?? 1)
  } else if (operation === 'recover-lease' && argument !== undefined && args.length === 0) {
    await recoverLease(name, FS.resolvePath(argument))
  } else if (operation === 'qualify' && argument !== undefined && args.length === 0) {
    await qualify(FS.resolvePath(argument))
  } else {
    Errors.throwUserInput(
      'Usage: standalone-vm.ts bootstrap-agent|snapshot|collect|idle|boot|recover-lease|qualify <vm> <run-root>'
        + ' | exec <vm> <timeout-ms> <command> [args...] | push <vm> <timeout-ms> <guest-directory> < archive.tar',
    )
  }
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.exit(1)
}

/** Run one guest command through the agent; `withInput` streams this process's stdin into it. */
async function guestCommand(name: string, timeout: string, args: string[], withInput: boolean): Promise<number> {
  const timeoutMs = Number(timeout)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    Errors.throwUserInput('Expected a positive VM command timeout in milliseconds.')
  }
  const result = await CLI.run('tart', {
    args: ['exec', ...(withInput ? ['-i'] : []), name, ...args],
    processPolicy: 'test',
    timeoutMs,
    stdio: [withInput ? 'inherit' : 'ignore', 'inherit', 'inherit'],
  })
  if (result.stderr) {
    HCI.writeErrorLine(result.stderr.trimEnd())
  }
  if (result.error) {
    HCI.writeErrorLine(Errors.formatForUser(result.error))
  }
  return result.exitCode ?? 1
}

async function requireIdle(): Promise<void> {
  const machines = JSON.parse(await command('tart', ['list', '--source', 'local', '--format', 'json'])) as Array<{
    Name: string
    Running: boolean
  }>
  if (
    !Array.isArray(machines)
    || machines.some(machine => typeof machine.Name !== 'string' || typeof machine.Running !== 'boolean')
  ) {
    Errors.throwHostEnvironment('Cannot establish whether another Tart VM is running.')
  }
  const running = machines.filter(machine => machine.Running)
  if (running.length > 0) {
    Errors.throwHostEnvironment(`Another Tart VM is running: ${running.map(machine => machine.Name).join(', ')}.`)
  }
}

async function recoverLease(name: string, root: string): Promise<void> {
  const lease = FS.resolvePath('.tao/standalone-vm-lease', FS.homeDir())
  const ownerPath = FS.resolvePath('owner.txt', lease)
  const owner = await FS.readText(ownerPath)
  const fields = Object.fromEntries(
    owner.trimEnd().split('\n').map(line => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator), line.slice(separator + 1)]
    }),
  )
  if (fields['run'] !== root || fields['vm'] !== name || !/^[0-9]+$/.test(fields['pid'] ?? '') || !fields['started']) {
    Errors.throwHostEnvironment('The lease is not owned by this run; refusing recovery.')
  }
  const tartHome = await FS.realPath(Platform.runtimeProcess.env['TART_HOME'] ?? FS.resolvePath('.tart', FS.homeDir()))
  if (fields['tart_home'] !== tartHome) {
    Errors.throwHostEnvironment(
      'The lease belongs to a different or unrecorded Tart storage directory; refusing recovery.',
    )
  }
  const ownerProcess = await CLI.run('ps', { args: ['-p', fields['pid']!, '-o', 'lstart='] })
  if (ownerProcess.exitCode === 0 && ownerProcess.stdout.trim() === fields['started'].trim()) {
    Errors.throwHostEnvironment('The VM workflow owner is still alive; refusing recovery.')
  }
  if (ownerProcess.error || (ownerProcess.exitCode !== 0 && ownerProcess.exitCode !== 1)) {
    Errors.throwHostEnvironment('Cannot establish whether the lease owner has exited.')
  }
  await requireIdle()
  if (await FS.exists(FS.resolvePath('disk-attached', root))) {
    Errors.throwHostEnvironment('This run may have an attached disk; collect and inspect it before lease recovery.')
  }
  const diskPath = FS.resolvePath(`vms/${name}/disk.img`, tartHome)
  const disk = await FS.exists(diskPath) ? await FS.realPath(diskPath) : diskPath
  const info = await plist<{ images: Attachment[] }>('/usr/bin/hdiutil', ['info', '-plist'])
  for (const attachment of info.images) {
    const imagePath = attachment['image-path']
    const canonical = await FS.exists(imagePath) ? await FS.realPath(imagePath) : FS.resolvePath(imagePath)
    if (canonical === disk) {
      Errors.throwHostEnvironment('The owned VM disk is still mounted; refusing lease recovery.')
    }
  }
  if (await FS.readText(ownerPath) !== owner) {
    Errors.throwHostEnvironment('The lease owner changed during inspection; refusing recovery.')
  }
  const active = FS.resolvePath('run-active', root)
  if (await FS.exists(active)) {
    await command('/bin/rmdir', [active])
  }
  await FS.remove(ownerPath)
  await command('/bin/rmdir', [lease])
  HCI.writeLine(`Recovered the inactive lease for ${name}; retained its logs and any stopped VM.`)
}

/**
 * `hdiutil attach` leaves the process that serves the mounted image running after it exits 0, and the
 * 'test' policy treats a surviving descendant as a leak and stops it, which detaches the disk mid-run.
 * That one call uses the 'tool' policy, which has no timeout; every other call keeps both bounds.
 */
async function command(executable: string, args: string[], servesAttachedImage = false): Promise<string> {
  const result = await CLI.run(
    executable,
    servesAttachedImage ? { args, processPolicy: 'tool' } : { args, processPolicy: 'test', timeoutMs: 120_000 },
  )
  if (result.exitCode !== 0) {
    Errors.throwHostEnvironment(`${executable} failed: ${result.stderr || result.stdout || result.error?.message}`)
  }
  return result.stdout
}

async function plist<T>(executable: string, args: string[], servesAttachedImage = false): Promise<T> {
  const output = await command(executable, args, servesAttachedImage)
  const converted = await CLI.run('/usr/bin/plutil', {
    args: ['-convert', 'json', '-o', '-', '-'],
    stdin: output,
  })
  if (converted.exitCode !== 0) {
    Errors.throwHostEnvironment(`Cannot decode ${executable} plist: ${converted.stderr}`)
  }
  return JSON.parse(converted.stdout) as T
}

/**
 * Attach a stopped VM's disk. Building a base writes with ownership ignored, so new files take the
 * unknown owner the guest resolves to whoever reads them. Snapshot and collection only read: they
 * honour ownership when this host account's uid is the guest admin's, and otherwise ignore it,
 * since a mismatched owner could not read admin's private directories; the audit then records
 * ownership as unobserved.
 */
async function withDisk(name: string, root: string, operation: DiskOperation): Promise<void> {
  const state = JSON.parse(await command('tart', ['get', name, '--format', 'json'])) as {
    Running: boolean
    State: string
  }
  if (state.Running !== false || state.State !== 'stopped') {
    Errors.throwHostEnvironment(`Refusing to mount ${name}: expected a stopped VM, got ${JSON.stringify(state)}.`)
  }
  const tartHome = Platform.runtimeProcess.env['TART_HOME'] ?? FS.resolvePath('.tart', FS.homeDir())
  const vm = FS.resolvePath(`vms/${name}`, tartHome)
  const config = await FS.readJson<{ diskFormat: string }>(FS.resolvePath('config.json', vm))
  if (config.diskFormat !== 'raw') {
    Errors.throwHostEnvironment('Attaching a stopped VM disk requires a raw disk.')
  }
  const disk = await FS.realPath(FS.resolvePath('disk.img', vm))
  const mountRoot = FS.resolvePath('mounts', root)
  const marker = FS.resolvePath('disk-attached', root)
  if (await FS.exists(marker)) {
    Errors.throwHostEnvironment(`A prior attachment may still own this disk; inspect ${marker} before recovery.`)
  }
  const hostUid = (await FS.entryMetadata(root)).uid
  const ownership = operation !== 'bootstrap-agent' && hostUid === GUEST_ADMIN_UID ? 'observed' : 'ignored'
  await FS.mkdir(mountRoot)
  // The shell must retain the clone if interruption or a failed detach leaves this marker behind.
  await FS.writeText(marker, disk)
  let primaryFailure: unknown
  try {
    const attached = await plist<{ 'system-entities': Entity[] }>('/usr/bin/hdiutil', [
      'attach',
      '-imagekey',
      'diskimage-class=CRawDiskImage',
      operation === 'bootstrap-agent' ? '-readwrite' : '-readonly',
      '-owners',
      ownership === 'observed' ? 'on' : 'off',
      '-nobrowse',
      '-plist',
      '-mountroot',
      mountRoot,
      disk,
    ], true)
    await FS.writeJson(FS.resolvePath(`logs/disk-attach-${operation}.json`, root), attached)
    const apfs = await plist<{ Containers: Array<{ Volumes: Array<{ DeviceIdentifier: string; Roles: string[] }> }> }>(
      '/usr/sbin/diskutil',
      ['apfs', 'list', '-plist'],
    )
    const dataDevices = apfs.Containers.flatMap(container => container.Volumes)
      .filter(volume => volume.Roles.includes('Data')).map(volume => `/dev/${volume.DeviceIdentifier}`)
    const candidates: string[] = []
    const boundary = await FS.realPath(mountRoot)
    for (const entity of attached['system-entities']) {
      const mount = entity['mount-point']
      if (!mount) {
        continue
      }
      const actual = await FS.realPath(mount)
      if (!FS.pathIsWithin(actual, boundary)) {
        Errors.throwHostEnvironment(`Unexpected VM mount outside ${boundary}.`)
      }
      if (
        dataDevices.includes(entity['dev-entry'] ?? '') && await FS.isDirectory(FS.resolvePath('Users/admin', actual))
      ) {
        candidates.push(actual)
      }
    }
    if (candidates.length !== 1) {
      Errors.throwHostEnvironment(
        `Cannot identify a unique guest Data volume with Users/admin (${
          candidates.join(', ')
        }); see logs/disk-attach-${operation}.json.`,
      )
    }
    const volume = candidates[0]!
    const home = FS.resolvePath('Users/admin', volume)
    if (ownership === 'observed') {
      const owner = await FS.entryMetadata(home)
      if (owner.uid !== hostUid) {
        Errors.throwHostEnvironment(`Guest admin uid ${owner.uid} differs from host uid ${hostUid}.`)
      }
    }
    if (operation === 'bootstrap-agent') {
      await bootstrapAgent(root, volume)
    } else if (operation === 'collect') {
      const harnessLogs = FS.resolvePath('tao-harness/logs', home)
      if (await FS.isDirectory(harnessLogs)) {
        await FS.copyDirectory(harnessLogs, FS.resolvePath('logs/guest', root))
      }
      for (const service of ['tart-guest-agent', 'tart-guest-daemon']) {
        const log = FS.resolvePath(`private/tmp/${service}.log`, volume)
        if (await FS.isFile(log)) {
          await FS.copyFile(log, FS.resolvePath(`logs/guest/${service}.log`, root))
        }
      }
      if (name.startsWith('tao-basebuild-')) {
        // A base build that never answered: record whether the agent and its LaunchAgent landed and
        // whether the guest logs admin in, since a LaunchAgent only runs inside a login session.
        const evidence: Record<string, unknown> = {}
        for (const path of [`${AGENT_DIRECTORY}/tart-guest-agent`, AGENT_PLIST]) {
          const absolute = FS.resolvePath(path, volume)
          evidence[path] = await FS.exists(absolute)
            ? ((await FS.entryMetadata(absolute)).mode & 0o7777).toString(8)
            : 'missing'
        }
        const loginwindow = FS.resolvePath('Library/Preferences/com.apple.loginwindow.plist', volume)
        evidence['autoLoginUser'] = await FS.exists(loginwindow)
          ? (await plist<{ autoLoginUser?: string }>('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', loginwindow]))
            .autoLoginUser ?? 'unset'
          : 'no loginwindow preferences'
        await FS.writeJson(FS.resolvePath('logs/guest/base-build.json', root), evidence)
        const launchd = FS.resolvePath('private/var/log/com.apple.xpc.launchd', volume)
        if (await FS.isDirectory(launchd)) {
          await FS.copyDirectory(launchd, FS.resolvePath('logs/guest/launchd', root))
        }
      }
    }
    if (operation !== 'bootstrap-agent' && name.startsWith('tao-acceptance-')) {
      const phase = operation === 'snapshot' ? 'before' : 'after'
      HCI.writeLine(
        `Clean-machine: recording the ${phase} snapshot on the stopped disk (ownership ${ownership})...`,
      )
      const snapshot = await command(Platform.runtimeProcess.execPath, [
        'run',
        'packages/cli/tao-cli/cli-src/standalone-filesystem-audit.ts',
        'snapshot',
        volume,
        FS.resolvePath(`logs/filesystem-${phase}.json`, root),
        '/System/Volumes/Data',
        ...(ownership === 'ignored' ? ['ownership-ignored'] : []),
      ])
      HCI.writeLine(snapshot.trimEnd())
    }
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    try {
      // Query even after attach fails: hdiutil can attach the device before reporting a mount error.
      const info = await plist<{ images: Attachment[] }>('/usr/bin/hdiutil', ['info', '-plist'])
      for (const attachment of info.images) {
        let imagePath: string
        try {
          imagePath = await FS.realPath(attachment['image-path'])
        } catch {
          // Unrelated mounted images can outlive their renamed or deleted backing files.
          if (FS.resolvePath(attachment['image-path']) !== disk) {
            continue
          }
          imagePath = disk
        }
        if (imagePath !== disk) {
          continue
        }
        const device = attachment['system-entities'].map(entity => entity['dev-entry'])
          .find(value => value !== undefined && /^\/dev\/disk[0-9]+$/.test(value))
        if (!device) {
          Errors.throwHostEnvironment(`Cannot identify the attached device for ${disk}; retain the VM.`)
        }
        await command('/usr/bin/hdiutil', ['detach', device])
      }
      await FS.remove(marker)
    } catch (cleanupFailure) {
      // The marker stays, so the shell retains the clone. A failed cleanup must not hide why the run failed.
      if (primaryFailure === undefined) {
        throw cleanupFailure
      }
      HCI.writeLine(`Detaching ${disk} also failed: ${Errors.formatForUser(cleanupFailure)}`)
    }
  }
}

/**
 * Write only the pinned agent and a global LaunchAgent, as the vendor images install theirs, so
 * `tart exec` answers once admin logs in. Every later input travels through `tart exec`.
 */
async function bootstrapAgent(root: string, volume: string): Promise<void> {
  if (await FS.exists(FS.resolvePath(AGENT_PLIST, volume))) {
    Errors.throwHostEnvironment('The source image already has a Tart guest agent; refusing a competing one.')
  }
  const directory = FS.resolvePath(AGENT_DIRECTORY, volume)
  await FS.mkdir(directory)
  const agent = FS.resolvePath('tart-guest-agent', directory)
  await FS.copyFile(FS.resolvePath('agent/tart-guest-agent', root), agent)
  await FS.chmod(agent, 0o755)
  await FS.writeText(
    FS.resolvePath(AGENT_PLIST, volume),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>org.cirruslabs.tart-guest-agent</string>
<key>ProgramArguments</key><array><string>/${AGENT_DIRECTORY}/tart-guest-agent</string><string>--run-rpc</string></array>
<key>WorkingDirectory</key><string>/Users/admin</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>/Users/admin</string><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>/private/tmp/tart-guest-agent.log</string>
<key>StandardErrorPath</key><string>/private/tmp/tart-guest-agent.log</string>
</dict></plist>
`,
  )
  await FS.chmod(FS.resolvePath(AGENT_PLIST, volume), 0o644)
}

/** Cache qualification records evidence; each later run still repeats preconditions and acceptance. */
async function qualify(root: string): Promise<void> {
  const logs = FS.resolvePath('logs', root)
  const profile = (await FS.readText(FS.resolvePath('profile.txt', logs))).trim()
  const source = (await FS.readText(FS.resolvePath('source-image.txt', logs))).trim()
  if (!['vanilla', 'xcode'].includes(profile) || !/@sha256:[a-f0-9]{64}$/.test(source)) {
    Errors.throwUnexpected('VM qualification requires a known profile and digest-pinned source.')
  }
  const summary = await FS.readJson<{ format?: string; scenarios?: Array<{ status?: string }> }>(
    FS.resolvePath('guest/steps/acceptance-summary.json', logs),
  )
  if (
    summary.format !== 'tao-standalone-acceptance-v1' || !Array.isArray(summary.scenarios)
    || summary.scenarios.length === 0 || summary.scenarios.some(scenario => scenario.status !== 'passed')
  ) {
    Errors.throwHostEnvironment('Collected acceptance summary is not complete and passing; the base is not qualified.')
  }
  const tools: Record<string, unknown> = {}
  if (profile === 'xcode') {
    const runtimes = await FS.readJson<{ runtimes: Array<{ identifier: string; isAvailable: boolean }> }>(
      FS.resolvePath('guest/steps/simulator-runtimes.json', logs),
    )
    if (!runtimes.runtimes.some(runtime => runtime.isAvailable && runtime.identifier.includes('.iOS-'))) {
      Errors.throwHostEnvironment('The Xcode base has no available iOS Simulator runtime; it is not qualified.')
    }
    tools['simulatorRuntimes'] = runtimes.runtimes
    for (const tool of ['xcode', 'brew', 'vendor-node']) {
      tools[tool] = (await FS.readText(FS.resolvePath(`guest/steps/${tool}-version.log`, logs))).trim()
    }
  }
  const manifest = FS.resolvePath(`../../bases/${profile}.json`, logs)
  await FS.writeJson(manifest, {
    format: 'tao-vm-base-qualification-v1',
    profile,
    source,
    qualifiedAt: new Date().toISOString(),
    evidence: logs,
    tartVersion: (await command('tart', ['--version'])).trim(),
    platform: (await FS.readText(FS.resolvePath('guest/steps/guest-platform.log', logs))).trim(),
    transport: await FS.readJson(FS.resolvePath('transport-owner.json', logs)),
    tools,
  })
  HCI.writeLine(`Clean-machine: qualified ${profile} base; provenance and tool inventory: ${manifest}`)
}
