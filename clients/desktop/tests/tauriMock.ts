// Full Tauri API mock for unit tests (expanded in Task 5).
// Provides a functional in-memory event bus + Store for vitest.

type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Set<Handler>>();

export async function listen(name: string, cb: Handler): Promise<() => void> {
  const set = handlers.get(name) ?? new Set();
  set.add(cb);
  handlers.set(name, set);
  return () => {
    set.delete(cb);
  };
}

export async function emit(name: string, payload?: unknown): Promise<void> {
  const set = handlers.get(name);
  if (!set) return;
  for (const cb of set) cb({ payload });
}

export async function once(name: string, cb: Handler): Promise<() => void> {
  let unlisten: (() => void) | null = null;
  const wrapped: Handler = (e) => {
    cb(e);
    unlisten?.();
  };
  unlisten = await listen(name, wrapped);
  return unlisten;
}

/** Reset all listeners between tests. */
export function __resetEvents(): void {
  handlers.clear();
}

// ---------------------------------------------------------------------------
// @tauri-apps/plugin-store stub — in-memory map, no file I/O.
// ---------------------------------------------------------------------------
export class Store {
  private readonly data = new Map<string, unknown>();

  // The real Store constructor takes a path string; we accept it but ignore it.
  constructor(_path?: string) {}

  async get<T>(key: string): Promise<T | null> {
    const v = this.data.get(key);
    return v === undefined ? null : (v as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async save(): Promise<void> {}
}

// LazyStore alias — same behaviour for tests.
export { Store as LazyStore };

export default Store;
