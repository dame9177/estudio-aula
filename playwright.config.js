// End-to-end tests drive the real Electron app with Chromium's fake camera and microphone.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
});
