// Mirrors the upstream example-percy-appium-js wdio config shape.
// Customer adapts the BS credentials, device, and `app` cap to their setup.

exports.config = {
  user: process.env.BROWSERSTACK_USERNAME || 'YOUR_BS_USERNAME',
  key: process.env.BROWSERSTACK_ACCESS_KEY || 'YOUR_BS_ACCESS_KEY',

  hostname: 'hub.browserstack.com',
  port: 443,
  protocol: 'https',
  path: '/wd/hub',

  updateJob: false,
  specs: ['./android/specs/storybook.spec.js'],
  exclude: [],

  capabilities: [
    {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:app': process.env.PERCY_APP_URL || 'bs://YOUR_APP_HASH',
      'appium:deviceName': 'Google Pixel 8',
      'appium:platformVersion': '13.0',
      'appium:autoGrantPermissions': true,
      'bstack:options': {
        userName: process.env.BROWSERSTACK_USERNAME,
        accessKey: process.env.BROWSERSTACK_ACCESS_KEY,
        projectName: 'Percy Storybook RN Example',
        buildName: 'App Percy WebdriverIO Storybook RN Android',
        sessionName: 'storybook_visual_test',
        debug: true,
      },
    },
  ],

  logLevel: 'info',
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    // Story iteration takes time — bump default mocha timeout for the suite.
    timeout: 600000,
  },
};
