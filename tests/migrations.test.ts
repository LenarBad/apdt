import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../src/init/init.js";
import { loadManifest } from "../src/inventory/manifest.js";
import {
  compareVersions,
  PRODUCTION_MIGRATIONS,
  resolveInstalledTemplateVersion,
  runPendingMigrations,
  type Migration,
} from "../src/migrations/index.js";
import { updateProject } from "../src/update/update.js";
import { TEMPLATE_VERSION } from "../src/version.js";
import { workspaceTempDir } from "./helpers.js";

function tempDir(): string {
  return workspaceTempDir();
}

describe("template migrations", () => {
  it("keeps an empty production registry at TEMPLATE_VERSION 0.2.0", () => {
    expect(TEMPLATE_VERSION).toBe("0.2.0");
    expect(PRODUCTION_MIGRATIONS).toEqual([]);
  });

  it("compares dotted versions", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.2.1", "0.2.0")).toBeGreaterThan(0);
  });

  it("resolves installed template version from manifest field or file max", () => {
    expect(
      resolveInstalledTemplateVersion({
        version: 1,
        apdtVersion: "0.1.0",
        createdAt: "t",
        updatedAt: "t",
        templateVersion: "0.1.5",
        files: [
          {
            path: "AGENTS.md",
            hash: "x",
            templateId: "core/agents-md",
            templateVersion: "0.2.0",
            managed: true,
            lastAppliedApdtVersion: "0.1.0",
          },
        ],
      }),
    ).toBe("0.1.5");

    expect(
      resolveInstalledTemplateVersion({
        version: 1,
        apdtVersion: "0.1.0",
        createdAt: "t",
        updatedAt: "t",
        files: [
          {
            path: "a",
            hash: "x",
            templateId: "a",
            templateVersion: "0.1.0",
            managed: true,
            lastAppliedApdtVersion: "0.1.0",
          },
          {
            path: "b",
            hash: "y",
            templateId: "b",
            templateVersion: "0.1.9",
            managed: true,
            lastAppliedApdtVersion: "0.1.0",
          },
        ],
      }),
    ).toBe("0.1.9");

    expect(
      resolveInstalledTemplateVersion({
        version: 1,
        apdtVersion: "0.1.0",
        createdAt: "t",
        updatedAt: "t",
        files: [],
      }),
    ).toBe("0.2.0");
  });

  it("invokes injected registry migrations when behind", () => {
    const root = tempDir();
    mkdirSync(root, { recursive: true });
    const marker = join(root, "migration-marker.txt");
    const registry: Migration[] = [
      {
        id: "test-0.1.0-to-0.1.1",
        from: "0.1.0",
        to: "0.1.1",
        description: "test-only first hop",
        apply: (repo) => {
          writeFileSync(join(repo, "migration-marker.txt"), "hop1\n");
        },
      },
      {
        id: "test-0.1.1-to-0.2.0",
        from: "0.1.1",
        to: "0.2.0",
        description: "test-only second hop",
        apply: (repo) => {
          const prev = readFileSync(join(repo, "migration-marker.txt"), "utf8");
          writeFileSync(join(repo, "migration-marker.txt"), `${prev}hop2\n`);
        },
      },
    ];

    const result = runPendingMigrations(
      root,
      "0.1.0",
      "0.2.0",
      {},
      registry,
    );
    expect(result.applied).toEqual([
      "test-0.1.0-to-0.1.1",
      "test-0.1.1-to-0.2.0",
    ]);
    expect(result.currentVersion).toBe("0.2.0");
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, "utf8")).toBe("hop1\nhop2\n");

    const noop = runPendingMigrations(root, "0.2.0", "0.2.0", {}, registry);
    expect(noop.applied).toEqual([]);
  });

  it("update records empty migrations when already at TEMPLATE_VERSION", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "migrate-current",
      harnesses: ["cursor"],
      preset: "minimal",
    });
    const manifest = loadManifest(root)!;
    expect(resolveInstalledTemplateVersion(manifest)).toBe(TEMPLATE_VERSION);

    const result = updateProject(root);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrations.applied).toEqual([]);
      expect(result.migrations.fromVersion).toBe(TEMPLATE_VERSION);
    }
  });
});
