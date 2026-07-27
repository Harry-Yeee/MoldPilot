import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("production network containment", () => {
  it("binds HTTPS behind the proxy to loopback and direct HTTP to its configured LAN host", () => {
    const runner = source("scripts/run-production-macos.sh");
    assert.match(runner, /LISTEN_HOST="127\.0\.0\.1"/);
    assert.match(runner, /new URL\(process\.env\.MOLDPILOT_BASE_URL\)\.hostname/);
    assert.match(runner, /--hostname "\$LISTEN_HOST"/);
    assert.doesNotMatch(runner, /--hostname 0\.0\.0\.0/);
  });

  it("provides a host-pinned TLS proxy with a trusted-network gate", () => {
    const caddy = source("scripts/Caddyfile.moldpilot.template");
    assert.match(caddy, /^https:\/\/__MOLDPILOT_HOST__ \{/m);
    assert.match(caddy, /not remote_ip __MOLDPILOT_TRUSTED_CIDR__/);
    assert.match(caddy, /reverse_proxy 127\.0\.0\.1:3000/);
    assert.match(caddy, /header_up X-Forwarded-For \{remote_host\}/);
    assert.match(caddy, /tls internal/);
    assert.doesNotMatch(caddy, /Strict-Transport-Security/i);
  });

  it("sets baseline browser hardening headers without prematurely enabling HSTS", () => {
    const config = source("next.config.mjs");
    assert.match(config, /X-Content-Type-Options/);
    assert.match(config, /X-Frame-Options/);
    assert.match(config, /Content-Security-Policy/);
    assert.match(config, /poweredByHeader: false/);
    assert.doesNotMatch(config, /Strict-Transport-Security/);
  });

  it("does not pipe a mutable remote Homebrew installer into a shell", () => {
    const bootstrap = source("scripts/server-bootstrap-macos.sh");
    const firstDeploy = source("scripts/server-first-deploy-macos.sh");
    for (const script of [bootstrap, firstDeploy]) {
      assert.doesNotMatch(script, /curl[\s\S]{0,120}\|\s*(?:bash|sh)/);
      assert.doesNotMatch(script, /\/bin\/bash -c "\$\(curl/);
    }
    assert.match(bootstrap, /Homebrew is required but was not found/);
    assert.match(firstDeploy, /Install a reviewed official Homebrew \.pkg/);
  });

  it("requires a healthy local scanner before the production process starts", () => {
    const runner = source("scripts/run-production-macos.sh");
    const scannerCheck = source("scripts/check-malware-scanner.sh");
    const scanner = source("src/server/local-malware-scanner.ts");
    const backend = source("src/server/malware-scanner.ts");
    assert.match(runner, /check-malware-scanner\.sh/);
    assert.match(scannerCheck, /--no-summary/);
    assert.match(scannerCheck, /Upload release remains fail-closed/);
    assert.match(scanner, /path\.isAbsolute\(configured\)/);
    assert.match(scanner, /spawn\("\/usr\/bin\/test", \["-x", pathname\]/);
    assert.match(scanner, /spawn\("\/usr\/bin\/env", \[scanner, "--no-summary", filePath\]/);
    assert.doesNotMatch(scanner, /spawn\(scanner,/);
    assert.match(backend, /resolveScannerMode\(\) === "local"/);
    assert.match(backend, /scanFileWithConfiguredLocalCommand/);
    assert.match(backend, /scanFileWithClamd/);
  });

  it("keeps the legacy XLS out of the active seed path and requires Office-aware quarantine analysis", () => {
    const seed = source("prisma/seed.ts");
    const quarantine = source("scripts/quarantine-legacy-workbook.sh");
    assert.match(seed, /loadReviewedInjectionMachines\(\)/);
    assert.doesNotMatch(seed, /const machineDefinitions = loadWorkbookInjectionMachines\(\)/);
    assert.match(quarantine, /\[ "\$MODE" = "--move" \]/);
    assert.match(quarantine, /command -v olevba/);
    assert.match(quarantine, /disposition=QUARANTINED_PENDING_SECURITY_REVIEW/);
    assert.doesNotMatch(quarantine, /malware-free=true/);
  });
});
