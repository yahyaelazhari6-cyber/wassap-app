#!/usr/bin/env node
/**
 * Packages the Wassel launcher into a Webintoapp-compatible ZIP.
 *
 * The archive is built so that index.html sits at the ROOT of the ZIP
 * (no nested folder), which is what Webintoapp's "Upload HTML ZIP" expects.
 *
 * Usage:
 *   node scripts/package-webintoapp.mjs [serverUrl]
 *   WASSEL_SERVER_URL=https://host node scripts/package-webintoapp.mjs
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const SRC = path.join(root, "webintoapp");
const STAGE = path.join(root, ".webintoapp-build");
const OUT_DIR = path.join(root, "public");
const OUT_ZIP = path.join(OUT_DIR, "wassel-webintoapp.zip");

const serverUrl = (process.argv[2] || process.env.WASSEL_SERVER_URL || "").trim().replace(/\/+$/, "");

// 1) stage a clean copy
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
cpSync(SRC, STAGE, { recursive: true });

// 2) inject the server URL into the launcher
const indexPath = path.join(STAGE, "index.html");
let html = readFileSync(indexPath, "utf8");
if (serverUrl) {
  html = html.replace("__WASSEL_SERVER_URL__", serverUrl);
  console.log(`  server URL baked in : ${serverUrl}`);
} else {
  html = html.replace("__WASSEL_SERVER_URL__", "");
  console.log("  server URL baked in : (none — the launcher will prompt on first run)");
}
writeFileSync(indexPath, html, "utf8");

// 3) zip the CONTENTS of the staging dir so index.html is at the archive root
rmSync(OUT_ZIP, { force: true });
mkdirSync(OUT_DIR, { recursive: true });
execFileSync("zip", ["-r", "-q", "-X", OUT_ZIP, "."], { cwd: STAGE, stdio: "inherit" });

// 4) verify the archive layout
const listing = execFileSync("unzip", ["-Z1", OUT_ZIP], { encoding: "utf8" })
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

if (!listing.includes("index.html")) {
  console.error("\nFAILED: index.html is not at the ZIP root.\n");
  process.exit(1);
}

rmSync(STAGE, { recursive: true, force: true });

const kb = (statSync(OUT_ZIP).size / 1024).toFixed(1);
console.log("\n  Webintoapp package ready");
console.log(`  file    : public/wassel-webintoapp.zip (${kb} KB)`);
console.log(`  entries : ${listing.join(", ")}`);
console.log("  index.html verified at archive root\n");
