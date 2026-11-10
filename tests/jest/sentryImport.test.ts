import {expect, test} from '@jest/globals';
import {captureException} from '@sentry/react-native';

// Run in a fresh Jest process: the regression is a green suite followed by
// "Jest did not exit", caused by importing Sentry without even initializing it.
test('imports the real Sentry SDK', () => {
  expect(captureException).toEqual(expect.any(Function));
});
