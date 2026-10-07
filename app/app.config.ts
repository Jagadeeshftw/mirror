import type { ExpoConfig } from "expo/config";

// Single replaceable product-name token.
const BRAND = "Mirror";
const rpId = process.env.MERA_RP_ID ?? "mirror.0xo.in";
const applicationId = "com.zeroxo.mirror";
const apiBase = process.env.EXPO_PUBLIC_API_BASE ?? "";
const devTools = process.env.EXPO_PUBLIC_MIRROR_DEV_TOOLS === "1";
// Stage-A emulator builds (scripts/build-apk.sh --stage-a): release app, cleartext only to the emulator's
// host loopback (10.0.2.2) / localhost, where the localnet engine runs. Never set for normal release builds.
const localCleartext = devTools || process.env.MIRROR_LOCAL_CLEARTEXT === "1";

const config: ExpoConfig = {
  name: BRAND,
  slug: "mirror",
  scheme: "mirror",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  backgroundColor: "#F6F6F3",
  android: {
    package: applicationId,
    versionCode: 100,
    adaptiveIcon: {
      backgroundColor: "#4B3BFF",
      foregroundImage: "./assets/adaptive-foreground.png",
      monochromeImage: "./assets/adaptive-monochrome.png",
    },
    permissions: ["android.permission.POST_NOTIFICATIONS", "android.permission.USE_BIOMETRIC"],
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
  },
  plugins: [
    "expo-router",
    [
      "expo-font",
      {
        fonts: [
          "./node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf",
          "./node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf",
          "./node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf",
          "./node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf",
          "./node_modules/@expo-google-fonts/geist-mono/400Regular/GeistMono_400Regular.ttf",
          "./node_modules/@expo-google-fonts/geist-mono/500Medium/GeistMono_500Medium.ttf",
          "./node_modules/@expo-google-fonts/geist-mono/600SemiBold/GeistMono_600SemiBold.ttf",
        ],
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-mark.png",
        imageWidth: 96,
        backgroundColor: "#F6F6F3",
        dark: { image: "./assets/splash-mark.png", backgroundColor: "#0A0B0E" },
      },
    ],
    "expo-secure-store",
    [
      "expo-notifications",
      { icon: "./assets/notification-icon.png", color: "#4B3BFF", defaultChannel: "copies" },
    ],
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 28,
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          // Credential Manager loads the Play Services provider reflectively.
          extraProguardRules: [
            "-if class androidx.credentials.CredentialManager",
            "-keep class androidx.credentials.playservices.** { *; }",
            "-keep class com.reactnativepasskey.** { *; }",
          ].join("\n"),
        },
      },
    ],
    "./plugins/withReleaseSigning.js",
    "./plugins/withNoAnimations.js",
    // Cleartext to the local mock / localnet engine only exists in dev-tools and stage-a builds.
    ...(localCleartext ? ["./plugins/withLocalCleartext.js"] : []),
  ],
  web: {
    bundler: "metro",
    output: "single",
    name: BRAND,
    shortName: BRAND,
    lang: "en",
    themeColor: "#4B3BFF",
    backgroundColor: "#F6F6F3",
    favicon: "./assets/favicon.png",
  },
  // Web is served under /app on mirror.0xo.in (web/scripts/build-app.sh sets EXPO_BASE_URL=/app);
  // empty for native and for local web dev at /.
  experiments: { typedRoutes: false, baseUrl: process.env.EXPO_BASE_URL ?? "" },
  extra: {
    rpId,
    brand: BRAND,
    apiBase,
  },
};

export default config;
