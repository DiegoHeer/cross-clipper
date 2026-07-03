import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { ApiClient, ApiError, Outbox, SyncEngine } from "@crossclipper/core";

import { FileStorage } from "./storage.js";
import { nodeSocketFactory } from "./ws.js";

const VERSION = "0.1.0";
const dir = process.env["CC_CLI_DIR"] ?? path.join(os.homedir(), ".crossclipper-cli");
const configPath = path.join(dir, "config.json");
const statePath = path.join(dir, "state.json");

interface Config { baseUrl: string; token: string; deviceId: string }

async function loadConfig(): Promise<Config> {
  try {
    return JSON.parse(await fs.readFile(configPath, "utf8")) as Config;
  } catch {
    console.error("not logged in — run: cli login <serverUrl> <email> <password> [deviceName]");
    process.exit(1);
  }
}

function makeClient(cfg: Config): ApiClient {
  return new ApiClient({
    baseUrl: cfg.baseUrl, token: cfg.token, clientVersion: VERSION,
    onAuthFailure: () => console.error("auth failed — token revoked or expired; run login again"),
  });
}

const wsUrl = (cfg: Config) =>
  `${cfg.baseUrl.replace(/^http/, "ws")}/api/v1/ws?token=${encodeURIComponent(cfg.token)}`;

const [cmd = "help", ...args] = process.argv.slice(2);

if (cmd === "login") {
  const [baseUrl, email, password, deviceName] = args;
  if (!baseUrl || !email || !password) {
    console.error("usage: cli login <serverUrl> <email> <password> [deviceName]");
    process.exit(1);
  }
  if (!/^https:/.test(baseUrl) && !/localhost|127\.0\.0\.1|^http:\/\/192\.168\./.test(baseUrl)) {
    console.error("WARNING: non-local http:// URL — your token and items travel in cleartext (spec §5)");
  }
  const client = new ApiClient({ baseUrl, clientVersion: VERSION });
  try {
    await client.register(email, password);
    console.log("registered new user (first run)");
  } catch (err) {
    // registration_closed = server locked; email_taken = user already exists; both mean skip to login
    if (!(err instanceof ApiError && (err.code === "registration_closed" || err.code === "email_taken"))) throw err;
  }
  const res = await client.login({
    email, password, device_name: deviceName ?? os.hostname(), platform: "other" });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath,
    JSON.stringify({ baseUrl, token: res.token, deviceId: res.device_id }, null, 2));
  console.log(`logged in — device ${res.device_id}`);
} else if (cmd === "send") {
  const body = args.join(" ");
  if (!body) { console.error("usage: cli send <text>"); process.exit(1); }
  const cfg = await loadConfig();
  const outbox = new Outbox({
    client: makeClient(cfg),
    storage: new FileStorage(statePath),
    onEvent: (e) => {
      if (e.type === "delivered") { console.log(`delivered ${e.item.id}`); process.exit(0); }
      if (e.type === "rejected") { console.error(`rejected: ${e.error.code}`); process.exit(1); }
      if (e.type === "auth_required") { console.error("auth required — run login again"); process.exit(1); }
    },
  });
  await outbox.load();
  await outbox.send("text", body);
  await outbox.flush(); // retries keep the process alive until delivered/rejected
} else if (cmd === "feed") {
  const cfg = await loadConfig();
  const client = makeClient(cfg);
  let cursor: string | undefined;
  for (;;) {
    const page = await client.listItems({ cursor });
    for (const item of page.items) {
      if (!item.deleted_at) {
        const target = item.target_device_id ? `  → ${item.target_device_id}` : "";
        console.log(`${item.id}  [${item.origin_device_id}]  ${item.body}${target}`);
      }
    }
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
} else if (cmd === "devices") {
  const cfg = await loadConfig();
  const { devices } = await makeClient(cfg).listDevices();
  for (const d of devices) {
    const me = d.id === cfg.deviceId ? " (this device)" : "";
    console.log(`${d.id}  ${d.platform.padEnd(9)}  ${d.name}${me}  last seen ${d.last_seen_at}`);
  }
} else if (cmd === "listen") {
  const cfg = await loadConfig();
  const engine = new SyncEngine({
    client: makeClient(cfg),
    storage: new FileStorage(statePath),
    socketFactory: nodeSocketFactory,
    wsUrl: () => wsUrl(cfg),
  });
  engine.onEvent((e) => {
    if (e.type === "item") {
      const target = e.item.target_device_id ? `  → ${e.item.target_device_id}` : "";
      console.log(`[${e.item.origin_device_id}] ${e.item.body}${target}`);
    } else if (e.type === "item_deleted") {
      console.log(`(deleted ${e.itemId})`);
    } else if (e.type === "devices_changed") {
      console.log("(device list changed)");
    } else if (e.type === "status") {
      console.log(`-- ${e.status}`);
    } else {
      console.log("-- auth_failed: run login again");
    }
  });
  await engine.start();
  console.log("listening — Ctrl-C to quit");
} else {
  console.log(`crossclipper cli ${VERSION}
usage:
  cli login <serverUrl> <email> <password> [deviceName]
  cli send <text...>
  cli feed
  cli devices
  cli listen`);
}
