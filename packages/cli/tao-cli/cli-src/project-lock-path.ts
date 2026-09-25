/**
 * PROJECT_LOCK_RELATIVE_PATH is the one Tao-written lock a project carries. Several concerns share it
 * — `ship`, `installs`, and the `toolchain` pin — and each writer preserves the others. It lives in
 * a module of its own so the version shim can read the pin without loading what writes the rest.
 */
export const PROJECT_LOCK_RELATIVE_PATH = '.tao-project/lock.jsonc'
