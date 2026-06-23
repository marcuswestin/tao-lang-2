const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '../..')
let cachedBunPackageModulePaths

function bunPackageModulePaths() {
  if (cachedBunPackageModulePaths !== undefined) {
    return cachedBunPackageModulePaths
  }
  const bunRoot = path.join(repoRoot, 'node_modules/.bun')
  if (!fs.existsSync(bunRoot)) {
    cachedBunPackageModulePaths = []
    return cachedBunPackageModulePaths
  }
  cachedBunPackageModulePaths = fs.readdirSync(bunRoot)
    .sort()
    .map(entry => path.join(bunRoot, entry, 'node_modules'))
    .filter(modulePath => fs.existsSync(modulePath))
  return cachedBunPackageModulePaths
}

function bunModuleNameMapper(packageNames) {
  const mapper = {}
  for (const packageName of packageNames) {
    const packagePath = bunPackagePath(packageName)
    mapper[`^${escapeRegExp(packageName)}$`] = bunPackageEntry(packagePath)
    mapper[`^${escapeRegExp(packageName)}/(.*)$`] = `${packagePath}/$1`
  }
  return mapper
}

function bunPackagePath(packageName) {
  for (const modulePath of bunPackageModulePaths()) {
    const packagePath = path.join(modulePath, ...packageName.split('/'))
    if (fs.existsSync(packagePath)) {
      return packagePath
    }
  }
  throw new Error(`Bun package not found for Jest module mapper: ${packageName}`)
}

function bunPackageEntry(packagePath) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8'))
  const exportEntry = packageJson.exports?.['.'] ?? packageJson.exports
  const entry = typeof exportEntry === 'string'
    ? exportEntry
    : exportEntry?.require ?? exportEntry?.import ?? exportEntry?.default ?? packageJson.module ?? packageJson.main
      ?? 'index.js'
  return path.join(packagePath, entry)
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const langiumPath = bunPackagePath('langium')

module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/runtime-tests/*.jest-test.ts?(x)'],
  globalSetup: '<rootDir>/runtime-tests/setup-generated-app.cjs',
  moduleDirectories: ['node_modules'],
  modulePaths: bunPackageModulePaths(),
  moduleNameMapper: {
    ...bunModuleNameMapper([
      '@chevrotain/cst-dts-gen',
      '@chevrotain/gast',
      '@chevrotain/regexp-to-ast',
      '@chevrotain/types',
      '@chevrotain/utils',
      'chevrotain',
      'chevrotain-allstar',
      'lodash-es',
      'typir',
      'typir-langium',
      'vscode-jsonrpc',
      'vscode-languageserver',
      'vscode-languageserver-protocol',
      'vscode-languageserver-textdocument',
      'vscode-languageserver-types',
      'vscode-uri',
    ]),
    '^@ast-utils$': 'tao-ast-utils',
    '^@compiler$': 'tao-compiler',
    '^@parser$': 'tao-parser',
    '^@runtime$': '<rootDir>/runtime-src/runtime.ts',
    '^@runtime/TR$': '<rootDir>/TaoRuntime-src/TR.ts',
    '^@runtime/(.*)$': '<rootDir>/runtime-src/$1',
    '^@shared$': '<rootDir>/../shared/shared-src/shared.ts',
    '^@shared/test$': '<rootDir>/../shared/shared-src/Test-Jest.ts',
    '^@shared/(.*)$': '<rootDir>/../shared/shared-src/$1',
    '^@validator$': 'tao-validator',
    '^@validator/(.*)$': 'tao-validator/$1',
    '^@workspace$': '<rootDir>/../workspace/workspace-src/Workspace.ts',
    '^langium$': `${langiumPath}/lib/index.js`,
    '^langium/(generate|grammar|lsp|node|test)$': `${langiumPath}/lib/$1/index.js`,
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@jest/globals$': '<rootDir>/node_modules/@jest/globals',
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
    '^react$': '<rootDir>/node_modules/react',
    '^react/jsx-dev-runtime$': '<rootDir>/node_modules/react/jsx-dev-runtime',
    '^react/jsx-runtime$': '<rootDir>/node_modules/react/jsx-runtime',
    '^react-native$': '<rootDir>/node_modules/react-native',
  },
  transformIgnorePatterns: [],
}
