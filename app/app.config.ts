import type { ExpoConfig } from "expo/config";

// Evaluated by Node (expo config); the app tsconfig has no Node types.
declare const require: (m: string) => any;
declare const __dirname: string;
const { existsSync } = require("fs") as { existsSync(p: string): boolean };
const { join } = require("path") as { join(...p: string[]): string };

// Single replaceable product-name token.
const BRAND = "Mirror";
const rpId = process.env.MERA_RP_ID ?? "mirror.0xo.in";
const applicationId = "com.zeroxo.mirror";
const apiBase = process.env.EXPO_PUBLIC_API_BASE ?? "";
const devTools = process.env.EXPO_PUBLIC_MIRROR_DEV_TOOLS === "1";
// Stage-A emulator builds (scripts/build-apk.sh --stage-a): release app, cleartext only to the emulator's
// host loopback (10.0.2.2) / localhost, where the localnet engine runs. Never set for normal release builds.
const localCleartext = devTools || process.env.MIRROR_LOCAL_CLEARTEXT === "1";
// Android remote push (FCM through Expo): the owner's Firebase config. Gitignored; picked up when present.
const googleServicesFile = existsSync(join(__dirname, "google-services.json")) ? "./google-services.json" : undefined;
// Expo project id (EAS) for getExpoPushTokenAsync; optional until Android push is set up.
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined;

const config: ExpoConfig = {
  name: BRAND,
  slug: "mirror",
  scheme: "mirror",
  version: "1.0.1",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  backgroundColor: "#F6F6F3",
  android: {
    package: applicationId,
    versionCode: 101,
    ...(googleServicesFile ? { googleServicesFile } : {}),
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
          "./assets/fonts/Inter_400Regular.ttf",
          "./assets/fonts/Inter_500Medium.ttf",
          "./assets/fonts/Inter_600SemiBold.ttf",
          "./assets/fonts/Inter_700Bold.ttf",
          "./assets/fonts/GeistMono_400Regular.ttf",
          "./assets/fonts/GeistMono_500Medium.ttf",
          "./assets/fonts/GeistMono_600SemiBold.ttf",
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
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
};

export default config;
