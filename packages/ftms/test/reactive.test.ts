import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EventSource,
  StateSource,
  distinctStream,
  filterStream,
  mapState,
  mapStream,
} from "../src/reactive.js";

describe("dependency-free reactive primitives", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes synchronous current state and immediately updates subscribers", () => {
    const source = new StateSource(10);
    const state = source.asReadonly();
    const values: number[] = [];

    const unsubscribe = state.subscribe((value) => values.push(value));
    source.set(20);
    unsubscribe();
    source.set(30);

    expect(state.current).toBe(30);
    expect(values).toEqual([10, 20]);
    expect("set" in state).toBe(false);
    expect("emit" in state).toBe(false);
  });

  it("maps state without exposing mutation", () => {
    const source = new StateSource({ watts: 100 });
    const power = mapState(source.asReadonly(), (sample) => sample.watts);
    const values: number[] = [];

    power.subscribe((value) => values.push(value));
    source.set({ watts: 175 });

    expect(power.current).toBe(175);
    expect(values).toEqual([100, 175]);
  });

  it("composes map, filter, and distinct streams per subscriber", () => {
    const source = new EventSource<number>();
    const transformed = distinctStream(
      filterStream(
        mapStream(source.asReadonly(), (value) => value * 2),
        (value) => value >= 4,
      ),
    );
    const values: number[] = [];
    transformed.subscribe((value) => values.push(value));

    source.emit(1);
    source.emit(2);
    source.emit(2);
    source.emit(3);

    expect(values).toEqual([4, 6]);
  });

  it("isolates listener failures and keeps notifying other listeners", () => {
    const listenerErrors: unknown[] = [];
    const source = new EventSource<number>((error) => listenerErrors.push(error));
    const values: number[] = [];
    source.subscribe(() => {
      throw new Error("broken consumer");
    });
    source.subscribe((value) => values.push(value));

    expect(() => source.emit(42)).not.toThrow();
    expect(values).toEqual([42]);
    expect(listenerErrors).toHaveLength(1);
    expect(listenerErrors[0]).toEqual(new Error("broken consumer"));
  });

  it("isolates failures in a StateValue's immediate subscription emission", () => {
    const listenerErrors: unknown[] = [];
    const source = new StateSource(10, (error) => listenerErrors.push(error));

    expect(() =>
      source.asReadonly().subscribe(() => {
        throw new Error("broken state consumer");
      }),
    ).not.toThrow();
    expect(listenerErrors).toHaveLength(1);
  });

  it("uses the platform error reporter and supports clearing listeners", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const source = new EventSource<number>();
    const values: number[] = [];
    source.subscribe(() => {
      throw new Error("reported");
    });
    source.subscribe((value) => values.push(value));

    source.emit(1);
    source.clear();
    source.emit(2);

    expect(reportError).toHaveBeenCalledOnce();
    expect(values).toEqual([1]);
  });
});
