import { passkeyLabel } from "../src/lib/passkeyLabel";

describe("passkey label", () => {
  it("names each passkey with its creation minute so pickers can tell accounts apart", () => {
    expect(passkeyLabel("Mirror", new Date(2026, 9, 7, 8, 5))).toBe("Mirror account · 2026-10-07 08:05");
  });
});
