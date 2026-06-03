module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/runtime-tests/*.jest-test.ts?(x)'],
  moduleNameMapper: {
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
    '^react$': '<rootDir>/node_modules/react',
    '^react/jsx-dev-runtime$': '<rootDir>/node_modules/react/jsx-dev-runtime',
    '^react/jsx-runtime$': '<rootDir>/node_modules/react/jsx-runtime',
    '^react-native$': '<rootDir>/node_modules/react-native',
  },
  transformIgnorePatterns: [],
}
