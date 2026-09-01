const { withGradleProperties } = require('@expo/config-plugins');

const IGNORE_LIST_KEY = 'android.jetifier.ignorelist';
const IGNORED_ARTIFACT = 'jsch';

/**
 * Keeps Jetifier away from the JSch jar.
 *
 * The Expo template still sets `android.enableJetifier=true` for the sake of
 * pre-AndroidX libraries. JSch ships as a multi-release jar whose
 * `META-INF/versions/*` entries are compiled for a much newer JDK, and Jetifier
 * cannot parse those class files -- it fails the build outright with
 * "Unsupported class file major version". JSch is AndroidX-agnostic, so there
 * is nothing for Jetifier to rewrite in it anyway.
 *
 * This lives in a config plugin rather than in android/gradle.properties
 * because `expo prebuild` regenerates that file from the template on every run.
 */
module.exports = function withSSHBond(config) {
  return withGradleProperties(config, gradleConfig => {
    const properties = gradleConfig.modResults;
    const existing = properties.find(
      item => item.type === 'property' && item.key === IGNORE_LIST_KEY
    );

    if (!existing) {
      properties.push({
        type: 'comment',
        value: 'Jetifier cannot read JSch\'s multi-release class files, and has nothing to rewrite in it.',
      });
      properties.push({ type: 'property', key: IGNORE_LIST_KEY, value: IGNORED_ARTIFACT });
      return gradleConfig;
    }

    // Preserve any entries another plugin already added.
    const entries = existing.value
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean);

    if (!entries.includes(IGNORED_ARTIFACT)) {
      entries.push(IGNORED_ARTIFACT);
      existing.value = entries.join(',');
    }

    return gradleConfig;
  });
};
