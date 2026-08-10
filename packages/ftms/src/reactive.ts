import type { Unsubscribe } from "./types.js";

export interface Stream<T> {
  subscribe(listener: (value: T) => void): Unsubscribe;
}

export interface StateValue<T> extends Stream<T> {
  readonly current: T;
}

function readonlyStream<T>(subscribe: Stream<T>["subscribe"]): Stream<T> {
  return Object.freeze({ subscribe });
}

function reportUnhandledListenerError(error: unknown): void {
  const reportError = Reflect.get(globalThis, "reportError") as
    ((reason: unknown) => void) | undefined;
  if (typeof reportError === "function") {
    reportError.call(globalThis, error);
    return;
  }
  queueMicrotask(() => {
    throw error;
  });
}

export class EventSource<T> {
  readonly #listeners = new Set<(value: T) => void>();
  readonly #view: Stream<T>;

  constructor(
    private readonly onListenerError: (error: unknown) => void = reportUnhandledListenerError,
  ) {
    this.#view = readonlyStream((listener) => this.subscribe(listener));
  }

  asReadonly(): Stream<T> {
    return this.#view;
  }

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(value: T): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(value);
      } catch (error) {
        try {
          this.onListenerError(error);
        } catch (reportingError) {
          reportUnhandledListenerError(reportingError);
        }
      }
    }
  }

  clear(): void {
    this.#listeners.clear();
  }
}

export class StateSource<T> {
  readonly #events: EventSource<T>;
  readonly #view: StateValue<T>;
  #current: T;

  constructor(
    initialValue: T,
    onListenerError: (error: unknown) => void = reportUnhandledListenerError,
  ) {
    this.#events = new EventSource<T>(onListenerError);
    this.#current = initialValue;
    const getCurrent = (): T => this.#current;
    const subscribe = (listener: (value: T) => void): Unsubscribe => {
      try {
        listener(this.#current);
      } catch (error) {
        onListenerError(error);
      }
      return this.#events.subscribe(listener);
    };
    this.#view = Object.freeze({
      get current(): T {
        return getCurrent();
      },
      subscribe,
    });
  }

  get current(): T {
    return this.#current;
  }

  asReadonly(): StateValue<T> {
    return this.#view;
  }

  set(value: T): void {
    this.#current = value;
    this.#events.emit(value);
  }

  setIfChanged(value: T): void {
    if (!Object.is(this.#current, value)) this.set(value);
  }
}

export function mapStream<T, U>(source: Stream<T>, project: (value: T) => U): Stream<U> {
  return readonlyStream((listener) => source.subscribe((value) => listener(project(value))));
}

export function filterStream<T>(source: Stream<T>, predicate: (value: T) => boolean): Stream<T> {
  return readonlyStream((listener) =>
    source.subscribe((value) => {
      if (predicate(value)) listener(value);
    }),
  );
}

export function distinctStream<T>(
  source: Stream<T>,
  equals: (previous: T, current: T) => boolean = Object.is,
): Stream<T> {
  return readonlyStream((listener) => {
    let hasPrevious = false;
    let previous: T;
    return source.subscribe((value) => {
      if (!hasPrevious || !equals(previous, value)) {
        hasPrevious = true;
        previous = value;
        listener(value);
      }
    });
  });
}

export function mapState<T, U>(source: StateValue<T>, project: (value: T) => U): StateValue<U> {
  return Object.freeze({
    get current(): U {
      return project(source.current);
    },
    subscribe(listener: (value: U) => void): Unsubscribe {
      return source.subscribe((value) => listener(project(value)));
    },
  });
}
