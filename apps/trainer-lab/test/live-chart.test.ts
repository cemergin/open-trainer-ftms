import { describe, expect, it } from "vitest";
import type { RideSample } from "../src/ride";
import { liveChartData } from "../src/ui/live-chart";

function sample(seconds: number, watts: number | null, heartRate?: number | null): RideSample {
  return { seconds, watts, heartRate, cadence: null, speed: null, target: 150 };
}

describe("live ride chart", () => {
  it("starts empty and keeps missing heart rate distinct from zero power", () => {
    expect(liveChartData([], 0, "erg")).toMatchObject({
      start: 0,
      end: 120,
      power: "",
      heartRate: "",
      target: "",
      latestPower: null,
      latestHeartRate: null,
    });
    const chart = liveChartData([sample(1, 0)], 1, "erg");
    expect(chart.power).toBe("M5.0,136.0L5.0,136.0");
    expect(chart.heartRate).toBe("");
    expect(chart.latestPower).toBe(0);
    expect(chart.latestHeartRate).toBeNull();
  });

  it("plots watts and BPM against separate scales without clipping peaks", () => {
    const chart = liveChartData([sample(1, 720, 211), sample(2, 600, 190)], 2, "erg");
    expect(chart.powerMax).toBe(800);
    expect(chart.heartRateMax).toBe(220);
    expect(chart.power).toContain("M5.0,17.2L5.0,17.2 L10.0,37.0");
    expect(chart.heartRate).toContain("M5.0,9.4");
    expect(chart.latestHeartRate).toBe(190);
  });

  it("leaves gaps for absent readings and long sample gaps", () => {
    const chart = liveChartData(
      [sample(1, 100, 120), sample(2, null, null), sample(3, 100, 120), sample(10, 100, 120)],
      10,
      "erg",
    );
    expect(chart.power.match(/M/g)).toHaveLength(3);
    expect(chart.heartRate.match(/M/g)).toHaveLength(3);
    expect(chart.target.match(/M/g)).toHaveLength(2);
    expect(liveChartData([sample(1, 100, 120)], 10, "erg").latestHeartRate).toBeNull();
  });

  it("scrolls by active seconds and excludes expired or future samples", () => {
    const chart = liveChartData(
      [sample(1, 900, 250), sample(121, 100, 120), sample(240, 150, 140), sample(241, 800, 240)],
      240,
      "erg",
    );
    expect(chart.start).toBe(120);
    expect(chart.end).toBe(240);
    expect(chart.powerMax).toBe(200);
    expect(chart.heartRateMax).toBe(200);
    expect(chart.power).toContain("M5.0,70.0");
    expect(chart.power).toContain("M600.0,37.0");
    expect(chart.latestHeartRate).toBe(140);
  });

  it.each(["terrain", "resistance"] as const)("hides the ERG target for %s", (mode) => {
    const reading = { ...sample(1, 100, 120), target: 1000 };
    expect(liveChartData([reading], 1, mode)).toMatchObject({ target: "", powerMax: 200 });
    expect(liveChartData([reading], 1, "erg").powerMax).toBe(1000);
  });

  it("restores the same chart from saved samples and holds while active time is paused", () => {
    const samples = [sample(1, 100, 120), sample(2, 130, 121)];
    const before = liveChartData(samples, 2, "erg");
    const restored: RideSample[] = JSON.parse(JSON.stringify(samples));
    expect(liveChartData(restored, 2, "erg")).toEqual(before);
    expect(samples).toEqual(restored);
  });
});
