const {getSentryExpoConfig} = require('@sentry/react-native/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname, {
  annotateReactComponents: true,
});
const defaultBlockList = Array.isArray(config.resolver.blockList)
  ? config.resolver.blockList
  : [config.resolver.blockList];

const finalConfig = {
  ...config,
  transformer: {
    ...config.transformer,
    // For https://github.com/kristerkari/react-native-svg-transformer
    babelTransformerPath: require.resolve('react-native-svg-transformer/expo'),
  },
  resolver: {
    ...config.resolver,
    blockList: [...defaultBlockList],
    // For https://github.com/kristerkari/react-native-svg-transformer
    assetExts: config.resolver.assetExts.filter(ext => ext !== 'svg'),
    sourceExts: [...config.resolver.sourceExts, 'svg'],
  },
};

const {withStorybook} = require('@storybook/react-native/metro/withStorybook');

module.exports = withStorybook(finalConfig, {
  enabled: process.env.EXPO_PUBLIC_STORYBOOK_ENABLED === 'true',
});
