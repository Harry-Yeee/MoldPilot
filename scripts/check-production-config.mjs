#!/usr/bin/env node

import process from "node:process";
import { validateProductionAuthenticationEnvironment } from "../src/domain/security/session-cookie.ts";

try {
  const configuration = validateProductionAuthenticationEnvironment(process.env);
  console.log(
    `[MoldPilot production config] ${configuration.baseUrl}; session cookie Secure=${configuration.cookieSecure}.`
  );

  if (configuration.warning != null) {
    console.warn("\n============================================================");
    console.warn(`[MoldPilot HTTP WARNING] ${configuration.warning}`);
    console.warn("============================================================\n");
  }
} catch (error) {
  console.error(
    `[MoldPilot production config ERROR] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
}
