import { CLI, Errors, FS, HCI, Platform } from '@shared'

/** Host-side operations for the disposable VM gate; binary output must stay on inherited stdout. */
type Entity = { 'dev-entry'?: string; 'mount-point'?: string }
type Attachment = { 'image-path': string; 'system-entities': Entity[] }

try {
  const [operation, name, argument, ...args] = Platform.runtimeProcess.argv.slice(2)
  if (name === undefined || !/^tao-acceptance-[0-9]+-[0-9]+$/.test(name)) {
    Errors.throwUserInput('Expected an owned standalone acceptance VM name.')
  }
  if (operation === 'exec' && argument !== undefined && args.length > 0) {
    const timeoutMs = Number(argument)
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      Errors.throwUserInput('Expected a positive VM command timeout in milliseconds.')
    }
    const result = await CLI.run('tart', {
      args: ['exec', name, ...args],
      processPolicy: 'test',
      timeoutMs,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    if (result.stderr) {
      HCI.writeErrorLine(result.stderr.trimEnd())
    }
    if (result.error) {
      HCI.writeErrorLine(Errors.formatForUser(result.error))
    }
    Platform.runtimeProcess.exit(result.exitCode ?? 1)
  } else if ((operation === 'provision' || operation === 'collect') && argument !== undefined && args.length === 0) {
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
      'Usage: standalone-vm.ts provision|collect|idle|boot|recover-lease|qualify <vm> <run-root>'
        + ' | exec <vm> <timeout-ms> <command> [args...]',
    )
  }
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.exit(1)
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

async function command(executable: string, args: string[]): Promise<string> {
  const result = await CLI.run(executable, { args, processPolicy: 'test', timeoutMs: 120_000 })
  if (result.exitCode !== 0) {
    Errors.throwHostEnvironment(`${executable} failed: ${result.stderr || result.stdout || result.error?.message}`)
  }
  return result.stdout
}

async function plist<T>(executable: string, args: string[]): Promise<T> {
  const output = await command(executable, args)
  const converted = await CLI.run('/usr/bin/plutil', {
    args: ['-convert', 'json', '-o', '-', '-'],
    stdin: output,
  })
  if (converted.exitCode !== 0) {
    Errors.throwHostEnvironment(`Cannot decode ${executable} plist: ${converted.stderr}`)
  }
  return JSON.parse(converted.stdout) as T
}

async function withDisk(name: string, root: string, operation: 'provision' | 'collect'): Promise<void> {
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
    Errors.throwHostEnvironment('Offline vanilla VM provisioning requires a raw disk.')
  }
  const disk = await FS.realPath(FS.resolvePath('disk.img', vm))
  const mountRoot = FS.resolvePath('mounts', root)
  const marker = FS.resolvePath('disk-attached', root)
  if (await FS.exists(marker)) {
    Errors.throwHostEnvironment(`A prior attachment may still own this disk; inspect ${marker} before recovery.`)
  }
  await FS.mkdir(mountRoot)
  // The shell must retain the clone if interruption or a failed detach leaves this marker behind.
  await FS.writeText(marker, disk)
  try {
    const attached = await plist<{ 'system-entities': Entity[] }>('/usr/bin/hdiutil', [
      'attach',
      '-imagekey',
      'diskimage-class=CRawDiskImage',
      '-readwrite',
      '-owners',
      'on',
      '-nobrowse',
      '-plist',
      '-mountroot',
      mountRoot,
      disk,
    ])
    await FS.writeJson(FS.resolvePath('logs/disk-attach.json', root), attached)
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
        `Cannot identify a unique guest Data volume with Users/admin (${candidates.join(', ')}); see disk-attach.json.`,
      )
    }
    const home = FS.resolvePath('Users/admin', candidates[0]!)
    const owner = await FS.entryMetadata(home)
    const hostOwner = await FS.entryMetadata(root)
    if (owner.uid !== hostOwner.uid || owner.gid !== hostOwner.gid) {
      Errors.throwHostEnvironment(
        `Guest admin ownership ${owner.uid}:${owner.gid} differs from host ${hostOwner.uid}:${hostOwner.gid}.`,
      )
    }
    const harness = FS.resolvePath('tao-harness', home)
    if (operation === 'provision') {
      await provision(root, home, harness)
    } else {
      await FS.copyDirectory(FS.resolvePath('logs', harness), FS.resolvePath('logs/guest', root))
      for (const service of ['tart-guest-agent', 'tart-guest-daemon']) {
        const log = FS.resolvePath(`private/tmp/${service}.log`, candidates[0]!)
        if (await FS.isFile(log)) {
          await FS.copyFile(log, FS.resolvePath(`logs/guest/${service}.log`, root))
        }
      }
    }
    HCI.writeLine(
      `Clean-machine: recording the ${operation === 'provision' ? 'before' : 'after'} snapshot on the stopped disk...`,
    )
    const snapshot = await command(Platform.runtimeProcess.execPath, [
      'run',
      'packages/cli/tao-cli/cli-src/standalone-filesystem-audit.ts',
      'snapshot',
      candidates[0]!,
      FS.resolvePath(`logs/filesystem-${operation === 'provision' ? 'before' : 'after'}.json`, root),
      '/System/Volumes/Data',
    ])
    HCI.writeLine(snapshot.trimEnd())
  } finally {
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
  }
}

async function provision(root: string, home: string, harness: string): Promise<void> {
  await FS.copyDirectory(FS.resolvePath('input', root), FS.resolvePath('input', harness))
  await FS.mkdir(FS.resolvePath('logs/steps', harness))
  const agent = FS.resolvePath('input/tart-guest-agent', harness)
  await FS.chmod(agent, 0o755)
  const browser = FS.resolvePath('Applications/Google Chrome.app', home)
  await FS.mkdir(browser)
  await command('/usr/bin/tar', ['-xf', FS.resolvePath('input/browser.tar', root), '-C', browser])
  const vendorAgent = FS.resolvePath('../../Library/LaunchAgents/org.cirruslabs.tart-guest-agent.plist', home)
  if (await FS.exists(vendorAgent)) {
    const existing = await plist<{ ProgramArguments: string[] }>('/usr/bin/plutil', [
      '-convert',
      'xml1',
      '-o',
      '-',
      vendorAgent,
    ])
    if (
      existing.ProgramArguments[0] !== '/opt/homebrew/bin/tart-guest-agent'
      || !existing.ProgramArguments.includes('--run-agent')
    ) {
      Errors.throwHostEnvironment('The image has an unrecognized Tart guest service; refusing a competing RPC agent.')
    }
    await FS.writeJson(FS.resolvePath('logs/transport-owner.json', root), { kind: 'vendor', ...existing })
    return
  }
  await FS.writeJson(FS.resolvePath('logs/transport-owner.json', root), { kind: 'fixture', version: '0.10.0' })
  await FS.writeText(
    FS.resolvePath('Library/LaunchAgents/org.cirruslabs.tart-guest-agent.plist', home),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>org.cirruslabs.tart-guest-agent</string>
<key>ProgramArguments</key><array><string>/Users/admin/tao-harness/input/tart-guest-agent</string><string>--run-rpc</string></array>
<key>WorkingDirectory</key><string>/Users/admin</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>/Users/admin</string><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>/Users/admin/tao-harness/logs/guest-agent.log</string>
<key>StandardErrorPath</key><string>/Users/admin/tao-harness/logs/guest-agent.log</string>
</dict></plist>
`,
  )
}

/** Cache qualification records evidence; each later run still repeats preconditions and acceptance. */
async function qualify(root: string): Promise<void> {
  const logs = FS.resolvePath('logs', root)
  const profile = (await FS.readText(FS.resolvePath('profile.txt', logs))).trim()
  const source = (await FS.readText(FS.resolvePath('source-image.txt', logs))).trim()
  if (!['vanilla', 'xcode'].includes(profile) || !/@sha256:[a-f0-9]{64}$/.test(source)) {
    Errors.throwUnexpected('VM qualification requires a known profile and digest-pinned source.')
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
