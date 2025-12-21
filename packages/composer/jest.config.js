/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    rootDir: './src',
    testMatch: ['**/__tests__/**/*.test.ts'],
    moduleNameMapper: {
        '^@symphonyscript/composer$': '<rootDir>/index.ts',
        '^@symphonyscript/composer/(.*)$': '<rootDir>/$1'
    },
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.json' }]
    }
};
