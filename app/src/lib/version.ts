import Constants from "expo-constants";

export const APP_VERSION: string = Constants.expoConfig?.version ?? "1.0.0";
/** Shown in Settings and on the laptop sidebar: "1.0.0 beta". */
export const VERSION_LABEL = `${APP_VERSION} beta`;
