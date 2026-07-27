#!/usr/bin/env node

import {
  chmodSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import process from "node:process";

function fail(message) {
  console.error(`[production origin ERROR] ${message}`);
  process.exit(1);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    fail(`${name} is required.`);
  }
  return process.argv[index + 1];
}

const envPath = path.resolve(argument("--env"));
const baseUrl = argument("--base-url");
const trustedCidr = argument("--trusted-cidr");

let parsedUrl;
try {
  parsedUrl = new URL(baseUrl);
} catch {
  fail("--base-url must be a valid absolute URL.");
}

if (!["http:", "https:"].includes(parsedUrl.protocol)) {
  fail("--base-url must use http:// or https://.");
}
if (
  parsedUrl.username ||
  parsedUrl.password ||
  parsedUrl.pathname !== "/" ||
  parsedUrl.search ||
  parsedUrl.hash
) {
  fail("--base-url must be an origin without credentials, path, query, or fragment.");
}
if (!/^[0-9.]+\/[0-9]{1,2}$/.test(trustedCidr)) {
  fail("--trusted-cidr must look like 192.168.0.0/24.");
}

const replacements = new Map([
  ["MOLDPILOT_BASE_URL", baseUrl],
  ["MOLDPILOT_SESSION_COOKIE_SECURE", "auto"],
  ["MOLDPILOT_TRUST_PROXY", "1"],
  ["MOLDPILOT_TRUSTED_CIDR", trustedCidr]
]);
const seen = new Set();
const input = readFileSync(envPath, "utf8");
const lines = input.split(/\r?\n/);
const updated = lines.map((line) => {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
  if (!match || !replacements.has(match[1])) {
    return line;
  }
  if (seen.has(match[1])) {
    fail(`Duplicate ${match[1]} entry in ${envPath}.`);
  }
  seen.add(match[1]);
  return `${match[1]}=${JSON.stringify(replacements.get(match[1]))}`;
});

for (const [key, value] of replacements) {
  if (!seen.has(key)) {
    updated.push(`${key}=${JSON.stringify(value)}`);
  }
}

const output = `${updated.filter((line, index) => line !== "" || index < updated.length - 1).join("\n")}\n`;
const temporaryPath = `${envPath}.tmp-${process.pid}`;
try {
  writeFileSync(temporaryPath, output, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, envPath);
  chmodSync(envPath, 0o600);
} catch (error) {
  rmSync(temporaryPath, { force: true });
  fail(error instanceof Error ? error.message : "Could not update the environment file.");
}

console.log(`Updated production origin to ${baseUrl}`);
console.log(`Trusted factory network: ${trustedCidr}`);
