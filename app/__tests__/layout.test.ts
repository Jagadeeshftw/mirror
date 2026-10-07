import { LAPTOP_MIN_WIDTH, layoutFor } from "../src/lib/layout";

describe("layoutFor", () => {
  it("uses the laptop shell on the web from 1024 px", () => {
    expect(layoutFor(1440, "web")).toBe("laptop");
    expect(layoutFor(LAPTOP_MIN_WIDTH, "web")).toBe("laptop");
  });
  it("uses the phone layout below 1024 px on the web", () => {
    expect(layoutFor(1023, "web")).toBe("phone");
    expect(layoutFor(390, "web")).toBe("phone");
  });
  it("always uses the phone layout on Android", () => {
    expect(layoutFor(1600, "android")).toBe("phone");
  });
});
