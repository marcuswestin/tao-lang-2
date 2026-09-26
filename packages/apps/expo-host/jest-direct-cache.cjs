// Jest loads this config with Node before Tao's TypeScript shared modules are available.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const HOUR_MS = 60 * 60 * 1000
const MAX_LEASE_AGE_MS = 24 * HOUR_MS
const MAX_FILES = 25_000
const MAX_BYTES = 256 * 1024 * 1024
const MAX_IDENTITIES = 16
const MAX_TOTAL_FILES = 100_000
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024
const IDENTITY = /^[0-9a-f]{16}$/
const LEASE = /^\d+-[0-9a-f-]+\.json$/

function cacheHome() {
  const declared = process.env.TAO_HOME
  if (declared) {
    if (!path.isAbsolute(declared)) {
      throw new TypeError('TAO_HOME must be an absolute path.')
    }
    return path.join(declared, 'cache')
  }
  return path.join(process.env.HOME || os.homedir(), '.tao', 'cache')
}

function root(runtimePackageRoot) {
  const identity = crypto.createHash('sha256').update(path.resolve(runtimePackageRoot)).digest('hex').slice(0, 16)
  return path.join(cacheHome(), 'jest-standalone-v2', identity)
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function activeLeases(identityRoot) {
  const leases = path.join(identityRoot, 'leases')
  if (!fs.existsSync(leases)) {
    return false
  }
  let active = false
  for (const name of fs.readdirSync(leases)) {
    if (!LEASE.test(name)) {
      continue
    }
    const file = path.join(leases, name)
    const age = Date.now() - fs.statSync(file).mtimeMs
    const pid = Number(name.split('-')[0])
    if (age < MAX_LEASE_AGE_MS && (alive(pid) || age < HOUR_MS)) {
      active = true
    } else {
      fs.rmSync(file, { force: true })
    }
  }
  return active
}

async function locked(parent, work, options = {}) {
  assertOwnedPath(parent)
  fs.mkdirSync(parent, { recursive: true })
  assertOwnedPath(parent)
  const lock = path.join(parent, '.coordination.lock')
  const token = crypto.randomUUID()
  const ownerPath = `${lock}.owner-${token}`
  fs.writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, token }))
  const deadline = Date.now() + 30_000
  let acquired = false
  try {
    while (!acquired) {
      try {
        // A hard link publishes a complete owner record atomically.
        fs.linkSync(ownerPath, lock)
        acquired = true
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error
        }
        if (Date.now() >= deadline) {
          throw new TypeError(`Timed out waiting for ${lock}.`)
        }
        reclaimStaleLock(lock, options.claimGraceMs ?? 2_000)
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    return await work()
  } finally {
    if (acquired && lockOwner(lock)?.token === token) {
      fs.rmSync(lock, { force: true })
    }
    fs.rmSync(ownerPath, { force: true })
  }
}

function lockOwner(file) {
  try {
    const stat = fs.statSync(file)
    return {
      ...JSON.parse(fs.readFileSync(file, 'utf8')),
      inode: stat.ino,
      device: stat.dev,
      age: Date.now() - stat.mtimeMs,
      claimAge: Date.now() - stat.ctimeMs,
    }
  } catch {
    return undefined
  }
}

function sameInode(left, right) {
  return left && right && left.inode === right.inode && left.device === right.device
}

function isSymlink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink()
  } catch {
    return false
  }
}

function assertOwnedPath(identityRoot) {
  const absolute = path.resolve(identityRoot)
  let current = path.parse(absolute).root
  for (const segment of absolute.slice(current.length).split(path.sep)) {
    if (!segment) {
      continue
    }
    current = path.join(current, segment)
    if (isSymlink(current)) {
      throw new TypeError(`Refusing symlinked Jest cache path at ${current}.`)
    }
  }
}

function reclaimStaleLock(lock, claimGraceMs) {
  const observed = lockOwner(lock)
  if (!observed || observed.age < HOUR_MS || alive(observed.pid)) {
    return
  }
  const claim = `${lock}.reclaim`
  try {
    fs.linkSync(lock, claim)
  } catch (error) {
    if (error.code !== 'EEXIST' && error.code !== 'ENOENT') {
      throw error
    }
    const stranded = lockOwner(claim)
    const current = lockOwner(lock)
    // A prior reclaimer may have moved its stale lock to a tombstone and died before removing
    // the claim link. That claim names a different inode from the replacement lock.
    if (stranded && stranded.claimAge >= claimGraceMs) {
      const confirmed = lockOwner(claim)
      const recheckedCurrent = lockOwner(lock)
      if (
        confirmed && confirmed.claimAge >= claimGraceMs && sameInode(stranded, confirmed)
        && (current === undefined || recheckedCurrent === undefined
          || sameInode(current, recheckedCurrent))
      ) {
        fs.rmSync(claim, { force: true })
      }
    }
    return
  }
  try {
    if (!sameInode(observed, lockOwner(claim)) || !sameInode(observed, lockOwner(lock))) {
      return
    }
    const tombstone = `${lock}.${crypto.randomUUID()}.stale`
    fs.renameSync(lock, tombstone)
    fs.rmSync(tombstone, { force: true })
  } finally {
    fs.rmSync(claim, { force: true })
  }
}

function scan(directory) {
  const files = []
  // Never prune through a symlink into a tree this lifecycle does not own.
  if (isSymlink(directory)) {
    throw new TypeError(`Refusing symlinked Jest cache data at ${directory}.`)
  }
  const pending = [directory]
  while (pending.length) {
    const current = pending.pop()
    if (!fs.existsSync(current)) {
      continue
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const item = path.join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(item)
      } else if (entry.isFile()) {
        const stat = fs.statSync(item)
        files.push({ path: item, bytes: stat.size, modifiedMs: stat.mtimeMs })
      }
    }
  }
  return files
}

function sizeOf(files) {
  return { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }
}

function pruneData(identityRoot) {
  const files = scan(path.join(identityRoot, 'data'))
  const size = sizeOf(files)
  files.sort((a, b) => a.modifiedMs - b.modifiedMs || a.path.localeCompare(b.path))
  while ((size.files > MAX_FILES || size.bytes > MAX_BYTES) && files.length) {
    const old = files.shift()
    fs.rmSync(old.path, { force: true })
    size.files -= 1
    size.bytes -= old.bytes
  }
  fs.writeFileSync(path.join(identityRoot, 'size.json'), JSON.stringify(size))
  return size
}

function pruneIdentities(parent, currentRoot, options = {}) {
  const identities = []
  for (const name of fs.readdirSync(parent)) {
    if (!IDENTITY.test(name)) {
      continue
    }
    const identityRoot = path.join(parent, name)
    if (isSymlink(identityRoot) || !fs.statSync(identityRoot).isDirectory()) {
      continue
    }
    const receipt = path.join(identityRoot, 'last-used')
    if (!fs.existsSync(receipt)) {
      continue
    }
    const data = path.join(identityRoot, 'data')
    if (isSymlink(data)) {
      continue
    }
    const active = activeLeases(identityRoot)
    let size
    try {
      size = JSON.parse(fs.readFileSync(path.join(identityRoot, 'size.json'), 'utf8'))
    } catch {}
    if (
      !size || !Number.isInteger(size.files) || size.files < 0
      || !Number.isInteger(size.bytes) || size.bytes < 0
    ) {
      size = sizeOf(scan(path.join(identityRoot, 'data')))
    }
    identities.push({ root: identityRoot, active, usedMs: Number(fs.readFileSync(receipt, 'utf8')) || 0, ...size })
  }
  let count = identities.length
  let files = identities.reduce((sum, item) => sum + item.files, 0)
  let bytes = identities.reduce((sum, item) => sum + item.bytes, 0)
  for (
    const item of identities.filter(item => !item.active && item.root !== currentRoot)
      .sort((a, b) => a.usedMs - b.usedMs || a.root.localeCompare(b.root))
  ) {
    if (
      count <= (options.maxIdentities ?? MAX_IDENTITIES)
      && files <= (options.maxTotalFiles ?? MAX_TOTAL_FILES)
      && bytes <= (options.maxTotalBytes ?? MAX_TOTAL_BYTES)
    ) {
      break
    }
    fs.rmSync(item.root, { recursive: true, force: true })
    count -= 1
    files -= item.files
    bytes -= item.bytes
  }
}

async function start(identityRoot, options = {}) {
  assertOwnedPath(identityRoot)
  const parent = path.dirname(identityRoot)
  return await locked(parent, () => {
    assertOwnedPath(identityRoot)
    fs.mkdirSync(path.join(identityRoot, 'data'), { recursive: true })
    fs.mkdirSync(path.join(identityRoot, 'leases'), { recursive: true })
    if (!activeLeases(identityRoot)) {
      pruneData(identityRoot)
    }
    fs.rmSync(path.join(identityRoot, 'size.json'), { force: true })
    const lease = path.join(identityRoot, 'leases', `${process.pid}-${crypto.randomUUID()}.json`)
    fs.writeFileSync(lease, JSON.stringify({ pid: process.pid }))
    fs.writeFileSync(path.join(identityRoot, 'last-used'), String(Date.now()))
    pruneIdentities(parent, identityRoot, options)
    return lease
  }, options)
}

async function finish(identityRoot, lease, options = {}) {
  assertOwnedPath(identityRoot)
  await locked(path.dirname(identityRoot), () => {
    assertOwnedPath(identityRoot)
    fs.rmSync(lease, { force: true })
    if (!activeLeases(identityRoot)) {
      pruneData(identityRoot)
    }
    pruneIdentities(path.dirname(identityRoot), identityRoot, options)
  }, options)
}

module.exports = { root, start, finish }
