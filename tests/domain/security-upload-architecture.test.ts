import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("secure upload architecture", () => {
  it("authenticates and authorizes before consuming the request body", () => {
    const route = source("src/app/api/uploads/route.ts");
    const post = route.slice(route.indexOf("export async function POST"));
    const actorIndex = post.indexOf("getOptionalCurrentUser");
    const permissionIndex = post.indexOf('hasPermission(actor.id, "attachment.upload")');
    const streamIndex = post.indexOf("streamBodyToQuarantine");

    assert.equal(actorIndex >= 0, true);
    assert.equal(permissionIndex > actorIndex, true);
    assert.equal(streamIndex > permissionIndex, true);
    assert.match(post, /allowPasswordChangeRequired: true/);
    assert.match(post, /actor\.forcePasswordChange/);
  });

  it("streams to quarantine, validates and scans, then releases exactly once", () => {
    const route = source("src/app/api/uploads/route.ts");
    const post = route.slice(route.indexOf("export async function POST"));
    const quarantineIndex = post.indexOf("streamBodyToQuarantine");
    const inspectionIndex = post.indexOf("inspectAndScanQuarantinedAttachment", quarantineIndex);
    const releaseIndex = post.indexOf("releaseQuarantinedAttachment", inspectionIndex);
    const persistIndex = post.indexOf("persistGenericUpload", releaseIndex);

    assert.equal(quarantineIndex >= 0, true);
    assert.equal(inspectionIndex > quarantineIndex, true);
    assert.equal(releaseIndex > inspectionIndex, true);
    assert.equal(persistIndex > releaseIndex, true);
    assert.match(post, /maxBytes/);
    assert.match(post, /assertedContentLength/);
    assert.match(route, /content-length/);
  });

  it("keeps oversized files out of global Server Actions and disables stale upload actions", () => {
    const config = source("next.config.mjs");
    const attachmentAction = source("src/server/attachment-actions.ts");
    const reportAction = source("src/server/qc-report-actions.ts");

    assert.match(config, /bodySizeLimit: "12mb"/);
    assert.doesNotMatch(config, /320mb/);
    assert.match(attachmentAction, /This upload form is outdated/);
    assert.match(reportAction, /This upload form is outdated/);
    assert.doesNotMatch(attachmentAction, /arrayBuffer\(\)/);
    assert.doesNotMatch(reportAction, /arrayBuffer\(\)/);
  });

  it("serves active content with download policy and nosniff headers", () => {
    const downloadRoute = source("src/app/api/attachments/[id]/route.ts");
    assert.match(downloadRoute, /canDownloadAttachment/);
    assert.match(downloadRoute, /Content-Disposition/);
    assert.match(downloadRoute, /X-Content-Type-Options/);
    assert.match(downloadRoute, /private, no-store/);
  });
});
