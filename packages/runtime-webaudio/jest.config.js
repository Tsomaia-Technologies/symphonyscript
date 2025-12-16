/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@symphonyscript/core/(.*)$': '<rootDir>/../core/src/$1',
    '^@symphonyscript/core$': '<rootDir>/../core/src/index.ts'
  }
};
