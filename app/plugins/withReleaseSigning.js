// Adds a release signing config that reads the keystore from environment variables
// (see scripts/build-apk.sh, which sources ../keys/mirror-release.env when present).
// Falls back to the debug keystore when no release keystore is configured, so local
// builds always work.
const { withAppBuildGradle } = require("expo/config-plugins");

const RELEASE_BLOCK = `
        release {
            def ksPath = System.getenv("MIRROR_KEYSTORE_PATH") ?: System.getenv("KEYSTORE_PATH") ?: System.getenv("KEYSTORE_FILE") ?: new File(rootDir, "../../keys/mirror-release.keystore").absolutePath
            def ksPass = System.getenv("MIRROR_KEYSTORE_PASSWORD") ?: System.getenv("KEYSTORE_PASSWORD") ?: System.getenv("STORE_PASSWORD")
            def ksAlias = System.getenv("MIRROR_KEY_ALIAS") ?: System.getenv("KEY_ALIAS") ?: "mirror"
            def ksKeyPass = System.getenv("MIRROR_KEY_PASSWORD") ?: System.getenv("KEY_PASSWORD") ?: ksPass
            if (ksPass != null && new File(ksPath).exists()) {
                storeFile new File(ksPath)
                storePassword ksPass
                keyAlias ksAlias
                keyPassword ksKeyPass
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes("MIRROR_KEYSTORE_PATH")) {
      src = src.replace(/signingConfigs\s*\{/, (m) => `${m}${RELEASE_BLOCK}`);
      // In the release build type, use the release config only when it is complete.
      src = src.replace(
        /(release\s*\{[^{}]*?)signingConfig\s+signingConfigs\.debug/,
        `$1signingConfig signingConfigs.release.storeFile != null ? signingConfigs.release : signingConfigs.debug`,
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });
};
