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

export class EventSource<T> {
  readonly #listeners = new Set<(value: T) => void>();
  readonly #view: Stream<T>;

  constructor() {
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
    for (const listener of [...this.#listeners]) listener(value);
  }

  clear(): void {
    this.#listeners.clear();
  }
}

export class StateSource<T> {
  readonly #events = new EventSource<T>();
  readonly #view: StateValue<T>;
  #current: T;

  constructor(initialValue: T) {
    this.#current = initialValue;
    const source = this;
    this.#view = Object.freeze({
      get current(): T {
        return source.#current;
      },
      subscribe(listener: (value: T) => void): Unsubscribe {
        listener(source.#current);
        return source.#events.subscribe(listener);
      },
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
