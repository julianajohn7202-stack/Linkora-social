/**
 * check-drift.ts — Validate that checked-in SDK bindings match contract artifacts.
 *
 * Runs the codegen generator in CI and reports reproducible source diffs if drift
 * has occurred. Fails if generated output does not match checked-in bindings or
 * if evaluated against a stale fixture.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const GENERATED_DIR = resolve(ROOT, "packages/sdk/src/generated");

interface CheckResult {
  hasDiff: boolean;
  diffOutput: string;
}

export function checkDriftAgainstDirectory(targetDir: string, referenceDir: string): CheckResult {
  const targetFiles = readdirSync(targetDir).filter((f) => f.endsWith(".ts"));
  let diffs: string[] = [];

  for (const file of targetFiles) {
    const targetPath = resolve(targetDir, file);
    const refPath = resolve(referenceDir, file);

    if (!existsSync(refPath)) {
      diffs.push(`Missing generated file in reference: ${file}`);
      continue;
    }

    const targetContent = readFileSync(targetPath, "utf-8");
    const refContent = readFileSync(refPath, "utf-8");

    if (targetContent !== refContent) {
      diffs.push(`--- a/${file}\n+++ b/${file}\nContent mismatch in ${file}`);
    }
  }

  return {
    hasDiff: diffs.length > 0,
    diffOutput: diffs.join("\n\n"),
  };
}

export function runValidation(): void {
  const fixtureArgIndex = process.argv.indexOf("--fixture");
  const fixtureDir = fixtureArgIndex !== -1 ? resolve(process.argv[fixtureArgIndex + 1]) : null;

  if (fixtureDir) {
    console.log(`[check-drift] Validating against fixture directory: ${fixtureDir}`);
    const result = checkDriftAgainstDirectory(GENERATED_DIR, fixtureDir);
    if (result.hasDiff) {
      console.error("❌ Stale generated output detected against fixture!");
      console.error(result.diffOutput);
      process.exit(1);
    }
    console.log("✓ Fixture output matches generated bindings.");
    return;
  }

  console.log("[check-drift] Running generator to check for ABI binding drift...");
  try {
    execSync("tsx generate.ts", { cwd: __dirname, stdio: "inherit" });
  } catch (err: unknown) {
    console.error("❌ Codegen execution failed:", err);
    process.exit(1);
  }

  // Check git status/diff for packages/sdk/src/generated
  try {
    const diff = execSync(`git diff --color=never -- "${GENERATED_DIR}"`, {
      cwd: ROOT,
      encoding: "utf-8",
    });

    if (diff.trim().length > 0) {
      console.error("❌ DRIFT DETECTED: Checked-in SDK bindings do not match contract artifacts!");
      console.error("\nReproducible source diff:");
      console.error(diff);
      console.error("\nTo resolve, regenerate bindings and commit the changes:");
      console.error("  pnpm --filter @linkora/codegen generate\n");
      process.exit(1);
    }

    // Also check for any untracked new generated files
    const untracked = execSync(`git status --porcelain -- "${GENERATED_DIR}"`, {
      cwd: ROOT,
      encoding: "utf-8",
    });

    if (untracked.trim().length > 0) {
      console.error("❌ UNTRACKED FILES DETECTED in generated SDK directory:");
      console.error(untracked);
      process.exit(1);
    }

    console.log("✓ Clean regeneration: Generated SDK bindings are in sync with contract artifacts.");
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "status" in err && (err as { status: number }).status === 1) {
      process.exit(1);
    }
    throw err;
  }
}

if (process.argv[1] && process.argv[1].endsWith("check-drift.ts")) {
  runValidation();
}
