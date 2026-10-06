import type { ExpoConfig } from "expo/config";

// Single replaceable product-name token.
const BRAND = "Mirror";
const rpId = process.env.MERA_RP_ID ?? "mirror.0xo.in";
const applicationId = "com.zeroxo.mirror";
const apiBase = process.env.EXPO_PUBLIC_API_BASE ?? "";

const config: ExpoConfig = {
  name: BRAND,
  slug: "mirror",
  scheme: "mirror",
  version: "0.9.2",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  backgroundColor: "#F6F6F3",
  android: {
    package: applicationId,
    versionCode: 92,
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
      { android: { minSdkVersion: 28 } },
    ],
    "./plugins/withReleaseSigning.js",
    "./plugins/withNoAnimations.js",
    "./plugins/withLocalCleartext.js",
  ],
  experiments: { typedRoutes: false },
  extra: {
    rpId,
    brand: BRAND,
    apiBase,
  },
};

export default config;
