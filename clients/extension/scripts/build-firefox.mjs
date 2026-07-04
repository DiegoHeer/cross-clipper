// Firefox MV3 variant: copies dist/ and swaps the background entry.
// Firefox runs MV3 backgrounds as event pages (background.scripts), not
// service workers. All runtime code already goes through webextension-polyfill.
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const dist = new URL("../dist", import.meta.url).pathname;
const out = new URL("../dist-firefox", import.meta.url).pathname;

rmSync(out, { recursive: true, force: true });
cpSync(dist, out, { recursive: true });

const manifestPath = path.join(out, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const worker = manifest.background?.service_worker;
if (!worker) throw new Error("no background.service_worker in dist manifest");
manifest.background = { scripts: [worker], type: "module" };
manifest.browser_specific_settings = {
  gecko: { id: "crossclipper@self-hosted", strict_min_version: "121.0" },
};

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`firefox build written to ${out}`);
