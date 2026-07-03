import { promises as fs } from "node:fs";
import path from "node:path";

import type { SyncStorage } from "@crossclipper/core";

export class FileStorage implements SyncStorage {
  constructor(private readonly filePath: string) {}

  private async read(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async get(key: string): Promise<string | null> {
    return (await this.read())[key] ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const data = await this.read();
    data[key] = value;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
  }
}
