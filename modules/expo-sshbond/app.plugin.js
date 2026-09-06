const { withGradleProperties, withAppBuildGradle } = require('@expo/config-plugins');

const IGNORE_LIST_KEY = 'android.jetifier.ignorelist';
const IGNORED_ARTIFACTS = ['jsch', 'bcprov'];

/**
 * Keeps Jetifier away from the JSch and Bouncy Castle jars.
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
  config = withAppBuildGradle(config, gradleConfig => {
    const marker = '// SSHBond crypto library packaging';
    if (!gradleConfig.modResults.contents.includes(marker)) {
      gradleConfig.modResults.contents += `
${marker}
android {
  packagingOptions {
    resources {
      excludes += ['META-INF/versions/**/OSGI-INF/MANIFEST.MF']
    }
  }
}
`;
    }
    return gradleConfig;
  });
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
      properties.push({ type: 'property', key: IGNORE_LIST_KEY, value: IGNORED_ARTIFACTS.join(',') });
      return gradleConfig;
    }

    // Preserve any entries another plugin already added.
    const entries = existing.value
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean);

    for (const artifact of IGNORED_ARTIFACTS) {
      if (!entries.includes(artifact)) entries.push(artifact);
    }
    existing.value = entries.join(',');

    return gradleConfig;
  });
};
