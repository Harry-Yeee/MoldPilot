#!/usr/bin/env node

import { createHash, createHmac } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const appOrigin = "http://app:3000";

function required(name) {
  const value = process.env[name]?.trim();
  if (value == null || value.length === 0) {
    throw new Error(`${name} is required by the disposable D2 probe.`);
  }
  return value;
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function createSessionToken() {
  const userId = required("MOLDPILOT_D2_USER_ID");
  const secret = required("MOLDPILOT_SESSION_SECRET");
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ v: "v1", userId, issuedAt })
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function createValidPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length 53 >>\nstream\nBT /F1 12 Tf 72 720 Td (MoldPilot D2 clean PDF) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output, "ascii"));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  output += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}

function createEicarFixture() {
  const fragments = [
    "X5O!P%@AP[4",
    String.raw`\PZX54(P^)7CC)7}$`,
    "EICAR-STANDARD-",
    "ANTIVIRUS-TEST-FILE!$H+H*"
  ];
  return Buffer.from(fragments.join(""), "ascii");
}

function authenticatedHeaders(contentType) {
  const token = required("MOLDPILOT_D2_SESSION_COOKIE");
  return {
    "content-type": contentType,
    cookie: `moldpilot_session=${token}`,
    host: "app:3000",
    origin: appOrigin,
    "x-moldpilot-upload": "1",
    "x-moldpilot-upload-purpose": "attachment",
    "x-moldpilot-project-id": required("MOLDPILOT_D2_PROJECT_ID"),
    "x-moldpilot-entity-type": "MOLD_TRIAL_PROJECT",
    "x-moldpilot-entity-id": required("MOLDPILOT_D2_PROJECT_ID"),
    "x-moldpilot-visibility": "INTERNAL"
  };
}

async function upload(kind) {
  const eicar = kind === "eicar";
  const data = eicar ? createEicarFixture() : createValidPdf();
  const headers = authenticatedHeaders(eicar ? "text/csv" : "application/pdf");
  headers["x-moldpilot-file-type"] = eicar ? "OTHER" : "DRAWING";
  headers["x-moldpilot-file-name"] = encodeURIComponent(
    eicar ? "d2-eicar.csv" : `d2-${kind}.pdf`
  );

  const response = await fetch(`${appOrigin}/api/uploads`, {
    method: "POST",
    headers,
    body: data
  });
  const body = await response.json();
  process.stdout.write(
    JSON.stringify({
      status: response.status,
      body,
      sourceBytes: data.byteLength,
      sourceSha256: sha256(data)
    })
  );
}

async function download(attachmentId) {
  const token = required("MOLDPILOT_D2_SESSION_COOKIE");
  const response = await fetch(
    `${appOrigin}/api/attachments/${encodeURIComponent(attachmentId)}`,
    {
      headers: {
        cookie: `moldpilot_session=${token}`
      },
      cache: "no-store"
    }
  );
  const data = Buffer.from(await response.arrayBuffer());
  process.stdout.write(
    JSON.stringify({
      status: response.status,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
      contentDisposition: response.headers.get("content-disposition"),
      sizeBytes: data.byteLength,
      sha256: sha256(data)
    })
  );
}

async function health() {
  const [live, ready] = await Promise.all([
    fetch(`${appOrigin}/api/health/live`, { cache: "no-store" }),
    fetch(`${appOrigin}/api/health/ready`, { cache: "no-store" })
  ]);
  process.stdout.write(
    JSON.stringify({
      live: { status: live.status, body: await live.json() },
      ready: { status: ready.status, body: await ready.json() }
    })
  );
}

async function pageStatus(pagePath) {
  const response = await fetch(`${appOrigin}${pagePath}`, {
    cache: "no-store",
    redirect: "manual"
  });
  process.stdout.write(
    JSON.stringify({
      status: response.status,
      location: response.headers.get("location")
    })
  );
}

async function filesUnder(root) {
  const found = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        const data = await readFile(absolutePath);
        const details = await stat(absolutePath);
        found.push({
          name: path.relative(root, absolutePath),
          sizeBytes: details.size,
          sha256: sha256(data)
        });
      }
    }
  }
  await visit(root);
  return found.sort((left, right) => left.name.localeCompare(right.name));
}

async function inventory() {
  process.stdout.write(
    JSON.stringify({
      released: await filesUnder(required("MOLDPILOT_STORAGE_DIR")),
      quarantined: await filesUnder(required("MOLDPILOT_QUARANTINE_DIR"))
    })
  );
}

const [command, argument] = process.argv.slice(2);

try {
  if (command === "session") {
    process.stdout.write(createSessionToken());
  } else if (command === "upload-clean") {
    await upload("clean");
  } else if (command === "upload-eicar") {
    await upload("eicar");
  } else if (command === "upload-outage") {
    await upload("outage");
  } else if (command === "download" && argument != null) {
    await download(argument);
  } else if (command === "health") {
    await health();
  } else if (command === "login") {
    await pageStatus("/login");
  } else if (command === "inventory") {
    await inventory();
  } else {
    throw new Error("Unsupported D2 probe command.");
  }
} catch {
  process.stderr.write("D2 probe could not complete.\n");
  process.exit(1);
}
