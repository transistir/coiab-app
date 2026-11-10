const {createHook} = require('node:async_hooks');
const {clearInterval} = require('node:timers');

const timers = new Map();
const sentryMapSource =
  /[/\\]@sentry[/\\]react-native[/\\].*[/\\]utils[/\\]AsyncExpiringMap\.[jt]s/;

const hook = createHook({
  init(id, type, triggerId, resource) {
    if (type !== 'Timeout' || !resource._repeat) return;

    const stackTraceLimit = Error.stackTraceLimit;
    let stack;
    try {
      Error.stackTraceLimit = 30;
      stack = new Error().stack;
    } finally {
      Error.stackTraceLimit = stackTraceLimit;
    }
    // Sentry 8.15 starts a private AsyncExpiringMap's 5s interval on import,
    // even without Sentry.init(). It exposes no public cleanup for that map.
    if (sentryMapSource.test(stack)) timers.set(id, resource);
  },
  // No `destroy`: it would make Node track every promise for GC callbacks.
});

function cleanupSentryTimers() {
  hook.disable();
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();
}

// The environment and globalTeardown use Node's host module cache, outside
// Jest's isolated test-module registries. Never clear unrelated test timers.
module.exports = cleanupSentryTimers;
module.exports.track = () => hook.enable();
