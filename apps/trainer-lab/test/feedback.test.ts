import { describe, expect, it } from "vitest";
import { powerFeedback } from "../src/ui/feedback";

describe("power guidance", () => {
  it("does not celebrate missing, stale, paused or invalid readings", () => {
    expect(powerFeedback(undefined, 100, true).band).toBe("waiting");
    expect(powerFeedback(NaN, 100, true).band).toBe("waiting");
    expect(powerFeedback(100, 100, false).band).toBe("waiting");
    expect(powerFeedback(0, 0, true).band).toBe("waiting");
  });
  it("uses a five-watt or five-percent pocket, whichever is larger", () => {
    expect(powerFeedback(55, 60, true).band).toBe("pocket");
    expect(powerFeedback(54, 60, true).band).toBe("below");
    expect(powerFeedback(315, 300, true).band).toBe("pocket");
    expect(powerFeedback(316, 300, true).band).toBe("above");
  });
  it("clamps the pointer and includes a directional watt difference", () => {
    expect(powerFeedback(0, 100, true)).toMatchObject({ band: "below", position: 0 });
    expect(powerFeedback(500, 100, true)).toMatchObject({ band: "above", position: 100 });
    expect(powerFeedback(80, 100, true).guidance).toContain("20 W below");
  });
  it("keeps the pointer inside the green pocket at both tolerance boundaries", () => {
    for (const target of [25, 60, 100, 300]) {
      const tolerance = Math.max(5, target * 0.05);
      expect(powerFeedback(target - tolerance, target, true)).toMatchObject({
        band: "pocket",
        position: 45,
      });
      expect(powerFeedback(target + tolerance, target, true)).toMatchObject({
        band: "pocket",
        position: 55,
      });
    }
  });
});
