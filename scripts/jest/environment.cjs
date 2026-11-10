const ReactNativeEnvironment = require('@react-native/jest-preset/jest/react-native-env');
const cleanupSentryTimers = require('./globalTeardown.cjs');

module.exports = class extends ReactNativeEnvironment {
  async setup() {
    cleanupSentryTimers.track();
    await super.setup();
  }

  async teardown() {
    try {
      // Workers have their own process: globalTeardown cannot reach their timers.
      cleanupSentryTimers();
    } finally {
      await super.teardown();
    }
  }
};
