import type { ExpoConfig } from "expo/config";

// rpId = the HTTPS host that serves /.well-known/assetlinks.json for this app.
const rpId = process.env.MERA_RP_ID ?? "mirror.0xo.in";
// NOTE: "in" is a Java/Kotlin keyword and "0xo" starts with a digit, so
// "in.0xo.*" cannot be used as an Android package. Pick e.g. com.zeroxo.*.
const applicationId = process.env.APP_ID ?? "com.zeroxo.mirror";

const config: ExpoConfig = {
  name: "Mirror PRF probe",
  slug: "meraprobe",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: applicationId,
    associatedDomains: [`webcredentials:${rpId}`],
  },
  android: {
    package: applicationId,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
  },
  extra: { rpId },
};

export default config;
