/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    rootDir: './src',
    testMatch: ['**/__tests__/**/*.test.ts'],
    moduleNameMapper: {
        '^@symphonyscript/builder$': '<rootDir>/index.ts',
        '^@symphonyscript/builder/(.*)$': '<rootDir>/$1'
    },
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.json' }]
    }
};
