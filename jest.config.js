module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/packages/core/src'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }]
    },
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    moduleNameMapper: {
        '^@symphonyscript/core$': '<rootDir>/packages/core/src/index.ts',
        '^@symphonyscript/core/(.*)$': '<rootDir>/packages/core/src/$1'
    },
    verbose: true,
};
