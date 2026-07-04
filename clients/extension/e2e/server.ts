import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface TestServer {
  baseUrl: string;
  stop(): Promise<void>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "../../../server");

export async function startServer(port = 8790): Promise<TestServer> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "cc-e2e-ext-"));
  const proc: ChildProcess = spawn(
    "uv",
    ["run", "uvicorn", "crossclipper.asgi:app", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: SERVER_DIR,
      env: { ...process.env, CC_SECRET_KEY: "e2e-ext", CC_DATA_DIR: dataDir },
      stdio: "pipe",
    },
  );
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
    if (i === 59) throw new Error("server did not become healthy");
  }
  return {
    baseUrl,
    stop: async () => {
      proc.kill();
      await new Promise((r) => setTimeout(r, 200));
    },
  };
}
