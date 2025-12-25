const fs = require('fs');
const path = require('path');
const { pathsToModuleNameMapper } = require('ts-jest');

// Load your base tsconfig to automatically map paths (e.g. @symphonyscript/kernel)
const tsconfig = require('./tsconfig.base.json');

module.exports = {
    // 1. Use SWC for blazing fast transforms (20x faster than ts-jest)
    transform: {
        '^.+\\.(t|j)sx?$': ['@swc/jest', {
            jsc: {
                target: 'es2022',
                parser: {
                    syntax: 'typescript',
                    decorators: true,
                    dynamicImport: true,
                },
                transform: {
                    legacyDecorator: true,
                    decoratorMetadata: true,
                },
            },
        }],
    },

    // 2. Automatically map your aliases (@symphonyscript/* -> packages/*/src)
    moduleNameMapper: pathsToModuleNameMapper(tsconfig.compilerOptions.paths, {
        prefix: path.resolve(__dirname) + '/'
    }),

    // 3. Standard clean-up
    moduleFileExtensions: ['ts', 'js', 'html', 'json'],
    testEnvironment: 'node',
    // Stop Jest from trying to test your dist folders
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
