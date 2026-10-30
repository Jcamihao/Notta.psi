// Karma enxuto: jasmine + Chrome headless sem sandbox (necessario no WSL/CI).
module.exports = (config) => {
  config.set({
    frameworks: ['jasmine'],
    plugins: [require('karma-jasmine'), require('karma-chrome-launcher')],
    reporters: ['dots'],
    customLaunchers: {
      ChromeHeadlessNoSandbox: { base: 'ChromeHeadless', flags: ['--no-sandbox'] },
    },
  });
};
