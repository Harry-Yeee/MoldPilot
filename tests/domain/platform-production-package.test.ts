import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(testDirectory, "../..");
const platformRoot = path.resolve(appRoot, "..");
const opsRoot = path.join(platformRoot, "ops");

function read(relativePath: string): string {
  return readFileSync(path.join(opsRoot, relativePath), "utf8");
}

function readApp(relativePath: string): string {
  return readFileSync(path.join(appRoot, relativePath), "utf8");
}

function serviceBlock(
  composeSource: string,
  service: string,
  nextService: string
): string {
  const start = composeSource.indexOf(`  ${service}:`);
  const end = composeSource.indexOf(`  ${nextService}:`, start + 1);
  assert.notEqual(start, -1, `${service} service is missing`);
  assert.notEqual(end, -1, `${nextService} service boundary is missing`);
  return composeSource.slice(start, end);
}

describe("D2.2 production platform package", () => {
  it("keeps only MoldPilot loopback-published and keeps database and scanner private", () => {
    const compose = read("compose.production.yml");
    const postgres = serviceBlock(
      compose,
      "postgres",
      "moldpilot-clamav-volume-init"
    );
    const freshclam = serviceBlock(
      compose,
      "moldpilot-freshclam",
      "moldpilot-clamav"
    );
    const clamav = serviceBlock(
      compose,
      "moldpilot-clamav",
      "moldpilot-migrate"
    );
    const app = serviceBlock(compose, "moldpilot", "moldpilot-backup-helper");

    assert.match(
      postgres,
      /postgres:16-bookworm@sha256:[a-f0-9]{64}/
    );
    assert.doesNotMatch(postgres, /\n\s+ports:/);
    assert.doesNotMatch(clamav, /\n\s+ports:/);
    assert.doesNotMatch(freshclam, /\n\s+ports:/);
    assert.match(clamav, /aliases:\s*\n\s+- clamav/);
    assert.match(app, /127\.0\.0\.1:\$\{MOLDPILOT_HOST_PORT[^}]*\}:3000/);
    assert.match(app, /restart: unless-stopped/);
    assert.match(app, /init: true/);
    assert.match(app, /stop_grace_period:/);
    assert.doesNotMatch(app, /migrate|seed|reset/);
  });

  it("uses one-shot signature initialization and a capability-free unprivileged FreshClam runtime", () => {
    const compose = read("compose.production.yml");
    const volumeInit = serviceBlock(
      compose,
      "moldpilot-clamav-volume-init",
      "moldpilot-clamav-signature-seed"
    );
    const signatureSeed = serviceBlock(
      compose,
      "moldpilot-clamav-signature-seed",
      "moldpilot-freshclam"
    );
    const freshclam = serviceBlock(
      compose,
      "moldpilot-freshclam",
      "moldpilot-clamav"
    );
    const clamav = serviceBlock(
      compose,
      "moldpilot-clamav",
      "moldpilot-migrate"
    );
    const dockerfile = readApp("docker/clamav/Dockerfile");
    const volumeInitScript = readApp(
      "docker/clamav/signature-volume-init.sh"
    );
    const signatureSeedScript = readApp("docker/clamav/signature-seed.sh");

    assert.match(volumeInit, /restart: "no"/);
    assert.match(volumeInit, /user: "0:0"/);
    assert.match(volumeInit, /network_mode: none/);
    assert.match(volumeInit, /read_only: true/);
    assert.match(volumeInit, /cap_drop:\s*\n\s+- ALL/);
    assert.match(volumeInit, /cap_add:\s*\n\s+- CHOWN/);
    assert.doesNotMatch(volumeInit, /SETUID|SETGID|SYS_ADMIN/);

    assert.match(signatureSeed, /user: "1000:1000"/);
    assert.match(signatureSeed, /network_mode: none/);
    assert.match(signatureSeed, /condition: service_completed_successfully/);
    assert.match(signatureSeed, /cap_drop:\s*\n\s+- ALL/);
    assert.doesNotMatch(signatureSeed, /cap_add:/);

    assert.match(freshclam, /user: "1000:1000"/);
    assert.match(freshclam, /exec freshclam/);
    assert.match(freshclam, /--log=\/tmp\/freshclam\.log/);
    assert.match(
      freshclam,
      /tmpfs:\s*\n\s+- \/tmp:[^\n]*size=64m[^\n]*mode=1777/
    );
    assert.match(freshclam, /condition: service_completed_successfully/);
    assert.match(freshclam, /cap_drop:\s*\n\s+- ALL/);
    assert.match(freshclam, /read_only: true/);
    assert.doesNotMatch(freshclam, /user: "0:0"/);
    assert.doesNotMatch(freshclam, /cap_add:|setpriv|SETUID|SETGID|SYS_ADMIN/);

    assert.match(clamav, /user: "1000:1000"/);
    assert.match(clamav, /read_only: true/);
    assert.match(clamav, /read_only: true\s*\n\s+volume:/);
    assert.doesNotMatch(clamav, /\n\s+ports:/);

    assert.match(dockerfile, /moldpilot-signature-volume-init/);
    assert.match(dockerfile, /moldpilot-signature-seed/);
    assert.doesNotMatch(dockerfile, /freshclam-entrypoint|setpriv/);
    assert.match(volumeInitScript, /chown 1000:1000 "\$SIGNATURE_DIR"/);
    assert.match(signatureSeedScript, /"\$\(id -u\):\$\(id -g\)" = "1000:1000"/);
    assert.doesNotMatch(
      `${volumeInitScript}\n${signatureSeedScript}`,
      /setpriv|SETUID|SETGID|SYS_ADMIN/
    );
  });

  it("uses explicit migration and parameterized persistent resources", () => {
    const compose = read("compose.production.yml");
    const migrator = serviceBlock(
      compose,
      "moldpilot-migrate",
      "moldpilot"
    );

    assert.match(migrator, /profiles:\s*\n\s+- tools/);
    assert.match(migrator, /migrate\s*\n\s+- deploy/);
    for (const variable of [
      "MOLDPILOT_DB_VOLUME",
      "MOLDPILOT_UPLOADS_VOLUME",
      "MOLDPILOT_QUARANTINE_VOLUME",
      "MOLDPILOT_SIGNATURES_VOLUME",
      "MOLDPILOT_DATABASE_NETWORK",
      "MOLDPILOT_SCANNER_NETWORK"
    ]) {
      assert.match(compose, new RegExp(`name: \\\${${variable}`));
    }
    assert.match(
      read("docker/postgres/init-moldpilot.sh"),
      /NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION/
    );
  });

  it("keeps control and deploy operations app-scoped and migration-aware", () => {
    const control = read("scripts/app-control.sh");
    const deploy = read("scripts/moldpilot-deploy.sh");
    const productionScripts = [
      control,
      deploy,
      read("scripts/moldpilot-backup.sh"),
      read("scripts/platform-preflight.sh")
    ].join("\n");

    assert.match(control, /status\|logs\|start\|stop\|restart/);
    assert.match(control, /--no-deps/);
    assert.match(control, /postgres.*container.*unchanged|postgres_id/i);
    assert.match(control, /clamav.*container.*unchanged|clamav_id/i);
    assert.doesNotMatch(productionScripts, /docker\s+compose[^\n]*\sdown\b/);

    assert.match(deploy, /git status --porcelain/);
    assert.match(deploy, /git[^\n]*rev-parse/);
    assert.match(deploy, /moldpilot-backup\.sh/);
    assert.match(deploy, /moldpilot-migrate/);
    assert.match(deploy, /migrate deploy/);
    assert.match(deploy, /--no-deps/);
    assert.match(deploy, /rollback/);
    assert.match(deploy, /does not reverse|cannot reverse/i);
  });

  it("uses a helper container for encrypted backup and isolated scratch restore", () => {
    const compose = read("compose.production.yml");
    const helperDockerfile = read("docker/backup/Dockerfile");
    const helper = read("docker/backup/backup-helper.sh");
    const backup = read("scripts/moldpilot-backup.sh");
    const restore = read("scripts/moldpilot-restore-scratch.sh");

    assert.match(compose, /moldpilot-backup-helper:/);
    assert.match(helperDockerfile, /apt-get install[^]*\bage\b/);
    assert.match(helper, /pg_dump/);
    assert.match(helper, /age --recipient/);
    assert.match(helper, /manifest\.sha256/);
    assert.match(helper, /pg_restore/);
    assert.match(helper, /sha256sum --check/);
    assert.match(backup, /\/Volumes\//);
    assert.match(restore, /SCRATCH|scratch/);
    assert.match(restore, /production volume|PRODUCTION_VOLUME/i);
    assert.match(restore, /moldpilot-backup-helper/);
    assert.doesNotMatch(backup, /\b(age|pg_dump|node|python3?)\s/);
  });

  it("renders a native Caddy recovery route without activating Caddy", () => {
    const caddy = read("caddy/Caddyfile.moldpilot.template");
    const preflight = read("scripts/platform-preflight.sh");

    assert.match(caddy, /remote_ip __MOLDPILOT_TRUSTED_CIDR__/);
    assert.match(caddy, /max_size 315MB/);
    assert.match(caddy, /reverse_proxy 127\.0\.0\.1:__MOLDPILOT_HOST_PORT__/);
    assert.match(caddy, /X-Forwarded-For/);
    assert.match(caddy, /X-Forwarded-Proto https/);
    assert.match(caddy, /handle_errors/);
    assert.match(caddy, /503/);
    assert.match(caddy, /tls internal/);
    assert.match(preflight, /render-caddy/);
    assert.match(preflight, /COMPOSE_PROJECT_NAME must use lowercase/);
    assert.match(
      preflight,
      /s\|__MOLDPILOT_TRUSTED_CIDR__\|\$MOLDPILOT_TRUSTED_CIDR\|g/
    );
    assert.doesNotMatch(preflight, /caddy\s+(?:start|reload|run)/);
  });

  it("documents placeholders only and rehearses every production boundary", () => {
    const environment = read("config/production.env.example");
    const smoke = read("scripts/moldpilot-production-smoke.sh");

    assert.match(environment, /MOLDPILOT_SESSION_SECRET=REPLACE_/);
    assert.match(environment, /POSTGRES_SUPERUSER_PASSWORD=REPLACE_/);
    assert.match(environment, /MOLDPILOT_DB_PASSWORD=REPLACE_/);
    assert.match(environment, /MOLDPILOT_BACKUP_AGE_RECIPIENT=age1REPLACE_/);
    assert.doesNotMatch(environment, /(?:admin|password|moldpilot)=123456/i);

    for (const evidence of [
      "MP-D22-REHEARSAL-001",
      "status --porcelain --untracked-files=all",
      "RELEASE_CONTEXT/docker/clamav",
      "moldpilot-clamav-volume-init",
      "moldpilot-clamav-signature-seed",
      "1000:1000",
      "EICAR",
      "scanner outage",
      "app restart",
      "encrypted backup",
      "scratch restore",
      "127.0.0.1",
      "cleanup"
    ]) {
      assert.match(smoke, new RegExp(evidence, "i"));
    }
    assert.doesNotMatch(smoke, /launchctl|brew services|caddy reload/);
  });
});
