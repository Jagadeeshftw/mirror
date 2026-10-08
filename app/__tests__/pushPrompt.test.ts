// Android: no notification permission prompt (and no channel, which can trigger one) until alerts are turned on.
import { deriveNotifyKey } from "../src/lib/notifyKey";

const mockKeys = deriveNotifyKey(new Uint8Array(32).fill(3));
let mockPref = "unset";
const mockN = {
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  registerTaskAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ status: "undetermined" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: "android", data: "fcm-token" })),
  AndroidImportance: { HIGH: 4 },
};
jest.mock("expo-notifications", () => mockN);
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) }));
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));
jest.mock("react-native", () => ({ Platform: { OS: "android" }, AppState: { currentState: "active" } }));
jest.mock("../src/lib/wallet", () => ({ loadNotifyKey: async () => mockKeys }));
jest.mock("../src/state/notifications", () => ({ addNotification: jest.fn() }));
jest.mock("../src/state/alertsPref", () => ({ ...jest.requireActual("../src/state/alertsPref"), getAlertsPref: async () => mockPref }));
jest.mock("../src/lib/api", () => ({ api: {} }));
jest.mock("../src/lib/pushRegistration", () => ({ loadPushReg: async () => null, registerSigned: jest.fn(async () => {}), savePushReg: jest.fn(), unregisterSigned: jest.fn() }));
// Required after the mocks above are initialised (an import would be hoisted above them).
const { registerForPush, setupNotifications } = require("../src/lib/push") as typeof import("../src/lib/push");

const OWNER = "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f" as const;

beforeEach(() => {
  jest.clearAllMocks();
  mockPref = "unset";
});

it("right after account creation: app start creates no channel and asks nothing", async () => {
  await setupNotifications();
  await registerForPush(OWNER);
  expect(mockN.setNotificationChannelAsync).not.toHaveBeenCalled();
  expect(mockN.requestPermissionsAsync).not.toHaveBeenCalled();
});

it("turning alerts on: channel, then the one permission prompt", async () => {
  const r = await registerForPush(OWNER, { ask: true });
  expect(mockN.setNotificationChannelAsync).toHaveBeenCalledTimes(1);
  expect(mockN.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(r.permission).toBe("granted");
});

it("alerts already on: the channel is set up at start, still no prompt", async () => {
  mockPref = "on";
  await setupNotifications();
  await registerForPush(OWNER);
  expect(mockN.setNotificationChannelAsync).toHaveBeenCalledTimes(1);
  expect(mockN.requestPermissionsAsync).not.toHaveBeenCalled();
});
