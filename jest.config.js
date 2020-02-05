module.exports = {
    "roots": [
        "<rootDir>/src",
        "<rootDir>/tests"
    ],
    "transform": {
        "^.+\\.tsx?$": "ts-jest"
    },
    "testRegex": "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
    "moduleFileExtensions": [
        "ts",
        "tsx",
        "js",
        "jsx",
        "json",
        "node"
    ],
    "transformIgnorePatterns": [],
    "globals": {"ts-jest": {"isolatedModules": true},},
};