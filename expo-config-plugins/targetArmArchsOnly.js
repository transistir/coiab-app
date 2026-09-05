const {
  withAppBuildGradle,
  withGradleProperties,
} = require('expo/config-plugins');
const {
  mergeContents,
} = require('@expo/config-plugins/build/utils/generateCode');

/**
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
module.exports = function targetArmArchsOnly(config) {
  // Storybook builds run on an x86_64 CI emulator (no real ARM device
  // involved), so restricting the APK to ARM-only ABIs here would make it
  // uninstallable there (INSTALL_FAILED_NO_MATCHING_ABIS). Skip this plugin
  // for those builds and keep Expo's default multi-ABI output instead.
  // INCLUDE_X86_64=1 opts any other build into the same multi-ABI output
  // (candidate APKs meant for local x86_64 emulator testing).
  if (
    process.env.EXPO_PUBLIC_STORYBOOK_ENABLED === 'true' ||
    process.env.INCLUDE_X86_64 === '1'
  ) {
    return config;
  }

  // Update reactNativeArchitectures property in android/gradle.properties
  const conf = withGradleProperties(config, configWithGradleProperties => {
    const reactNativeArchitecturesProperty =
      configWithGradleProperties.modResults.find(
        p => p.type === 'property' && p.key === 'reactNativeArchitectures',
      );

    if (!reactNativeArchitecturesProperty) {
      throw new Error(
        "Could not find existing 'reactNativeArchitectures' property in android/gradle.properties",
      );
    }

    reactNativeArchitecturesProperty.value = 'armeabi-v7a,arm64-v8a';

    return configWithGradleProperties;
  });

  // Update android.defaultConfig in android/app/build.gradle
  return withAppBuildGradle(conf, configWithAppBuildGradle => {
    const abiFilters = `\t\tndk {\n\t\t\tabiFilters "armeabi-v7a", "arm64-v8a"\n\t\t}`;

    configWithAppBuildGradle.modResults.contents = mergeContents({
      tag: 'comapeo:add-ndk-abi-filters',
      src: configWithAppBuildGradle.modResults.contents,
      newSrc: abiFilters,
      anchor: /defaultConfig {/gm,
      offset: 1,
      comment: '//',
    }).contents;

    return configWithAppBuildGradle;
  });
};

/**
 */
