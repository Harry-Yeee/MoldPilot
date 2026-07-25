#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { verifyExistingWritableDirectory } from "../src/domain/security/runtime-directory.ts";
import { validateProductionAuthenticationEnvironment } from "../src/domain/security/session-cookie.ts";

const requiredVariables = [
  "MOLDPILOT_DEPLOYMENT_MODE",
  "MOLDPILOT_SESSION_SECRET",
  "MOLDPILOT_BASE_URL",
  "MOLDPILOT_SESSION_COOKIE_SECURE",
  "DATABASE_URL",
  "MOLDPILOT_STORAGE_DIR",
  "MOLDPILOT_QUARANTINE_DIR"
];

function requiredValue(name) {
  const value = process.env[name]?.trim();
  if (value == null || value.length === 0) {
    throw new Error(`${name} is required for the container runtime.`);
  }
  return value;
}

function validateDatabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use the postgresql:// or postgres:// scheme.");
  }
}

async function validateDirectory(name, value) {
  if (!path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute container path.`);
  }
  try {
    await verifyExistingWritableDirectory(value);
  } catch {
    throw new Error(`${name} must be an existing directory writable by the runtime user.`);
  }
}

try {
  if (process.env.NODE_ENV !== "production") {
    throw new Error("NODE_ENV=production is required for the container runtime.");
  }

  for (const name of requiredVariables) {
    requiredValue(name);
  }

  const authentication = validateProductionAuthenticationEnvironment(process.env);
  validateDatabaseUrl(requiredValue("DATABASE_URL"));

  const storageDirectory = requiredValue("MOLDPILOT_STORAGE_DIR");
  const quarantineDirectory = requiredValue("MOLDPILOT_QUARANTINE_DIR");
  if (path.resolve(storageDirectory) === path.resolve(quarantineDirectory)) {
    throw new Error("MOLDPILOT_STORAGE_DIR and MOLDPILOT_QUARANTINE_DIR must be separate directories.");
  }

  await validateDirectory("MOLDPILOT_STORAGE_DIR", storageDirectory);
  await validateDirectory("MOLDPILOT_QUARANTINE_DIR", quarantineDirectory);

  if (authentication.warning != null) {
    console.warn(`[MoldPilot container WARNING] ${authentication.warning}`);
  }
  console.log("[MoldPilot container] Production configuration and persistent directories are ready.");
} catch (error) {
  console.error(
    `[MoldPilot container ERROR] ${error instanceof Error ? error.message : "Runtime validation failed."}`
  );
  process.exit(1);
}
