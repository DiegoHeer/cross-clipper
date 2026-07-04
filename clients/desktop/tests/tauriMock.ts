// Minimal Tauri API mock for unit tests.
// Expanded in Task 5 with full emit/listen/Store stubs.

export const listen = async (
  _event: string,
  _handler: unknown,
): Promise<() => void> => {
  return () => undefined;
};

export const emit = async (_event: string, _payload?: unknown): Promise<void> =>
  undefined;

export const once = async (
  _event: string,
  _handler: unknown,
): Promise<() => void> => {
  return () => undefined;
};

// @tauri-apps/plugin-store stub
export class Store {
  constructor(_path: string) {}
  async get<T>(_key: string): Promise<T | null> {
    return null;
  }
  async set(_key: string, _value: unknown): Promise<void> {}
  async delete(_key: string): Promise<void> {}
  async clear(): Promise<void> {}
  async save(): Promise<void> {}
}

export default Store;
