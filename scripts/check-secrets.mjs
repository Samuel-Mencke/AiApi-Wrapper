#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const forbiddenPaths = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$).+/,
  /^config\/providers\.yml$/,
  /(^|\/)gateway\.db(?:-(?:shm|wal))?$/,
  /(^|\/)data\//,
  /(^|\/)\.cloudflared\//,
  /\.(?:pem|p12|pfx|key)$/i,
  /credentials.*\.json$/i,
  /(^|\/)\.ui-backups\//,
  /\.(?:bak|before|patch)(?:[-.].*)?$/i
];

const contentPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{24,}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["JWT or tunnel token", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/]
];

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const failures = [];
for (const file of tracked) {
  if (forbiddenPaths.some((pattern) => pattern.test(file))) {
    failures.push(`${file}: forbidden sensitive/runtime path is tracked`);
    continue;
  }

  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) continue;

  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }

  for (const [label, pattern] of contentPatterns) {
    if (pattern.test(content)) {
      failures.push(`${file}: possible ${label}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Secret check failed:\n" + failures.map((entry) => `- ${entry}`).join("\n"));
  process.exit(1);
}

console.log(`Secret check passed for ${tracked.length} tracked files.`);
