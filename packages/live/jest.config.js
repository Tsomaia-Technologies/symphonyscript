/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: './src',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@symphonyscript/live$': '<rootDir>/index.ts',
    '^@symphonyscript/live/(.*)$': '<rootDir>/$1',
    '^@symphonyscript/core$': '<rootDir>/../../core/src/index.ts',
    '^@symphonyscript/core/(.*)$': '<rootDir>/../../core/src/$1'
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.json' }]
  }
};
