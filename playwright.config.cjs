const {defineConfig} = require('@playwright/test');
const executablePath = process.env.ALLNOTE_CHROMIUM;
const engine = process.env.ALLNOTE_TEST_ENGINE;

module.exports = defineConfig({
  testDir: './scripts/browser',
  timeout: 60000,
  workers: 2,
  reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : 'list',
  use: {
    browserName: engine === 'webkit' ? 'webkit' : 'chromium',
    channel: engine === 'msedge' ? 'msedge' : undefined,
    baseURL: 'http://127.0.0.1:4173',
    viewport: {width: 1440, height: 1000},
    launchOptions: {executablePath},
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory dist',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI
  }
});
