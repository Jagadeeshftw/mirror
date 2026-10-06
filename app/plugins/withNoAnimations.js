// No motion anywhere: disable Android window/activity transition animations for the app theme.
const { withAndroidStyles } = require("expo/config-plugins");

module.exports = function withNoAnimations(config) {
  return withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults.resources.style || [];
    for (const style of styles) {
      if (style.$.name === "AppTheme") {
        style.item = (style.item || []).filter((i) => i.$.name !== "android:windowAnimationStyle");
        style.item.push({ $: { name: "android:windowAnimationStyle" }, _: "@null" });
      }
    }
    return cfg;
  });
};
