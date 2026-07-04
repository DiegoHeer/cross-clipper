/**
 * Unit tests for the Firefox manifest transform logic.
 *
 * The transform is a pure function over a manifest object; we test it
 * without touching the filesystem so the suite stays fast and hermetic.
 */

import { describe, it, expect } from "vitest";

// ── Inline the transform so it can be tested without side-effects ─────────────
// Keep this in sync with scripts/build-firefox.mjs.
interface ManifestBackground {
  service_worker?: string;
  scripts?: string[];
  type?: string;
}

interface Manifest {
  background?: ManifestBackground;
  browser_specific_settings?: {
    gecko?: { id: string; strict_min_version: string };
  };
  [key: string]: unknown;
}

function applyFirefoxTransform(manifest: Manifest): Manifest {
  const worker = manifest.background?.service_worker;
  if (!worker) throw new Error("no background.service_worker in dist manifest");

  return {
    ...manifest,
    background: { scripts: [worker], type: "module" },
    browser_specific_settings: {
      gecko: { id: "crossclipper@self-hosted", strict_min_version: "121.0" },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("applyFirefoxTransform", () => {
  const chromeManifest: Manifest = {
    manifest_version: 3,
    name: "CrossClipper",
    version: "0.1.0",
    background: { service_worker: "service-worker-loader.js", type: "module" },
  };

  it("replaces service_worker with scripts array", () => {
    const result = applyFirefoxTransform(chromeManifest);
    expect(result.background?.scripts).toEqual(["service-worker-loader.js"]);
    expect(result.background?.service_worker).toBeUndefined();
  });

  it("preserves background.type = module", () => {
    const result = applyFirefoxTransform(chromeManifest);
    expect(result.background?.type).toBe("module");
  });

  it("adds browser_specific_settings.gecko", () => {
    const result = applyFirefoxTransform(chromeManifest);
    expect(result.browser_specific_settings?.gecko).toEqual({
      id: "crossclipper@self-hosted",
      strict_min_version: "121.0",
    });
  });

  it("preserves other top-level manifest fields", () => {
    const result = applyFirefoxTransform(chromeManifest);
    expect(result.manifest_version).toBe(3);
    expect(result.name).toBe("CrossClipper");
    expect(result.version).toBe("0.1.0");
  });

  it("throws when service_worker is absent", () => {
    const noWorker: Manifest = { manifest_version: 3, background: {} };
    expect(() => applyFirefoxTransform(noWorker)).toThrow(
      "no background.service_worker in dist manifest"
    );
  });

  it("throws when background is absent", () => {
    const noBackground: Manifest = { manifest_version: 3 };
    expect(() => applyFirefoxTransform(noBackground)).toThrow(
      "no background.service_worker in dist manifest"
    );
  });
});
