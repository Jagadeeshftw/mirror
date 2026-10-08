jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) }));
import { channelAtStartup, getAlertsPref } from "../src/state/alertsPref";

describe("notification permission is not asked after account creation", () => {
  it("a fresh account (alerts unset, permission undetermined) creates no channel at start", async () => {
    expect(await getAlertsPref()).toBe("unset");
    expect(channelAtStartup("unset", "undetermined")).toBe(false);
    expect(channelAtStartup("off", "denied")).toBe(false);
  });
  it("after alerts were turned on, or permission was already granted, the channel is set up at start", () => {
    expect(channelAtStartup("on", "undetermined")).toBe(true);
    expect(channelAtStartup("unset", "granted")).toBe(true);
  });
});
