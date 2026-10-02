const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8099',
    channel: 'chrome',
    locale: 'fr-FR',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npx http-server -p 8099 -c-1 .',
    url: 'http://127.0.0.1:8099/index.html',
    reuseExistingServer: true,
    timeout: 30000
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 800 } }
    },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      }
    }
  ]
});
