import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
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

function readPlatform(relativePath: string): string {
  return readFileSync(path.join(platformRoot, relativePath), "utf8");
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function runBash(
  script: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {}
) {
  return spawnSync("bash", ["-c", script, "moldpilot-test", ...args], {
    cwd: options.cwd ?? platformRoot,
    encoding: "utf8",
    env: options.env ?? process.env
  });
}

interface ReleaseFixture {
  appRoot: string;
  appSha: string;
  previousAppSha: string;
  platformRoot: string;
  platformSha: string;
  root: string;
}

function createReleaseFixture(): ReleaseFixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "moldpilot-release-guard-"));
  const fixturePlatformRoot = path.join(root, "platform");
  const fixtureScripts = path.join(fixturePlatformRoot, "ops", "scripts");
  const fixtureAppRoot = path.join(fixturePlatformRoot, "MoldPilot");

  mkdirSync(fixtureScripts, { recursive: true });
  copyFileSync(
    path.join(opsRoot, "scripts", "lib.sh"),
    path.join(fixtureScripts, "lib.sh")
  );
  copyFileSync(
    path.join(opsRoot, "scripts", "moldpilot-backup.sh"),
    path.join(fixtureScripts, "moldpilot-backup.sh")
  );
  copyFileSync(
    path.join(opsRoot, "scripts", "app-control.sh"),
    path.join(fixtureScripts, "app-control.sh")
  );
  copyFileSync(
    path.join(opsRoot, "scripts", "moldpilot-deploy.sh"),
    path.join(fixtureScripts, "moldpilot-deploy.sh")
  );
  writeFileSync(path.join(fixturePlatformRoot, ".gitignore"), "/MoldPilot/\n");
  writeFileSync(path.join(fixturePlatformRoot, "platform.txt"), "platform\n");
  runGit(fixturePlatformRoot, ["init", "-b", "main"]);
  runGit(fixturePlatformRoot, ["config", "user.email", "test@example.invalid"]);
  runGit(fixturePlatformRoot, ["config", "user.name", "MoldPilot Test"]);
  runGit(fixturePlatformRoot, ["add", "."]);
  runGit(fixturePlatformRoot, ["commit", "-m", "platform fixture"]);
  const platformSha = runGit(fixturePlatformRoot, ["rev-parse", "HEAD"]);

  mkdirSync(fixtureAppRoot, { recursive: true });
  runGit(fixtureAppRoot, ["init", "-b", "main"]);
  runGit(fixtureAppRoot, ["config", "user.email", "test@example.invalid"]);
  runGit(fixtureAppRoot, ["config", "user.name", "MoldPilot Test"]);
  writeFileSync(path.join(fixtureAppRoot, "app.txt"), "previous\n");
  runGit(fixtureAppRoot, ["add", "."]);
  runGit(fixtureAppRoot, ["commit", "-m", "previous app"]);
  const previousAppSha = runGit(fixtureAppRoot, ["rev-parse", "HEAD"]);
  writeFileSync(path.join(fixtureAppRoot, "app.txt"), "current\n");
  runGit(fixtureAppRoot, ["add", "."]);
  runGit(fixtureAppRoot, ["commit", "-m", "current app"]);
  const appSha = runGit(fixtureAppRoot, ["rev-parse", "HEAD"]);

  return {
    appRoot: fixtureAppRoot,
    appSha,
    previousAppSha,
    platformRoot: fixturePlatformRoot,
    platformSha,
    root
  };
}

function releaseEnvironment(
  fixture: ReleaseFixture,
  currentSha: string = fixture.appSha
): string {
  const configRoot = path.join(fixture.root, "config");
  const backupRoot = path.join(fixture.root, "backups");
  mkdirSync(configRoot, { recursive: true });
  mkdirSync(backupRoot, { recursive: true });
  const envPath = path.join(configRoot, "moldpilot.env");
  const caddyPath = path.join(configRoot, "Caddyfile.moldpilot");
  const project = "moldpilot-lifecycle-test";
  const content = [
    `COMPOSE_PROJECT_NAME=${project}`,
    "MOLDPILOT_ENVIRONMENT=rehearsal",
    "MOLDPILOT_DEPLOY_REHEARSAL=1",
    "MOLDPILOT_ALLOW_LOCAL_BACKUP=1",
    `MOLDPILOT_ENV_FILE=${envPath}`,
    `MOLDPILOT_APP_ROOT=${fixture.appRoot}`,
    `MOLDPILOT_APP_IMAGE=test-app:${currentSha}`,
    `MOLDPILOT_MIGRATOR_IMAGE=test-migrator:${currentSha}`,
    `MOLDPILOT_PREVIOUS_APP_IMAGE=test-app:${fixture.previousAppSha}`,
    `MOLDPILOT_PREVIOUS_MIGRATOR_IMAGE=test-migrator:${fixture.previousAppSha}`,
    `LJ_ERP_PLATFORM_RELEASE_SHA=${fixture.platformSha}`,
    `MOLDPILOT_RELEASE_SHA=${currentSha}`,
    `MOLDPILOT_PREVIOUS_RELEASE_SHA=${fixture.previousAppSha}`,
    "MOLDPILOT_CLAMAV_IMAGE=test-clamav:1",
    "MOLDPILOT_BACKUP_HELPER_IMAGE=test-backup:1",
    `MOLDPILOT_DB_VOLUME=${project}_db`,
    `MOLDPILOT_UPLOADS_VOLUME=${project}_uploads`,
    `MOLDPILOT_QUARANTINE_VOLUME=${project}_quarantine`,
    `MOLDPILOT_SIGNATURES_VOLUME=${project}_signatures`,
    `MOLDPILOT_BACKUP_WORK_VOLUME=${project}_backup_work`,
    `MOLDPILOT_EDGE_NETWORK=${project}_edge`,
    `MOLDPILOT_DATABASE_NETWORK=${project}_database`,
    `MOLDPILOT_SCANNER_NETWORK=${project}_scanner`,
    `MOLDPILOT_SIGNATURE_NETWORK=${project}_signature`,
    `MOLDPILOT_BACKUP_DIR=${backupRoot}`,
    "MOLDPILOT_BACKUP_AGE_RECIPIENT=age1test",
    `MOLDPILOT_CADDY_CONFIG_PATH=${caddyPath}`,
    ""
  ].join("\n");
  writeFileSync(envPath, content, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  return envPath;
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
    assert.match(app, /networks:\s*\n\s+- edge\s*\n\s+- database\s*\n\s+- scanner/);
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
      "MOLDPILOT_EDGE_NETWORK",
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

    assert.match(deploy, /verify_mutating_release_context/);
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
    const shared = read("scripts/lib.sh");
    const backup = read("scripts/moldpilot-backup.sh");
    const restore = read("scripts/moldpilot-restore-scratch.sh");
    const backupHelper = serviceBlock(
      compose,
      "moldpilot-backup-helper",
      "networks"
    );

    assert.match(compose, /moldpilot-backup-helper:/);
    assert.match(
      backupHelper,
      /DATABASE_URL: postgresql:[^\n]+\/\$\{MOLDPILOT_DB_NAME\}\n/
    );
    assert.doesNotMatch(backupHelper, /DATABASE_URL:[^\n]+\?schema=/);
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
    assert.match(restore, /ORDER BY uploaded_at/);
    assert.doesNotMatch(restore, /ORDER BY created_at/);
    assert.match(restore, /--set expected_project=/);
    assert.match(shared, /--form-string "username=\$username"/);
    assert.match(shared, /--form-string "password=\$password"/);
    assert.match(shared, /moldpilot_session/);
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
      "require_clean_git_checkout",
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

  it("binds production operations to clean platform and app release identities", () => {
    const environment = read("config/production.env.example");
    const compose = read("compose.production.yml");
    const shared = read("scripts/lib.sh");
    const preflight = read("scripts/platform-preflight.sh");
    const helper = read("docker/backup/backup-helper.sh");
    const backup = read("scripts/moldpilot-backup.sh");
    const restore = read("scripts/moldpilot-restore-scratch.sh");

    assert.match(environment, /LJ_ERP_PLATFORM_RELEASE_SHA=REPLACE_/);
    assert.match(environment, /MOLDPILOT_RELEASE_SHA=REPLACE_/);
    assert.match(environment, /MOLDPILOT_PREVIOUS_RELEASE_SHA=REPLACE_/);
    assert.match(compose, /LJ_ERP_PLATFORM_RELEASE_SHA:/);
    assert.match(compose, /MOLDPILOT_RELEASE_SHA:/);
    assert.match(compose, /MOLDPILOT_PREVIOUS_RELEASE_SHA:/);
    assert.match(shared, /require_clean_git_checkout "LJ_ERP platform"/);
    assert.match(shared, /require_clean_git_checkout "MoldPilot"/);
    assert.match(shared, /Configured platform release SHA/);
    assert.match(shared, /Configured MoldPilot release SHA/);
    assert.match(shared, /require_image_tag_for_release/);
    assert.match(preflight, /verify_release_identity deployment-transition/);
    assert.match(shared, /MOLDPILOT_DEPLOY_TARGET_SHA/);
    assert.match(helper, /format=moldpilot-container-backup-v3/);
    assert.match(helper, /platformReleaseSha=/);
    assert.match(helper, /moldPilotReleaseSha=/);
    assert.match(backup, /platformReleaseSha=/);
    assert.match(backup, /moldPilotReleaseSha=/);
    assert.match(restore, /SCRATCH_PLATFORM_RELEASE_SHA=/);
    assert.match(restore, /SCRATCH_MOLDPILOT_RELEASE_SHA=/);
  });

  it("packages only the parent platform repository for distribution", () => {
    const ignore = readPlatform(".gitignore");
    const distribution = read("scripts/platform-distribution-smoke.sh");

    for (const appDirectory of [
      "MoldPilot",
      "SupplyDesk",
      "Warehouse",
      "ClientView"
    ]) {
      assert.match(ignore, new RegExp(`^/${appDirectory}/$`, "m"));
    }
    assert.match(ignore, /^\.env$/m);
    assert.match(ignore, /\.age/);
    assert.match(ignore, /backups/);
    assert.match(distribution, /git[^\n]*bundle create/);
    assert.match(distribution, /git[^\n]*archive/);
    assert.match(distribution, /160000/);
    assert.match(distribution, /MoldPilot SupplyDesk Warehouse ClientView/);
    assert.match(distribution, /platform-preflight\.sh/);
    assert.doesNotMatch(distribution, /git\s+remote|git\s+push/);
  });

  it("rehearses the guarded real deploy and image rollback without dependency replacement", () => {
    const deploy = read("scripts/moldpilot-deploy.sh");
    const lifecycle = read("scripts/moldpilot-release-lifecycle-smoke.sh");
    const combined = `${deploy}\n${lifecycle}`;

    assert.match(deploy, /MOLDPILOT_DEPLOY_REHEARSAL/);
    assert.match(deploy, /moldpilot-lifecycle-\*/);
    assert.match(deploy, /export_git_commit/);
    assert.match(deploy, /PLATFORM_RELEASE_CONTEXT\/ops\/docker\/backup/);
    assert.match(lifecycle, /app-control\.sh" stop moldpilot/);
    assert.match(lifecycle, /app-control\.sh" start moldpilot/);
    assert.match(lifecycle, /moldpilot-deploy\.sh" deploy HEAD/);
    assert.match(lifecycle, /moldpilot-deploy\.sh" rollback/);
    assert.match(lifecycle, /mandatory encrypted pre-deploy backup/i);
    assert.match(lifecycle, /MIGRATIONS_AFTER_ROLLBACK/);
    assert.match(lifecycle, /PREVIOUS_APP_IMAGE.*TARGET_APP_IMAGE.*PREVIOUS_APP_IMAGE/s);
    assert.match(lifecycle, /POSTGRES_ID/);
    assert.match(lifecycle, /CLAMAV_ID/);
    assert.match(lifecycle, /FRESHCLAM_ID/);
    assert.match(lifecycle, /DOWNLOAD_SHA_AFTER_ROLLBACK/);
    assert.doesNotMatch(combined, /docker\s+compose[^\n]*\sdown\b/);
    assert.doesNotMatch(combined, /launchctl|caddy\s+reload|brew services/);
  });

  it("rejects every protected path under either checkout, including symlink aliases", () => {
    const temporaryRoot = mkdtempSync(
      path.join(os.tmpdir(), "moldpilot-path-boundary-")
    );
    const alias = path.join(temporaryRoot, "checkout-alias");
    const lib = path.join(opsRoot, "scripts", "lib.sh");
    const script = [
      'source "$1"',
      'export MOLDPILOT_APP_ROOT="$2"',
      'require_path_outside_git_checkouts "$3" "$4"'
    ].join("\n");

    try {
      symlinkSync(platformRoot, alias, "dir");
      const rejectedPaths = [
        ["MOLDPILOT_PRODUCTION_ENV", path.join(platformRoot, ".env")],
        [
          "MOLDPILOT_ENV_FILE",
          path.join(appRoot, "production.env")
        ],
        [
          "MOLDPILOT_CADDY_CONFIG_PATH",
          path.join(platformRoot, "docs", "Caddyfile")
        ],
        ["MOLDPILOT_BACKUP_DIR", path.join(appRoot, "docs")],
        [
          "Scratch restore archive",
          path.join(platformRoot, "docs", "backup.tar.age")
        ],
        [
          "Scratch restore identity",
          path.join(appRoot, "docs", "identity.txt")
        ],
        [
          "Symlinked future output",
          path.join(alias, "docs", "future-output.env")
        ]
      ];

      for (const [label, rejectedPath] of rejectedPaths) {
        const result = runBash(script, [lib, appRoot, label, rejectedPath]);
        assert.notEqual(
          result.status,
          0,
          `${label} unexpectedly accepted ${rejectedPath}`
        );
        assert.match(result.stderr, /outside the LJ_ERP platform and MoldPilot/);
      }

      const allowedFuturePath = path.join(temporaryRoot, "future.env");
      const allowed = runBash(script, [
        lib,
        appRoot,
        "External future output",
        allowedFuturePath
      ]);
      assert.equal(allowed.status, 0, allowed.stderr);
      assert.equal(
        allowed.stdout.trim(),
        path.join(realpathSync(temporaryRoot), "future.env")
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("supports normal and deployment-transition identity modes with exact SHA tags", () => {
    const fixture = createReleaseFixture();
    const lib = path.join(fixture.platformRoot, "ops", "scripts", "lib.sh");
    const script = [
      'source "$1"',
      'export MOLDPILOT_APP_ROOT="$2"',
      'export LJ_ERP_PLATFORM_RELEASE_SHA="$3"',
      'export MOLDPILOT_RELEASE_SHA="$4"',
      'export MOLDPILOT_PREVIOUS_RELEASE_SHA="$5"',
      'export MOLDPILOT_APP_IMAGE="fixture-app:$4"',
      'export MOLDPILOT_MIGRATOR_IMAGE="fixture-migrator:$4"',
      'export MOLDPILOT_PREVIOUS_APP_IMAGE="fixture-app:$5"',
      'export MOLDPILOT_PREVIOUS_MIGRATOR_IMAGE="fixture-migrator:$5"',
      'export MOLDPILOT_DEPLOY_TARGET_SHA="$6"',
      'verify_release_identity "$7"'
    ].join("\n");

    try {
      const normal = runBash(script, [
        lib,
        fixture.appRoot,
        fixture.platformSha,
        fixture.appSha,
        fixture.previousAppSha,
        fixture.appSha,
        "normal"
      ]);
      assert.equal(normal.status, 0, normal.stderr);

      const transition = runBash(script, [
        lib,
        fixture.appRoot,
        fixture.platformSha,
        fixture.previousAppSha,
        fixture.previousAppSha,
        fixture.appSha,
        "deployment-transition"
      ]);
      assert.equal(transition.status, 0, transition.stderr);

      const staleNormal = runBash(script, [
        lib,
        fixture.appRoot,
        fixture.platformSha,
        fixture.previousAppSha,
        fixture.previousAppSha,
        fixture.appSha,
        "normal"
      ]);
      assert.notEqual(staleNormal.status, 0);
      assert.match(staleNormal.stderr, /does not match the clean MoldPilot checkout/);

      const invalidImage = runBash(
        [
          'source "$1"',
          'export MOLDPILOT_APP_ROOT="$2"',
          'export LJ_ERP_PLATFORM_RELEASE_SHA="$3"',
          'export MOLDPILOT_RELEASE_SHA="$4"',
          'export MOLDPILOT_PREVIOUS_RELEASE_SHA="$5"',
          'export MOLDPILOT_APP_IMAGE="fixture-app:$4-extra"',
          'export MOLDPILOT_MIGRATOR_IMAGE="fixture-migrator:$4"',
          'export MOLDPILOT_PREVIOUS_APP_IMAGE="fixture-app:$5"',
          'export MOLDPILOT_PREVIOUS_MIGRATOR_IMAGE="fixture-migrator:$5"',
          "verify_release_identity normal"
        ].join("\n"),
        [
          lib,
          fixture.appRoot,
          fixture.platformSha,
          fixture.appSha,
          fixture.previousAppSha
        ]
      );
      assert.notEqual(invalidImage.status, 0);
      assert.match(invalidImage.stderr, /exact release SHA as its image tag/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("updates all release keys atomically and preserves bytes on simulated failure", () => {
    const temporaryRoot = mkdtempSync(
      path.join(os.tmpdir(), "moldpilot-atomic-env-")
    );
    const environmentFile = path.join(temporaryRoot, "production.env");
    const lib = path.join(opsRoot, "scripts", "lib.sh");
    const original = [
      "MOLDPILOT_APP_IMAGE=app:old",
      "MOLDPILOT_MIGRATOR_IMAGE=migrator:old",
      "MOLDPILOT_RELEASE_SHA=old",
      "UNCHANGED=value",
      ""
    ].join("\n");
    writeFileSync(environmentFile, original, { mode: 0o600 });

    const updateScript = [
      "set -u",
      'source "$1"',
      'atomic_update_environment_file "$2" \\',
      "  MOLDPILOT_APP_IMAGE app:new \\",
      "  MOLDPILOT_MIGRATOR_IMAGE migrator:new \\",
      "  MOLDPILOT_RELEASE_SHA new \\",
      "  MOLDPILOT_PREVIOUS_APP_IMAGE app:old \\",
      "  MOLDPILOT_PREVIOUS_MIGRATOR_IMAGE migrator:old \\",
      "  MOLDPILOT_PREVIOUS_RELEASE_SHA old"
    ].join("\n");

    try {
      const updated = runBash(updateScript, [lib, environmentFile]);
      assert.equal(updated.status, 0, updated.stderr);
      const afterSuccess = readFileSync(environmentFile, "utf8");
      for (const expected of [
        "MOLDPILOT_APP_IMAGE=app:new",
        "MOLDPILOT_MIGRATOR_IMAGE=migrator:new",
        "MOLDPILOT_RELEASE_SHA=new",
        "MOLDPILOT_PREVIOUS_APP_IMAGE=app:old",
        "MOLDPILOT_PREVIOUS_MIGRATOR_IMAGE=migrator:old",
        "MOLDPILOT_PREVIOUS_RELEASE_SHA=old",
        "UNCHANGED=value"
      ]) {
        assert.match(afterSuccess, new RegExp(`^${expected}$`, "m"));
      }
      assert.equal(statSync(environmentFile).mode & 0o777, 0o600);

      const beforeFailure = readFileSync(environmentFile);
      const failed = runBash(updateScript, [lib, environmentFile], {
        env: {
          ...process.env,
          MOLDPILOT_TEST_FAIL_ATOMIC_ENV_UPDATE: "1"
        }
      });
      assert.notEqual(failed.status, 0);
      assert.deepEqual(readFileSync(environmentFile), beforeFailure);
      assert.deepEqual(
        readdirSync(temporaryRoot).filter((name) =>
          name.startsWith(".moldpilot-env-update.")
        ),
        []
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("keeps status and logs available when source identity needs repair", () => {
    const fixture = createReleaseFixture();
    const fakeBin = path.join(fixture.root, "bin");
    const dockerLog = path.join(fixture.root, "docker.log");
    const fakeDocker = path.join(fakeBin, "docker");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      fakeDocker,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MOLDPILOT_FAKE_DOCKER_LOG"\nexit 0\n',
      { mode: 0o755 }
    );

    try {
      const staleEnvironment = releaseEnvironment(
        fixture,
        fixture.previousAppSha
      );
      writeFileSync(path.join(fixture.appRoot, "dirty.txt"), "dirty\n");
      const commandEnvironment = {
        ...process.env,
        MOLDPILOT_FAKE_DOCKER_LOG: dockerLog,
        MOLDPILOT_PRODUCTION_ENV: staleEnvironment,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`
      };
      for (const action of ["status", "logs"]) {
        const result = spawnSync(
          "bash",
          [
            path.join(
              fixture.platformRoot,
              "ops",
              "scripts",
              "app-control.sh"
            ),
            action,
            "moldpilot"
          ],
          { encoding: "utf8", env: commandEnvironment }
        );
        assert.equal(result.status, 0, result.stderr);
      }
      const dockerCalls = readFileSync(dockerLog, "utf8");
      assert.match(dockerCalls, /\bps\b/);
      assert.match(dockerCalls, /\blogs\b/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects stale backup and dirty rollback before any Docker command", () => {
    const fixture = createReleaseFixture();
    const fakeBin = path.join(fixture.root, "bin");
    const dockerLog = path.join(fixture.root, "docker.log");
    const fakeDocker = path.join(fakeBin, "docker");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      fakeDocker,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MOLDPILOT_FAKE_DOCKER_LOG"\nexit 0\n',
      { mode: 0o755 }
    );

    try {
      const staleEnvironment = releaseEnvironment(
        fixture,
        fixture.previousAppSha
      );
      const commandEnvironment = {
        ...process.env,
        MOLDPILOT_FAKE_DOCKER_LOG: dockerLog,
        MOLDPILOT_PRODUCTION_ENV: staleEnvironment,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`
      };
      const staleBackup = spawnSync(
        "bash",
        [
          path.join(
            fixture.platformRoot,
            "ops",
            "scripts",
            "moldpilot-backup.sh"
          )
        ],
        { encoding: "utf8", env: commandEnvironment }
      );
      assert.notEqual(staleBackup.status, 0);
      assert.match(
        staleBackup.stderr,
        /does not match the clean MoldPilot checkout/
      );
      assert.equal(
        readdirSync(fixture.root).includes("docker.log"),
        false,
        "stale backup reached Docker before release validation"
      );

      const currentEnvironment = releaseEnvironment(fixture);
      writeFileSync(path.join(fixture.appRoot, "dirty.txt"), "dirty\n");
      const dirtyRollback = spawnSync(
        "bash",
        [
          path.join(
            fixture.platformRoot,
            "ops",
            "scripts",
            "moldpilot-deploy.sh"
          ),
          "rollback"
        ],
        {
          encoding: "utf8",
          env: {
            ...commandEnvironment,
            MOLDPILOT_PRODUCTION_ENV: currentEnvironment
          }
        }
      );
      assert.notEqual(dirtyRollback.status, 0);
      assert.match(dirtyRollback.stderr, /MoldPilot worktree must be clean/);
      assert.equal(
        readdirSync(fixture.root).includes("docker.log"),
        false,
        "dirty rollback reached backup or container replacement"
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("guards every mutating entry point and swaps release metadata in one update", () => {
    const shared = read("scripts/lib.sh");
    const control = read("scripts/app-control.sh");
    const backup = read("scripts/moldpilot-backup.sh");
    const deploy = read("scripts/moldpilot-deploy.sh");
    const restore = read("scripts/moldpilot-restore-scratch.sh");
    const lifecycle = read("scripts/moldpilot-release-lifecycle-smoke.sh");

    assert.match(shared, /canonical_path_for_boundary/);
    assert.match(shared, /verify_release_identity/);
    assert.match(shared, /atomic_update_environment_file/);
    assert.match(control, /start\|stop\|restart\)[^]*verify_mutating_release_context normal/);
    assert.match(backup, /verify_mutating_release_context normal/);
    assert.match(backup, /verify_mutating_release_context deployment-transition/);
    assert.match(deploy, /verify_mutating_release_context deployment-transition/);
    assert.match(deploy, /verify_mutating_release_context normal/);
    assert.match(restore, /verify_mutating_release_context normal/);

    for (const source of [control, backup, deploy, restore]) {
      assert.match(source, /require_path_outside_git_checkouts/);
    }
    assert.match(restore, /Scratch restore encrypted archive/);
    assert.match(restore, /Scratch restore offline age identity/);

    assert.doesNotMatch(deploy, /update_env_key|##\*:/);
    assert.equal(
      deploy.match(/atomic_update_environment_file/g)?.length,
      2,
      "deploy and rollback should each perform one atomic environment update"
    );
    assert.match(deploy, /MOLDPILOT_PREVIOUS_RELEASE_SHA "\$CURRENT_RELEASE_SHA"/);
    assert.match(deploy, /MOLDPILOT_PREVIOUS_RELEASE_SHA "\$OLD_RELEASE_SHA"/);
    assert.match(lifecycle, /Pre-deploy backup metadata did not record/);
    assert.match(lifecycle, /atomically record the target release SHA/);
    assert.match(lifecycle, /atomically retain the displaced target release SHA/);

    const rollbackVerification = deploy.indexOf(
      "verify_mutating_release_context normal"
    );
    const rollbackBackup = deploy.indexOf(
      'note "Creating an encrypted backup before application rollback."'
    );
    assert.ok(rollbackVerification >= 0 && rollbackVerification < rollbackBackup);

    const backupVerification = backup.indexOf(
      "verify_mutating_release_context normal"
    );
    const backupStop = backup.indexOf(
      'compose stop --timeout 30 moldpilot'
    );
    assert.ok(backupVerification >= 0 && backupVerification < backupStop);

    const restoreVerification = restore.indexOf(
      "verify_mutating_release_context normal"
    );
    const restoreMutation = restore.indexOf(
      'SCRATCH_ROOT="$(mktemp -d'
    );
    assert.ok(restoreVerification >= 0 && restoreVerification < restoreMutation);
  });
});
