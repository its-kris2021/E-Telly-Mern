// .cjs so Jest always loads this as CommonJS regardless of "type": "module"
// in package.json — avoids Jest's ESM-config loader entirely. Source files
// under test still run as native ESM via --experimental-vm-modules (see the
// "test" script in package.json); no transform is needed since Node handles
// ESM natively.
module.exports = {
  testEnvironment: "node",
  transform: {},
  testMatch: ["**/__tests__/**/*.test.js"],
  setupFiles: ["<rootDir>/__tests__/helpers/env.js"],
  testTimeout: 30000,
};
