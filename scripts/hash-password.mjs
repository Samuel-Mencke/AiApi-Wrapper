#!/usr/bin/env node
import crypto from "node:crypto";

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").replace(/[\r\n]+$/, "");
}

const password = process.argv[2] ?? (await readStandardInput());
if (!password) {
  console.error("Provide the password through stdin or as the first argument.");
  process.exit(1);
}
if (password.length < 12) {
  console.error("Use an admin password with at least 12 characters.");
  process.exit(1);
}

const iterations = 310_000;
const salt = crypto.randomBytes(16).toString("hex");
const digest = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
process.stdout.write(`pbkdf2_sha256$${iterations}$${salt}$${digest}\n`);
