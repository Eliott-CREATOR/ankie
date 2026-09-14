/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Fable N7 (reports/T-007.md): the CLI guard compared process.argv[1] to the module URL without
// resolving symlinks. Node makes argv[1] absolute but does not resolve symlinks, while
// import.meta.url for an ES module is already the realpath — so running the script through a
// symlinked path made the guard's === false and main() silently never ran, exiting 0 having
// written nothing. This spawns a real node process through a temp-dir symlink — the only way to
// observe whether main() actually ran.
const here = path.dirname(fileURLToPath(import.meta.url));
const seedScript = path.join(here, "../../scripts/seed.mjs");
const generatedSql = path.join(path.dirname(seedScript), "seed-generated.sql");

describe("seed.mjs's CLI guard survives a symlinked invocation path (N7)", () => {
  it("runs main() when invoked through a symlink, not just the real path", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "ankie-seed-symlink-"));
    const symlinkPath = path.join(tempDir, "seed-via-symlink.mjs");
    try {
      symlinkSync(seedScript, symlinkPath);

      const result = spawnSync(process.execPath, [symlinkPath], { encoding: "utf8" });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Wrote");
      expect(result.stdout).toContain("statements");
      expect(existsSync(generatedSql)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      // seed-generated.sql is a gitignored, rebuildable artifact of running the script — this
      // test's only side effect on the real worktree, cleaned up so running the suite doesn't
      // leave it behind.
      if (existsSync(generatedSql)) {
        unlinkSync(generatedSql);
      }
    }
  });
});
