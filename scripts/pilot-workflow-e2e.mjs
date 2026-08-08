#!/usr/bin/env node
/**
 * ROSTER: targets the legacy dev seed roster (`pnpm prisma:seed`) — it logs in
 * and switches between admin/xie/yvonne/bill/jun/wang/gong/zhong/viewer by
 * username. Not for bootstrapped DBs (`pnpm prisma:bootstrap` loads the
 * reviewed factory roster, where those usernames do not exist).
 */
import "dotenv/config";

import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const BASE_URL = process.env.MOLDPILOT_E2E_URL ?? "http://localhost:3000";
const PROJECT_CODE = "MP-WORKFLOW-E2E-001";
const ADMIN_TEST_USERNAME = "workflow_e2e_user";
const ADMIN_TEST_ROLE_CODE = "workflow_e2e_unused_role";
const ADMIN_TEST_ROLE_NAME = "Workflow E2E Unused Role";
const ADMIN_TEST_CUSTOMER_CODE = "C-WF-ADMIN";
const DEBUG_LOGS = process.env.MOLDPILOT_E2E_DEBUG === "1";
const connectionString =
  process.env.DATABASE_URL ?? "postgresql://moldpilot:moldpilot@localhost:5432/moldpilot?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString })
});
const userPasswords = new Map();
const workflowLoginUsers = ["admin", "xie", "yvonne", "bill", "jun", "wang", "gong", "zhong", "viewer"];
let originalScoreboardSetting = undefined;
let originalViewerReportGrant = undefined;
let originalViewerReportOverride = undefined;

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(password, salt, 64).toString("hex");
  return `scrypt-v1$${salt}$${key}`;
}

async function resetWorkflowLoginUsers() {
  for (const username of workflowLoginUsers) {
    const temporaryPassword = username === "admin" ? "admin" : "123456";
    await prisma.user.update({
      where: { username },
      data: {
        forcePasswordChange: username !== "admin",
        lastLoginAt: null,
        passwordHash: hashPassword(temporaryPassword),
        passwordUpdatedAt: null,
        status: "ACTIVE"
      }
    });
    userPasswords.set(username, temporaryPassword);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, label, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(150);
  }

  throw new Error(`${label} timed out.${lastError == null ? "" : ` Last error: ${lastError.message}`}`);
}

async function appResponds() {
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(1500) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function startDevServerIfNeeded() {
  if (await appResponds()) {
    return null;
  }

  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) {
    throw new Error("Next.js binary was not found. Run pnpm install or pnpm offline:install first.");
  }

  const server = spawn(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", "3000"], {
    cwd: process.cwd(),
    env: { ...process.env, CI: "true" },
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (DEBUG_LOGS) {
    server.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`));
    server.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));
  }

  await waitFor(appResponds, "Next dev server readiness", 30000);
  return server;
}

async function findOpenPort() {
  const server = createServer();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address == null || typeof address === "string") {
          reject(new Error("Could not resolve an open local port."));
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function launchChrome() {
  const executable = chromeExecutable();
  if (executable == null) {
    throw new Error("Chrome was not found. Install Google Chrome or set CHROME_PATH to a Chromium-compatible browser.");
  }

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "moldpilot-cdp-"));
    const debuggingPort = await findOpenPort();
    const chrome = spawn(
      executable,
      [
        "--headless=new",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-extensions",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--remote-debugging-address=127.0.0.1",
        `--remote-debugging-port=${debuggingPort}`,
        `--user-data-dir=${userDataDir}`,
        "about:blank"
      ],
      {
        stdio: ["ignore", "ignore", "pipe"]
      }
    );
    if (DEBUG_LOGS) {
      chrome.stderr.on("data", (chunk) => process.stderr.write(`[chrome] ${chunk}`));
    }

    try {
      await waitFor(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`, {
            signal: AbortSignal.timeout(1000)
          });
          return response.ok;
        } catch {
          return false;
        }
      }, `Chrome DevTools port attempt ${attempt}`, 30000);

      return {
        chrome,
        port: String(debuggingPort),
        userDataDir
      };
    } catch (error) {
      lastError = error;
      await terminateProcess(chrome, "SIGKILL");
      await rm(userDataDir, { force: true, recursive: true });
      await sleep(500);
    }
  }

  throw lastError ?? new Error("Chrome DevTools port timed out.");
}

async function terminateProcess(child, signal = "SIGTERM") {
  if (child.exitCode != null || child.signalCode != null) {
    return;
  }

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill(signal);
  });
}

class CdpPage {
  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Set();
    this.ws = new WebSocket(wsUrl);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id == null) {
        for (const waiter of [...this.eventWaiters]) {
          if (!waiter.methods.has(message.method) || !waiter.predicate(message.params ?? {})) {
            continue;
          }

          clearTimeout(waiter.timeout);
          this.eventWaiters.delete(waiter);
          waiter.resolve({ method: message.method, params: message.params ?? {} });
        }
        return;
      }

      const pending = this.pending.get(message.id);
      if (pending == null) {
        return;
      }

      this.pending.delete(message.id);
      if (message.error != null) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));

    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
    });
  }

  async navigate(url) {
    await this.send("Page.navigate", { url });
    await this.waitForExpression("document.readyState === 'complete'", "page load");
  }

  async setViewport(width, height, mobile = false) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height,
      mobile,
      width
    });
  }

  async enableDownloads(downloadPath) {
    await mkdir(downloadPath, { recursive: true });

    try {
      await this.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath,
        eventsEnabled: true
      });
    } catch {
      await this.send("Page.setDownloadBehavior", {
        behavior: "allow",
        downloadPath
      });
    }
  }

  waitForEvent(methods, label, predicate = () => true, timeoutMs = 30000) {
    const methodSet = new Set(Array.isArray(methods) ? methods : [methods]);

    return new Promise((resolve, reject) => {
      const waiter = {
        methods: methodSet,
        predicate,
        reject,
        resolve,
        timeout: setTimeout(() => {
          this.eventWaiters.delete(waiter);
          reject(new Error(`${label} timed out.`));
        }, timeoutMs)
      };
      this.eventWaiters.add(waiter);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true
    });

    if (result.exceptionDetails != null) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.exception?.value ??
          result.exceptionDetails.text ??
          "Browser evaluation failed."
      );
    }

    return result.result.value;
  }

  async waitForExpression(expression, label, timeoutMs = 15000) {
    return waitFor(async () => this.evaluate(`Boolean(${expression})`), label, timeoutMs);
  }

  async text() {
    return this.evaluate("document.body.innerText");
  }

  close() {
    for (const waiter of this.eventWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject?.(new Error("Browser page closed."));
    }
    this.eventWaiters.clear();
    this.ws.close();
  }
}

async function createBrowserPage(port) {
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((response) =>
    response.json()
  );
  const page = new CdpPage(target.webSocketDebuggerUrl);
  await page.open();
  return page;
}

function clientFunction(fn, ...args) {
  return `(${fn.toString()})(...${JSON.stringify(args)})`;
}

async function submitByHeading(page, headingText, values) {
  await page.evaluate(
    clientFunction((headingTextArg, valuesArg) => {
      const matchingHeadings = [...document.querySelectorAll("h2,h3")].filter((candidate) =>
        candidate.textContent?.includes(headingTextArg)
      );
      const heading = matchingHeadings.find((candidate) => candidate.offsetParent != null) ?? matchingHeadings[0];
      if (heading == null) {
        throw new Error(`Heading not found: ${headingTextArg}`);
      }

      let form = heading.closest("form");
      if (form == null) {
        for (let parent = heading.parentElement; parent != null; parent = parent.parentElement) {
          const directForm = [...parent.children].find((child) => child instanceof HTMLFormElement);
          if (directForm instanceof HTMLFormElement) {
            form = directForm;
            break;
          }

          if (parent.matches("section,.issueEditor")) {
            break;
          }
        }
      }
      form ??= heading.closest("section")?.querySelector("form") ?? heading.closest(".issueEditor")?.querySelector("form");
      if (form == null) {
        throw new Error(`Form not found for heading: ${headingTextArg}`);
      }

      for (const [name, value] of Object.entries(valuesArg)) {
        const field = form.querySelector(`[name="${CSS.escape(name)}"]`);
        if (field == null) {
          throw new Error(`Field not found: ${name}`);
        }

        if (field.type === "checkbox") {
          field.checked = Boolean(value);
        } else {
          field.value = value;
        }

        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }

      const invalidFields = [...form.elements]
        .filter((field) => typeof field.checkValidity === "function" && !field.checkValidity())
        .map((field) => field.name || field.id || field.tagName);
      if (invalidFields.length > 0) {
        throw new Error(`Form is invalid for heading ${headingTextArg}: ${invalidFields.join(", ")}`);
      }

      const submitter = form.querySelector('button[type="submit"], button:not([type])');
      if (submitter instanceof HTMLElement) {
        submitter.click();
      } else {
        form.requestSubmit();
      }
      return true;
    }, headingText, values)
  );
}

async function submitInTrialPanel(page, panelTitle, headingText, values) {
  await page.evaluate(
    clientFunction((panelTitleArg, headingTextArg, valuesArg) => {
      const panel = [...document.querySelectorAll("details.trialPanel")].find((candidate) =>
        candidate.querySelector("summary")?.textContent?.includes(panelTitleArg)
      );
      if (!(panel instanceof HTMLDetailsElement)) {
        throw new Error(`Trial panel not found: ${panelTitleArg}`);
      }

      panel.open = true;
      const heading = [...panel.querySelectorAll("h2,h3")].find((candidate) =>
        candidate.textContent?.includes(headingTextArg)
      );
      if (heading == null) {
        throw new Error(`Heading not found in ${panelTitleArg}: ${headingTextArg}`);
      }

      let form = heading.closest("form");
      if (form == null) {
        for (let parent = heading.parentElement; parent != null && panel.contains(parent); parent = parent.parentElement) {
          const directForm = [...parent.children].find((child) => child instanceof HTMLFormElement);
          if (directForm instanceof HTMLFormElement) {
            form = directForm;
            break;
          }

          if (parent.matches("section,.issueEditor")) {
            break;
          }
        }
      }
      form ??= heading.closest("section")?.querySelector("form") ?? heading.closest(".issueEditor")?.querySelector("form");
      if (form == null) {
        throw new Error(`Form not found in ${panelTitleArg} for heading: ${headingTextArg}`);
      }

      for (const [name, value] of Object.entries(valuesArg)) {
        const field = form.querySelector(`[name="${CSS.escape(name)}"]`);
        if (field == null) {
          throw new Error(`Field not found: ${name}`);
        }

        if (field.type === "checkbox") {
          field.checked = Boolean(value);
        } else {
          field.value = value;
        }

        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }

      const invalidFields = [...form.elements]
        .filter((field) => typeof field.checkValidity === "function" && !field.checkValidity())
        .map((field) => field.name || field.id || field.tagName);
      if (invalidFields.length > 0) {
        throw new Error(`Form is invalid for ${panelTitleArg} / ${headingTextArg}: ${invalidFields.join(", ")}`);
      }

      const submitter = form.querySelector('button[type="submit"], button:not([type])');
      if (submitter instanceof HTMLElement) {
        submitter.click();
      } else {
        form.requestSubmit();
      }
      return true;
    }, panelTitle, headingText, values)
  );
}

async function saveUserDisplayName(page, username, displayName) {
  await page.evaluate(
    clientFunction((usernameArg, displayNameArg) => {
      const row = document.querySelector(`[data-admin-user-row="${usernameArg}"]`);
      if (row == null) {
        throw new Error(`User row not found: ${usernameArg}`);
      }

      if (row.querySelector('[name="departmentGroupId"]') != null) {
        throw new Error("User account form should not include departmentGroupId.");
      }

      const displayNameInput = row.querySelector('[name="displayName"]');
      if (!(displayNameInput instanceof HTMLInputElement)) {
        throw new Error("Display name field was not found.");
      }

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(displayNameInput, displayNameArg);
      displayNameInput.dispatchEvent(new Event("input", { bubbles: true }));
      displayNameInput.dispatchEvent(new Event("change", { bubbles: true }));

      return true;
    }, username, displayName)
  );
  await waitForText(page, "Unsaved changes: 1", "staged user edit");
  await clickBatchSave(page);
}

async function assertUserStatusDropdownAbsent(page) {
  await page.evaluate(
    clientFunction(() => {
      const userSections = [...document.querySelectorAll("section")].filter((section) =>
        ["Create User", "Active Users", "Archived Users"].some((heading) => section.textContent?.includes(heading))
      );
      const statusSelect = userSections.find((section) => section.querySelector('select[name="status"]') != null);

      if (statusSelect != null) {
        throw new Error("Users tab should not expose a raw status dropdown.");
      }

      return true;
    })
  );
}

async function submitUserAction(page, username, actionText) {
  await page.evaluate(
    clientFunction((usernameArg, actionTextArg) => {
      const row = document.querySelector(`[data-admin-user-row="${usernameArg}"]`);
      if (row == null) {
        throw new Error(`User row not found: ${usernameArg}`);
      }

      const button = [...row.querySelectorAll("button")].find((candidate) =>
        candidate.textContent?.includes(actionTextArg)
      );
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`${actionTextArg} button not found for ${usernameArg}.`);
      }

      button.click();
      return true;
    }, username, actionText)
  );
  await waitForText(page, "Unsaved changes: 1", `staged user ${actionText}`);
  await clickBatchSave(page);
}

async function saveClientShortName(page, code, shortName) {
  await page.evaluate(
    clientFunction((codeArg, shortNameArg) => {
      const row = document.querySelector(`[data-admin-client-row="${codeArg}"]`);
      if (row == null) {
        throw new Error(`Client row not found: ${codeArg}`);
      }

      const shortNameInput = row.querySelector('[name="shortName"]');
      if (!(shortNameInput instanceof HTMLInputElement)) {
        throw new Error("Client short name field was not found.");
      }

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(shortNameInput, shortNameArg);
      shortNameInput.dispatchEvent(new Event("input", { bubbles: true }));
      shortNameInput.dispatchEvent(new Event("change", { bubbles: true }));

      return true;
    }, code, shortName)
  );
  await waitForText(page, "Unsaved changes: 1", "staged client edit");
  await clickBatchSave(page);
}

async function submitCustomerAction(page, code, actionText) {
  await page.evaluate(
    clientFunction((codeArg, actionTextArg) => {
      const row = document.querySelector(`[data-admin-client-row="${codeArg}"]`);
      if (row == null) {
        throw new Error(`Client row not found: ${codeArg}`);
      }

      const button = [...row.querySelectorAll("button")].find((candidate) =>
        candidate.textContent?.includes(actionTextArg)
      );
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`${actionTextArg} button not found for ${codeArg}.`);
      }

      button.click();
      return true;
    }, code, actionText)
  );
  await waitForText(page, "Unsaved changes: 1", `staged client ${actionText}`);
  await clickBatchSave(page);
}

async function clickBatchSave(page) {
  await page.evaluate(
    clientFunction(() => {
      const button = [...document.querySelectorAll(".stickyBatchBar button")].find((candidate) =>
        candidate.textContent?.includes("Save changes")
      );
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Save changes button not found.");
      }
      button.click();
      return true;
    })
  );
}

async function clickBatchDiscard(page) {
  await page.evaluate(
    clientFunction(() => {
      const button = [...document.querySelectorAll(".stickyBatchBar button")].find((candidate) =>
        candidate.textContent?.includes("Discard changes")
      );
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Discard changes button not found.");
      }
      button.click();
      return true;
    })
  );
}

async function assertCustomerCodeVisible(page, code, expected) {
  const actual = await page.evaluate(
    clientFunction((codeArg) => document.body.innerText.includes(codeArg), code)
  );

  assert.equal(actual, expected, `${code} visibility should be ${expected}.`);
}

async function assertUserInSection(page, headingText, username, expected) {
  const actual = await page.evaluate(
    clientFunction((headingTextArg, usernameArg) => {
      const heading = [...document.querySelectorAll("h2,h3")].find((candidate) =>
        candidate.textContent?.includes(headingTextArg)
      );
      const section = heading?.closest("section");

      return (
        section != null &&
        [...section.querySelectorAll("input")].some((input) => input.value === usernameArg)
      );
    }, headingText, username)
  );

  assert.equal(actual, expected, `${username} ${expected ? "should" : "should not"} appear in ${headingText}.`);
}

async function assertUserOptionVisible(page, username, expected) {
  const actual = await page.evaluate(
    clientFunction((usernameArg) =>
      [...document.querySelectorAll("select option")].some((option) => option.value === usernameArg),
    username)
  );

  assert.equal(actual, expected, `${username} option visibility should be ${expected}.`);
}

async function assertLoginRejected(page, username, password) {
  await page.evaluate(
    clientFunction(() => {
      const logoutButton = [...document.querySelectorAll(".accountMenu button")].find((button) =>
        button.textContent?.includes("Logout")
      );
      if (logoutButton instanceof HTMLButtonElement) {
        logoutButton.click();
      }
      return true;
    })
  );
  await page.waitForExpression(
    `location.pathname === '/login' || document.querySelector('.accountMenu button') == null`,
    `logout before rejected login ${username}`,
    5000
  ).catch(() => null);
  await page.navigate(`${BASE_URL}/login`);
  await page.evaluate(
    clientFunction((usernameArg, passwordArg) => {
      const form = [...document.querySelectorAll("form")].find(
        (candidate) =>
          candidate.querySelector('[name="username"]') != null &&
          candidate.querySelector('[name="password"]') != null
      );
      if (form == null) {
        throw new Error("Login form was not found.");
      }

      form.querySelector('[name="username"]').value = usernameArg;
      form.querySelector('[name="password"]').value = passwordArg;
      form.querySelector('[name="username"]').dispatchEvent(new Event("input", { bubbles: true }));
      form.querySelector('[name="password"]').dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
      return true;
    }, username, password)
  );
  await page.waitForExpression(
    `location.pathname === '/login' && document.body.innerText.includes('Invalid username or password.')`,
    `archived login rejected ${username}`
  );
}

async function waitForText(page, text, label, timeoutMs = 15000) {
  try {
    await page.waitForExpression(`document.body.innerText.includes(${JSON.stringify(text)})`, label, timeoutMs);
  } catch (error) {
    const bodyText = await page.text();
    throw new Error(`${error.message}\nPage text excerpt:\n${bodyText.slice(0, 3000)}`);
  }
}

async function waitForDomText(page, text, label, timeoutMs = 15000) {
  try {
    await page.waitForExpression(`document.body.textContent.includes(${JSON.stringify(text)})`, label, timeoutMs);
  } catch (error) {
    const bodyText = await page.evaluate("document.body.textContent");
    throw new Error(`${error.message}\nPage text excerpt:\n${bodyText.slice(0, 3000)}`);
  }
}

async function switchLanguage(page, language) {
  await page.evaluate(
    clientFunction((languageArg) => {
      const switcher = document.querySelector(".languageSwitcher select");
      if (!(switcher instanceof HTMLSelectElement)) {
        throw new Error("Language switcher was not found.");
      }

      switcher.value = languageArg;
      switcher.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, language)
  );
}

async function assertDashboardLanguageSwitch(page) {
  await switchLanguage(page, "zh-CN");
  await waitForText(page, "试模看板", "Chinese dashboard label");
  await waitForText(page, "新建立项", "Chinese intake label");
  await switchLanguage(page, "en");
  await waitForText(page, "Trial Dashboard", "English dashboard label");
}

async function assertAdminLanguageSwitch(page) {
  await switchLanguage(page, "zh-CN");
  await waitForText(page, "账户与权限", "Chinese admin heading");
  await waitForText(page, "角色与权限", "Chinese roles tab");
  await switchLanguage(page, "en");
  await waitForText(page, "Accounts & Permissions", "English admin heading");
}

async function assertMyTasksLanguageSwitchAndMobileLayout(page) {
  await page.setViewport(360, 800, true);
  await page.navigate(`${BASE_URL}/me`);
  await switchLanguage(page, "zh-CN");
  await waitForText(page, "我的任务", "Chinese My Tasks heading");
  await page.waitForExpression(`/T\\d+ 试模/.test(document.body.innerText)`, "Chinese My Tasks trial title");
  await waitForText(page, "确认试模日期", "Chinese date-confirmation label");

  const layout = await page.evaluate(
    clientFunction(() => {
      const dashboardLink = document.querySelector('.myTasksHeaderActions a[href="/"]');
      const languageSelect = document.querySelector(".myTasksHeaderActions .languageSwitcher select");

      if (!(dashboardLink instanceof HTMLElement) || !(languageSelect instanceof HTMLElement)) {
        throw new Error("My Tasks mobile header controls were not found.");
      }

      const a = dashboardLink.getBoundingClientRect();
      const b = languageSelect.getBoundingClientRect();
      const overlaps = Math.max(a.left, b.left) < Math.min(a.right, b.right) && Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom);

      return {
        clientWidth: document.documentElement.clientWidth,
        overlaps,
        scrollWidth: document.documentElement.scrollWidth
      };
    })
  );

  assert.equal(layout.overlaps, false, "Dashboard and language controls must not overlap at 360px.");
  assert.equal(layout.scrollWidth <= layout.clientWidth, true, "My Tasks must not overflow horizontally at 360px.");

  await page.navigate(`${BASE_URL}/`);
  await page.waitForExpression(`/T\\d+ 试模/.test(document.body.innerText)`, "Chinese dashboard-embedded task title");
  await page.navigate(`${BASE_URL}/me`);
  await switchLanguage(page, "en");
  await waitForText(page, "My tasks", "English My Tasks heading");
  await page.waitForExpression(`/T\\d+ trial/.test(document.body.innerText)`, "English My Tasks trial title");
  await page.navigate(`${BASE_URL}/`);
  await page.waitForExpression(`/T\\d+ trial/.test(document.body.innerText)`, "English dashboard-embedded task title");
  await page.setViewport(1280, 900, false);
}

async function dashboardReportNavigation(page) {
  return page.evaluate(
    clientFunction(() => ({
      myScore: document.querySelector('a[href="/score"]') != null,
      reports: document.querySelector('a[href="/reports"]') != null
    }))
  );
}

async function assertReportsMobileContainment(page, url) {
  await page.setViewport(360, 800, true);
  await page.navigate(url);
  await waitForText(page, "Management Reports", "mobile Management Reports");
  const layout = await page.evaluate(
    clientFunction(() => {
      const tableWrap = document.querySelector(".reportTableWrap");
      const tableWrapRect = tableWrap?.getBoundingClientRect() ?? null;
      return {
        clientWidth: document.documentElement.clientWidth,
        offenders: [...document.querySelectorAll("body *")]
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${
                typeof element.className === "string" && element.className.length > 0
                  ? `.${element.className.trim().replace(/\s+/g, ".")}`
                  : ""
              }`,
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width)
            };
          })
          .filter((row) => row.left < -1 || row.right > document.documentElement.clientWidth + 1)
          .slice(0, 12),
        page: `${location.pathname}${location.search}`,
        scrollWidth: document.documentElement.scrollWidth,
        tableContained:
          tableWrapRect == null ||
          (tableWrapRect.left >= -0.5 && tableWrapRect.right <= document.documentElement.clientWidth + 0.5)
      };
    })
  );
  assert.equal(
    layout.scrollWidth <= layout.clientWidth,
    true,
    `Reports must not cause page-wide horizontal overflow at 360px: ${JSON.stringify(layout)}`
  );
  assert.equal(layout.tableContained, true, "The Issues table scroller must remain inside the mobile viewport.");
}

async function assertManagementReportsWorkflow(page) {
  await page.setViewport(1280, 900, false);
  await page.navigate(`${BASE_URL}/`);
  await switchUser(page, "admin");
  await waitForText(page, "Trial Dashboard", "Admin dashboard before Reports");
  assert.deepEqual(await dashboardReportNavigation(page), { myScore: false, reports: true });

  await page.navigate(`${BASE_URL}/reports?tab=overview&month=2026-07`);
  await waitForText(page, "Management Reports", "Admin Management Reports");
  await waitForText(page, "Mold-trial workload", "Admin report workload");
  await waitForText(page, "Management Attention", "Admin report attention");
  await waitForText(page, "M-REPORT-002", "report fixture attention source");

  await page.navigate(`${BASE_URL}/reports?tab=issues&month=2026-07`);
  await waitForText(page, "Critical process instability requires retest", "selected-month report issue");
  await waitForText(page, "Not resolved yet", "open issue resolution state");
  await switchLanguage(page, "zh-CN");
  await waitForText(page, "管理报表", "Chinese Management Reports");
  await waitForText(page, "尚未解决", "Chinese unresolved issue state");
  await waitForText(page, "Critical process instability requires retest", "user-entered issue title preserved in Chinese");
  await switchLanguage(page, "en");
  await waitForText(page, "Management Reports", "English Management Reports restored");

  await page.navigate(`${BASE_URL}/reports?tab=scorecards&month=2026-07`);
  await page.waitForExpression("document.querySelector('#kpi-scores-heading') != null", "Admin report scorecards");
  await page.waitForExpression("document.querySelector('.kpiScoreRow') != null", "Admin scorecard rows");

  await assertReportsMobileContainment(page, `${BASE_URL}/reports?tab=overview&month=2026-07`);
  await assertReportsMobileContainment(page, `${BASE_URL}/reports?tab=issues&month=2026-07`);
  await page.setViewport(1280, 900, false);

  await page.navigate(`${BASE_URL}/`);
  await switchUser(page, "xie");
  assert.deepEqual(await dashboardReportNavigation(page), { myScore: false, reports: true });
  await page.navigate(`${BASE_URL}/reports?tab=overview&month=2026-07`);
  await waitForText(page, "Management Reports", "GM Management Reports");

  await page.navigate(`${BASE_URL}/`);
  await switchUser(page, "wang");
  assert.deepEqual(await dashboardReportNavigation(page), { myScore: true, reports: false });
  await page.navigate(`${BASE_URL}/reports?tab=overview&month=2026-07`);
  await waitForText(page, "Reports access unavailable", "scored staff Reports denial");

  await page.navigate(`${BASE_URL}/`);
  await switchUser(page, "viewer");
  assert.deepEqual(await dashboardReportNavigation(page), { myScore: false, reports: false });
  await page.navigate(`${BASE_URL}/reports?tab=overview&month=2026-07`);
  await waitForText(page, "Reports access unavailable", "Viewer Reports denial");
  assert.equal(await page.evaluate("document.body.innerText.includes('Completed trial runs')"), false);

  await setViewerReportPermission(true);
  await page.navigate(`${BASE_URL}/reports?tab=overview&month=2026-07`);
  await waitForText(page, "Completed trial runs", "report-only Viewer overview");
  await page.navigate(`${BASE_URL}/reports?tab=scorecards&month=2026-07`);
  await waitForText(page, "Current user cannot view individual scorecards.", "report-only Viewer scorecard denial");
  assert.equal(await page.evaluate("document.querySelector('.kpiScoreRow') == null"), true);

  await setViewerReportPermission(false);
  await page.navigate(`${BASE_URL}/`);
  await switchUser(page, "admin");
}

/**
 * The export became a real .xlsx technical sheet on 2026-08-08. The stored
 * FileType enum (PROCESS_SHEET_PDF), the entityType and the activity action
 * keep their pre-Excel names on purpose — they are stored strings with history,
 * and renaming them is a production data migration for a label.
 */
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_SIGNATURE = "PK\u0003\u0004";

async function assertProcessSheetExcelExportDownload(page, downloadDir) {
  const project = await prisma.moldTrialProject.findFirst({
    where: { clientProjectRef: PROJECT_CODE },
    select: { id: true, projectCode: true }
  });
  assert.ok(project, "workflow project must exist before the Excel export check");

  await page.enableDownloads(downloadDir);
  const [attachmentCountBefore, activityCountBefore] = await Promise.all([
    prisma.fileAttachment.count({
      where: {
        moldTrialProjectId: project.id,
        entityType: "PROCESS_SHEET_EXPORT"
      }
    }),
    prisma.activityLog.count({ where: { action: "exported_process_sheet_pdf" } })
  ]);

  const downloadWillBegin = page.waitForEvent(
    ["Browser.downloadWillBegin", "Page.downloadWillBegin"],
    "Process Sheet Excel browser download",
    (params) => typeof params.suggestedFilename === "string" && params.suggestedFilename.endsWith(".xlsx")
  );
  const downloadCompleted = page.waitForEvent(
    ["Browser.downloadProgress", "Page.downloadProgress"],
    "Process Sheet Excel download completion",
    (params) => params.state === "completed" || params.state === "canceled"
  );

  await page.evaluate(
    clientFunction(() => {
      const button = document.querySelector('[data-process-sheet-excel-export="true"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        throw new Error("Export Excel button is unavailable.");
      }
      button.click();
      return true;
    })
  );

  const [beginEvent, completionEvent] = await Promise.all([downloadWillBegin, downloadCompleted]);
  assert.equal(completionEvent.params.state, "completed", "Chrome Excel download should complete");
  assert.equal(completionEvent.params.guid, beginEvent.params.guid, "download events should refer to the same workbook");
  assert.match(beginEvent.params.suggestedFilename, /\.xlsx$/i);

  const downloaded = await waitFor(async () => {
    const names = (await readdir(downloadDir)).filter((name) => name.toLowerCase().endsWith(".xlsx"));
    if (names.length === 0) {
      return false;
    }

    const bytes = await readFile(path.join(downloadDir, names[0]));
    return bytes.length > 0 ? { bytes, fileName: names[0] } : false;
  }, "non-empty Process Sheet workbook on disk");
  // Every .xlsx is a ZIP: the local-file-header magic is the real proof.
  assert.equal(downloaded.bytes.subarray(0, 4).toString("latin1"), ZIP_SIGNATURE);

  await waitFor(
    async () =>
      (await prisma.fileAttachment.count({
        where: {
          moldTrialProjectId: project.id,
          entityType: "PROCESS_SHEET_EXPORT"
        }
      })) ===
      attachmentCountBefore + 1,
    "one Process Sheet FileAttachment"
  );

  const attachment = await prisma.fileAttachment.findFirst({
    where: {
      moldTrialProjectId: project.id,
      entityType: "PROCESS_SHEET_EXPORT"
    },
    orderBy: { uploadedAt: "desc" }
  });
  assert.ok(attachment, "exported Process Sheet attachment should exist");
  assert.equal(attachment.fileType, "PROCESS_SHEET_PDF");
  assert.equal(attachment.contentType, XLSX_CONTENT_TYPE);
  assert.equal(attachment.sizeBytes, downloaded.bytes.length);
  assert.equal(attachment.visibility, "CUSTOMER_SAFE");
  assert.equal(attachment.storageKey.includes("generated/process-sheet-exports"), false);
  assert.equal(attachment.fileName, beginEvent.params.suggestedFilename);

  const exportLogs = await prisma.activityLog.findMany({
    where: {
      entityType: "FileAttachment",
      entityId: attachment.id,
      action: "exported_process_sheet_pdf"
    }
  });
  assert.equal(exportLogs.length, 1, "one export click should create one ActivityLog");
  assert.equal(await prisma.activityLog.count({ where: { action: "exported_process_sheet_pdf" } }), activityCountBefore + 1);
  assert.deepEqual(exportLogs[0]?.afterJson, {
    projectCode: project.projectCode,
    attachmentId: attachment.id,
    fileName: attachment.fileName,
    sizeBytes: attachment.sizeBytes,
    visibility: "CUSTOMER_SAFE"
  });

  const routeResult = await page.evaluate(
    clientFunction(async (attachmentId) => {
      const response = await fetch(`/api/attachments/${attachmentId}`, {
        cache: "no-store",
        credentials: "same-origin"
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
        contentDisposition: response.headers.get("content-disposition"),
        byteLength: bytes.byteLength,
        signature: String.fromCharCode(...bytes.slice(0, 4))
      };
    }, attachment.id)
  );
  assert.equal(routeResult.status, 200);
  assert.equal(routeResult.contentType, XLSX_CONTENT_TYPE);
  assert.equal(Number(routeResult.contentLength), attachment.sizeBytes);
  assert.match(routeResult.contentDisposition, /^attachment;/);
  assert.equal(routeResult.byteLength, attachment.sizeBytes);
  assert.equal(routeResult.signature, ZIP_SIGNATURE);

  await waitForDomText(page, attachment.fileName, "export in Customer Files");
  const attachmentCountAfterExport = await prisma.fileAttachment.count({
    where: { moldTrialProjectId: project.id, entityType: "PROCESS_SHEET_EXPORT" }
  });
  const activityCountAfterExport = await prisma.activityLog.count({ where: { action: "exported_process_sheet_pdf" } });
  const repeatDownloadWillBegin = page.waitForEvent(
    ["Browser.downloadWillBegin", "Page.downloadWillBegin"],
    "Customer Files Excel re-download",
    (params) => params.suggestedFilename === attachment.fileName
  );
  const repeatDownloadCompleted = page.waitForEvent(
    ["Browser.downloadProgress", "Page.downloadProgress"],
    "Customer Files Excel re-download completion",
    (params) => params.state === "completed" || params.state === "canceled"
  );

  await page.evaluate(
    clientFunction((attachmentId) => {
      const link = document.querySelector(`a[href="/api/attachments/${CSS.escape(attachmentId)}"]`);
      if (!(link instanceof HTMLAnchorElement)) {
        throw new Error("Customer Files Excel download link was not found.");
      }
      link.click();
      return true;
    }, attachment.id)
  );
  const [repeatBegin, repeatComplete] = await Promise.all([repeatDownloadWillBegin, repeatDownloadCompleted]);
  assert.equal(repeatComplete.params.state, "completed");
  assert.equal(repeatComplete.params.guid, repeatBegin.params.guid);
  assert.equal(
    await prisma.fileAttachment.count({
      where: { moldTrialProjectId: project.id, entityType: "PROCESS_SHEET_EXPORT" }
    }),
    attachmentCountAfterExport,
    "re-downloading from Customer Files must not create another attachment"
  );
  assert.equal(
    await prisma.activityLog.count({ where: { action: "exported_process_sheet_pdf" } }),
    activityCountAfterExport,
    "re-downloading from Customer Files must not create another export log"
  );
}

async function switchUser(page, username) {
  const password = userPasswords.get(username) ?? `WorkflowPass!${username}`;
  const returnUrl = await page.evaluate("location.href");

  await page.evaluate(
    clientFunction(() => {
      const logoutButton = [...document.querySelectorAll(".accountMenu button")].find((button) =>
        button.textContent?.includes("Logout")
      );
      if (logoutButton instanceof HTMLButtonElement) {
        logoutButton.click();
      }
      return true;
    })
  );
  await page.waitForExpression(
    `location.pathname === '/login' || document.querySelector('.accountMenu button') == null`,
    `logout before ${username}`,
    5000
  ).catch(() => null);
  await page.navigate(`${BASE_URL}/login`);
  await page.evaluate(
    clientFunction((usernameArg, passwordArg) => {
      const form = [...document.querySelectorAll("form")].find(
        (candidate) =>
          candidate.querySelector('[name="username"]') != null &&
          candidate.querySelector('[name="password"]') != null
      );
      if (form == null) {
        throw new Error("Login form was not found.");
      }

      form.querySelector('[name="username"]').value = usernameArg;
      form.querySelector('[name="password"]').value = passwordArg;
      form.querySelector('[name="username"]').dispatchEvent(new Event("input", { bubbles: true }));
      form.querySelector('[name="password"]').dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
      return true;
    }, username, password)
  );
  await page.waitForExpression(
    `location.pathname === '/' || location.pathname === '/change-password'`,
    `login ${username}`
  );

  if ((await page.evaluate("location.pathname")) === "/change-password") {
    const nextPassword = `WorkflowPass!${username}`;
    await page.evaluate(
      clientFunction((usernameArg, currentPasswordArg, nextPasswordArg) => {
        const form = [...document.querySelectorAll("form")].find((candidate) =>
          candidate.textContent?.includes("Current password")
        );
        if (form == null) {
          throw new Error("Change-password form was not found.");
        }

        form.querySelector('[name="username"]').value = usernameArg;
        form.querySelector('[name="currentPassword"]').value = currentPasswordArg;
        form.querySelector('[name="newPassword"]').value = nextPasswordArg;
        form.querySelector('[name="confirmPassword"]').value = nextPasswordArg;
        form.requestSubmit();
        return true;
      }, username, password, nextPassword)
    );
    userPasswords.set(username, nextPassword);
    await page.waitForExpression(`location.pathname === '/'`, `change password ${username}`);
  }

  if (!returnUrl.includes("/login") && !returnUrl.includes("/change-password")) {
    await page.navigate(returnUrl);
  }

  const accountIdentity = username === "admin" ? "Admin" : username === "viewer" ? "Viewer" : username;
  await waitForText(page, accountIdentity, `active account ${username}`);
}

async function sectionIsBlocked(page, headingText) {
  return page.evaluate(
    clientFunction((headingTextArg) => {
      const heading = [...document.querySelectorAll("h2,h3")].find((candidate) =>
        candidate.textContent?.includes(headingTextArg)
      );
      const container = heading?.closest("section,.issueEditor");
      return container?.textContent?.includes("Current user cannot perform this action.") === true;
    }, headingText)
  );
}

async function openTrialPanel(page, panelTitle) {
  await page.evaluate(
    clientFunction((panelTitleArg) => {
      const details = [...document.querySelectorAll("details.trialPanel")].find((candidate) =>
        candidate.querySelector("summary")?.textContent?.includes(panelTitleArg)
      );
      if (!(details instanceof HTMLDetailsElement)) {
        throw new Error(`Trial panel not found: ${panelTitleArg}`);
      }

      details.open = true;
      return true;
    }, panelTitle)
  );
}

async function claimDepartmentInboxIssue(page, issueTitle, username) {
  await page.navigate(`${BASE_URL}/me`);
  await waitForDomText(page, issueTitle, `department inbox issue ${issueTitle}`);
  await page.evaluate(
    clientFunction((issueTitleArg) => {
      const titleNode = [...document.querySelectorAll("span")].find(
        (candidate) => candidate.textContent?.trim() === issueTitleArg
      );
      let container = titleNode?.parentElement;
      while (
        container != null &&
        ![...container.querySelectorAll("button")].some((button) =>
          ["I'll take this", "我来处理"].some((label) => button.textContent?.includes(label))
        )
      ) {
        container = container.parentElement;
      }
      const claimButton = [...(container?.querySelectorAll("button") ?? [])].find((button) =>
        ["I'll take this", "我来处理"].some((label) => button.textContent?.includes(label))
      );
      if (!(claimButton instanceof HTMLButtonElement) || claimButton.disabled) {
        throw new Error(`Claim button unavailable for issue: ${issueTitleArg}`);
      }
      claimButton.click();
      return true;
    }, issueTitle)
  );
  await page.waitForExpression(
    `document.querySelector('form input[name="ownerUsername"][value="${username}"]') != null`,
    `claim form for ${issueTitle}`
  );
  await page.evaluate(
    clientFunction((usernameArg) => {
      const ownerField = document.querySelector(
        `form input[name="ownerUsername"][value="${CSS.escape(usernameArg)}"]`
      );
      const form = ownerField?.closest("form");
      if (!(form instanceof HTMLFormElement)) {
        throw new Error("Department inbox claim form was not found.");
      }
      form.requestSubmit();
      return true;
    }, username)
  );
  await waitForText(page, "Trial issue updated.", `claim ${issueTitle}`);
}

async function issueActionIsDisabled(page, issueTitle, actionText) {
  return page.evaluate(
    clientFunction((issueTitleArg, actionTextArg) => {
      const row = [...document.querySelectorAll("tr")].find((candidate) =>
        candidate.textContent?.includes(issueTitleArg)
      );
      if (row == null) {
        throw new Error(`Issue row not found: ${issueTitleArg}`);
      }

      const button = [...row.querySelectorAll("button")].find((candidate) =>
        candidate.textContent?.includes(actionTextArg)
      );
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`${actionTextArg} button not found for issue: ${issueTitleArg}`);
      }

      return button.disabled;
    }, issueTitle, actionText)
  );
}

async function openIssueAction(page, issueTitle, actionText) {
  await page.evaluate(
    clientFunction((issueTitleArg, actionTextArg) => {
      const row = [...document.querySelectorAll("tr")].find((candidate) =>
        candidate.textContent?.includes(issueTitleArg)
      );
      if (row == null) {
        throw new Error(`Issue row not found: ${issueTitleArg}`);
      }

      const button = [...row.querySelectorAll("button")].find((candidate) =>
        candidate.textContent?.includes(actionTextArg)
      );
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        throw new Error(`${actionTextArg} button unavailable for issue: ${issueTitleArg}`);
      }

      button.click();
      return true;
    }, issueTitle, actionText)
  );
}

async function setRolePermission(page, roleName, permissionCode, enabled) {
  await page.evaluate(
    clientFunction((roleNameArg, permissionCodeArg, enabledArg) => {
      const checkbox = document.querySelector(
        `.matrixPermissionCheckbox[data-role-name="${CSS.escape(roleNameArg)}"][data-permission-code="${CSS.escape(
          permissionCodeArg
        )}"]`
      );
      if (checkbox == null) {
        throw new Error(`Matrix permission checkbox not found: ${roleNameArg} / ${permissionCodeArg}`);
      }

      checkbox.checked = Boolean(enabledArg);
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      const form = checkbox.closest("form");
      if (form == null) {
        throw new Error("Role permission matrix form was not found.");
      }

      const submitter = form.querySelector('button[type="submit"], button:not([type])');
      if (submitter instanceof HTMLElement) {
        submitter.click();
      } else {
        form.requestSubmit();
      }
      return true;
    }, roleName, permissionCode, enabled)
  );
}

async function removeRoleByName(page, roleName) {
  await page.evaluate(
    clientFunction((roleNameArg) => {
      const rows = [...document.querySelectorAll(".roleAdminRow")];
      const row = rows.find((candidate) => candidate.querySelector('input[name="name"]')?.value === roleNameArg);
      if (row == null) {
        throw new Error(`Role row not found: ${roleNameArg}`);
      }

      const button = row.querySelector(".dangerButton");
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        throw new Error(`Remove button unavailable for role: ${roleNameArg}`);
      }

      button.click();
      return true;
    }, roleName)
  );
}

async function prepareDatabase() {
  await prisma.$connect();
  const existingAdminTestUser = await prisma.user.findUnique({
    where: { username: ADMIN_TEST_USERNAME },
    select: { id: true }
  });

  if (existingAdminTestUser != null) {
    await prisma.activityLog.deleteMany({
      where: {
        entityId: existingAdminTestUser.id,
        entityType: "User"
      }
    });
  }
  const existingAdminTestCustomer = await prisma.customer.findUnique({
    where: { code: ADMIN_TEST_CUSTOMER_CODE },
    select: { id: true }
  });

  if (existingAdminTestCustomer != null) {
    await prisma.activityLog.deleteMany({
      where: {
        entityId: existingAdminTestCustomer.id,
        entityType: "Customer"
      }
    });
  }

  await prisma.activityLog.deleteMany({ where: { action: { startsWith: "workflow_e2e_" } } });
  await prisma.moldTrialProject.deleteMany({
    where: {
      OR: [{ projectCode: PROJECT_CODE }, { clientProjectRef: PROJECT_CODE }]
    }
  });
  await prisma.customer.deleteMany({ where: { code: ADMIN_TEST_CUSTOMER_CODE } });
  await prisma.user.deleteMany({ where: { username: ADMIN_TEST_USERNAME } });
  await prisma.role.deleteMany({ where: { code: ADMIN_TEST_ROLE_CODE } });

  const [admin, qcRole, reschedule, viewerRole, viewerUser, reportPermission, scoreboardSetting] = await Promise.all([
    prisma.user.findUnique({ where: { username: "admin" } }),
    prisma.role.findUnique({ where: { code: "qc" } }),
    prisma.permission.findUnique({ where: { code: "trial.schedule.reschedule" } }),
    prisma.role.findUnique({ where: { code: "viewer" } }),
    prisma.user.findUnique({ where: { username: "viewer" } }),
    prisma.permission.findUnique({ where: { code: "reports.management.view" } }),
    prisma.systemSetting.findUnique({ where: { key: "scoreboard_enabled" } })
  ]);

  if (
    admin == null ||
    qcRole == null ||
    reschedule == null ||
    viewerRole == null ||
    viewerUser == null ||
    reportPermission == null
  ) {
    throw new Error("Seeded users, roles, or required permissions are missing. Run pnpm pilot:seed first.");
  }

  originalScoreboardSetting = scoreboardSetting == null
    ? null
    : { value: scoreboardSetting.value, updatedById: scoreboardSetting.updatedById };
  originalViewerReportGrant = await prisma.rolePermission.findUnique({
    where: {
      roleId_permissionId: {
        roleId: viewerRole.id,
        permissionId: reportPermission.id
      }
    },
    select: { enabled: true, updatedById: true }
  });
  originalViewerReportOverride = await prisma.userPermissionOverride.findUnique({
    where: {
      userId_permissionId: {
        userId: viewerUser.id,
        permissionId: reportPermission.id
      }
    },
    select: { effect: true, expiresAt: true, reason: true, updatedById: true }
  });

  await resetWorkflowLoginUsers();

  await prisma.systemSetting.upsert({
    where: { key: "scoreboard_enabled" },
    update: { value: "true", updatedById: admin.id },
    create: { key: "scoreboard_enabled", value: "true", updatedById: admin.id }
  });
  await prisma.userPermissionOverride.deleteMany({
    where: { userId: viewerUser.id, permissionId: reportPermission.id }
  });
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: viewerRole.id,
        permissionId: reportPermission.id
      }
    },
    update: { enabled: false, updatedById: admin.id },
    create: {
      roleId: viewerRole.id,
      permissionId: reportPermission.id,
      enabled: false,
      updatedById: admin.id
    }
  });

  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: qcRole.id,
        permissionId: reschedule.id
      }
    },
    update: {
      enabled: false,
      updatedById: admin.id
    },
    create: {
      roleId: qcRole.id,
      permissionId: reschedule.id,
      enabled: false,
      updatedById: admin.id
    }
  });
}

async function setViewerReportPermission(enabled) {
  const [admin, viewerRole, reportPermission] = await Promise.all([
    prisma.user.findUnique({ where: { username: "admin" }, select: { id: true } }),
    prisma.role.findUnique({ where: { code: "viewer" }, select: { id: true } }),
    prisma.permission.findUnique({ where: { code: "reports.management.view" }, select: { id: true } })
  ]);
  if (admin == null || viewerRole == null || reportPermission == null) {
    throw new Error("Cannot prepare the report-only Viewer permission check.");
  }
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: viewerRole.id,
        permissionId: reportPermission.id
      }
    },
    update: { enabled, updatedById: admin.id },
    create: {
      roleId: viewerRole.id,
      permissionId: reportPermission.id,
      enabled,
      updatedById: admin.id
    }
  });
}

async function restoreReportTestState() {
  if (
    originalScoreboardSetting === undefined ||
    originalViewerReportGrant === undefined ||
    originalViewerReportOverride === undefined
  ) {
    return;
  }

  const [admin, viewerRole, viewerUser, reportPermission] = await Promise.all([
    prisma.user.findUnique({ where: { username: "admin" }, select: { id: true } }),
    prisma.role.findUnique({ where: { code: "viewer" }, select: { id: true } }),
    prisma.user.findUnique({ where: { username: "viewer" }, select: { id: true } }),
    prisma.permission.findUnique({ where: { code: "reports.management.view" }, select: { id: true } })
  ]);
  if (admin == null || viewerRole == null || viewerUser == null || reportPermission == null) {
    return;
  }

  if (originalScoreboardSetting == null) {
    await prisma.systemSetting.deleteMany({ where: { key: "scoreboard_enabled" } });
  } else {
    await prisma.systemSetting.upsert({
      where: { key: "scoreboard_enabled" },
      update: originalScoreboardSetting,
      create: { key: "scoreboard_enabled", ...originalScoreboardSetting }
    });
  }

  if (originalViewerReportGrant == null) {
    await prisma.rolePermission.deleteMany({
      where: { roleId: viewerRole.id, permissionId: reportPermission.id }
    });
  } else {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: viewerRole.id,
          permissionId: reportPermission.id
        }
      },
      update: originalViewerReportGrant,
      create: {
        roleId: viewerRole.id,
        permissionId: reportPermission.id,
        ...originalViewerReportGrant
      }
    });
  }

  if (originalViewerReportOverride == null) {
    await prisma.userPermissionOverride.deleteMany({
      where: { userId: viewerUser.id, permissionId: reportPermission.id }
    });
  } else {
    await prisma.userPermissionOverride.upsert({
      where: {
        userId_permissionId: {
          userId: viewerUser.id,
          permissionId: reportPermission.id
        }
      },
      update: originalViewerReportOverride,
      create: {
        userId: viewerUser.id,
        permissionId: reportPermission.id,
        ...originalViewerReportOverride
      }
    });
  }
}

async function restoreQcPermission() {
  const admin = await prisma.user.findUnique({ where: { username: "admin" } });
  const qcRole = await prisma.role.findUnique({ where: { code: "qc" } });
  const reschedule = await prisma.permission.findUnique({ where: { code: "trial.schedule.reschedule" } });

  if (admin != null && qcRole != null && reschedule != null) {
    await prisma.rolePermission.updateMany({
      where: {
        roleId: qcRole.id,
        permissionId: reschedule.id
      },
      data: {
        enabled: false,
        updatedById: admin.id
      }
    });
  }
}

async function verifyWorkflowOutcome() {
  const [project, adminTestUser, adminTestRole, adminTestCustomer] = await Promise.all([
    prisma.moldTrialProject.findFirst({
      where: { clientProjectRef: PROJECT_CODE },
      include: {
        trialEvents: true,
        trialIssues: true
      }
    }),
    prisma.user.findUnique({
      where: { username: ADMIN_TEST_USERNAME },
      include: {
        role: true
      }
    }),
    prisma.role.findUnique({ where: { code: ADMIN_TEST_ROLE_CODE } }),
    prisma.customer.findUnique({ where: { code: ADMIN_TEST_CUSTOMER_CODE } })
  ]);

  assert.ok(project, "workflow E2E project should exist");
  assert.equal(project.clientProjectRef, PROJECT_CODE);
  assert.ok(adminTestUser, "workflow E2E Admin-created user should exist");
  assert.equal(adminTestUser.displayName, "Workflow E2E Viewer Edited");
  assert.equal(adminTestUser.chineseName, "测试用户");
  assert.equal(adminTestUser.status, "ACTIVE");
  assert.equal(adminTestUser.role.code, "viewer");
  assert.equal(adminTestUser.departmentGroupId, null);
  assert.equal(adminTestRole, null, "unused workflow E2E role should be hard-deleted");
  assert.ok(adminTestCustomer, "workflow E2E Admin-created customer should exist");
  assert.equal(adminTestCustomer.displayName, "Workflow E2E Customer Edited");
  assert.equal(adminTestCustomer.active, false);
  const userLifecycleLogs = await prisma.activityLog.findMany({
    where: {
      action: { in: ["admin_archived_user", "admin_restored_user"] },
      entityId: adminTestUser.id,
      entityType: "User"
    },
    select: {
      action: true
    }
  });
  assert.deepEqual(
    new Set(userLifecycleLogs.map((log) => log.action)),
    new Set(["admin_archived_user", "admin_restored_user"])
  );
  const customerLifecycleLogs = await prisma.activityLog.findMany({
    where: {
      action: { in: ["admin_created_customer", "admin_updated_customer", "admin_archived_customer"] },
      entityId: adminTestCustomer.id,
      entityType: "Customer"
    },
    select: {
      action: true
    }
  });
  assert.deepEqual(
    new Set(customerLifecycleLogs.map((log) => log.action)),
    new Set(["admin_created_customer", "admin_updated_customer", "admin_archived_customer"])
  );
  assert.equal(project.createdById != null, true);
  assert.equal(project.customerId != null, true);
  assert.equal(project.customerCode, "C-WF");
  assert.equal(project.firstPlannedTrialDate != null, true);
  assert.equal(project.trialEvents.some((trial) => trial.trialCode === "T1" && trial.createdById != null), true);
  assert.equal(project.trialEvents.some((trial) => trial.trialCode === "T2" && trial.sourceArea === "QC"), true);
  assert.equal(project.trialIssues.some((issue) => issue.title.includes("technical unrelated")), true);
  assert.equal(
    project.trialIssues.some(
      (issue) =>
        issue.title.includes("assembly relevant") &&
        issue.status === "CLOSED" &&
        issue.fixSummary?.includes("Assembly fixed") === true
    ),
    true
  );
}

async function main() {
  console.log("MoldPilot browser/server-action workflow E2E\n");
  await prepareDatabase();

  let devServer = null;
  let chrome = null;
  let page = null;
  let userDataDir = null;
  let workflowProjectPath = null;

  try {
    devServer = await startDevServerIfNeeded();
    const launched = await launchChrome();
    chrome = launched.chrome;
    userDataDir = launched.userDataDir;
    page = await createBrowserPage(launched.port);
    const downloadDir = path.join(userDataDir, "downloads");
    await page.setViewport(1280, 900, false);
    const workflowCustomer = await prisma.customer.findUnique({ where: { code: "C-WF" } });
    assert.ok(workflowCustomer?.active, "C-WF active Customer Master record should exist");

    await page.navigate(`${BASE_URL}/`);
    await switchUser(page, "yvonne");
    await assertDashboardLanguageSwitch(page);
    console.log("[OK] Dashboard language switch changes labels and returns to English.");
    await submitByHeading(page, "Create Project Intake", {
      customerId: workflowCustomer.id,
      customerTargetDate: "2026-09-30",
      initialCustomerNote: "Sanitized workflow E2E customer feedback note.",
      intakeNote: "Sanitized workflow E2E intake created by Marketing/Sales.",
      moldCode: "M-WF-01",
      partCode: "P-WF-A",
      planningPmUsername: "bill",
      priority: "HIGH",
      clientProjectRef: PROJECT_CODE
    });
    await page.waitForExpression("location.pathname.includes('/projects/')", "intake redirect");
    workflowProjectPath = await page.evaluate(clientFunction(() => location.pathname));
    assert.equal(await sectionIsBlocked(page, "Set First T0 Date"), true);
    console.log("[OK] Marketing/Sales created intake and cannot set T0.");

    await switchUser(page, "bill");
    await submitByHeading(page, "Set First T0 Date", {
      plannedDate: "2026-09-02",
      planningPmUsername: "bill"
    });
    await waitForText(page, "First T0 planned date set.", "T0 schedule");
    await waitForText(page, "Digital Process Sheet", "Digital Process Sheet after T0 exists");
    console.log("[OK] Planning PM set T0.");

    await switchUser(page, "wang");
    await assertMyTasksLanguageSwitchAndMobileLayout(page);
    console.log(
      "[OK] Injection My Tasks switches languages and fits a 360px mobile viewport without overlap or horizontal overflow."
    );
    await page.navigate(`${BASE_URL}${workflowProjectPath}`);

    await switchUser(page, "gong");
    assert.equal(await sectionIsBlocked(page, "Add Next Planned Trial"), true);
    console.log("[OK] QC cannot reschedule by default.");

    await switchUser(page, "jun");
    await submitInTrialPanel(page, "T0", "Add Trial Issue", {
      description: "Workflow E2E technical issue.",
      dueDate: "2026-09-08",
      issueType: "MOLD_DESIGN_ISSUE",
      severity: "HIGH",
      source: "PM_REVIEW",
      status: "IN_PROGRESS",
      title: "Workflow E2E technical unrelated issue"
    });
    await waitForText(page, "Trial issue created.", "technical issue creation");
    await openTrialPanel(page, "T0");
    await waitForDomText(page, "Workflow E2E technical unrelated issue", "technical issue");
    await submitInTrialPanel(page, "T0", "Add Trial Issue", {
      description: "Workflow E2E Assembly acknowledgement issue.",
      dueDate: "2026-09-09",
      issueType: "ASSEMBLY_FITTING_ISSUE",
      severity: "MEDIUM",
      source: "PM_REVIEW",
      status: "IN_PROGRESS",
      title: "Workflow E2E assembly relevant issue"
    });
    await waitForText(page, "Trial issue created.", "assembly issue creation");
    await openTrialPanel(page, "T0");
    await waitForDomText(page, "Workflow E2E assembly relevant issue", "assembly issue");
    await submitInTrialPanel(page, "T0", "Record Result", {
      actualDate: "2026-09-02",
      mainIssuesSummary: "Workflow E2E T0 found technical and assembly issues.",
      outcomeNote: "Follow-up issues were created for workflow E2E validation.",
      result: "NOT_APPROVED"
    });
    await waitForText(page, "Completed trial recorded.", "T0 result");
    await submitByHeading(page, "Add Next Planned Trial", {
      planReasonCategory: "TRIAL_ISSUE_VERIFICATION",
      planReasonDetail: "Technical PM schedules T1 to verify workflow E2E corrections.",
      plannedDate: "2026-09-10",
      requesterUsername: "jun",
      sourceArea: "TECHNICAL"
    });
    await waitForText(page, "New planned trial added.", "Technical PM T1");
    console.log("[OK] Technical PM added T1 after T0 completion.");

    await switchUser(page, "yvonne");
    await assertProcessSheetExcelExportDownload(page, downloadDir);
    console.log("[OK] Marketing exported, downloaded, and re-downloaded one customer-safe Process Sheet Excel workbook.");

    await switchUser(page, "zhong");
    await claimDepartmentInboxIssue(page, "Workflow E2E assembly relevant issue", "zhong");
    await page.navigate(`${BASE_URL}${workflowProjectPath}`);
    await openTrialPanel(page, "T0");
    assert.equal(await issueActionIsDisabled(page, "Workflow E2E technical unrelated issue", "Close Issue"), true);
    await openIssueAction(page, "Workflow E2E assembly relevant issue", "Close Issue");
    await submitByHeading(page, "Close Issue", {
      closedAt: "2026-09-07",
      fixSummary: "Assembly fixed workflow E2E fitting issue.",
      fixTimeMinutes: "120"
    });
    await waitForText(page, "Trial issue closed.", "Assembly owner close");
    console.log("[OK] Assembly claimed its department issue and can close only its owned/relevant issue.");

    await switchUser(page, "admin");
    const viewerRole = await prisma.role.findUnique({ where: { code: "viewer" } });
    if (viewerRole == null) {
      throw new Error("Seeded Viewer role is missing.");
    }

    await page.navigate(`${BASE_URL}/admin?tab=users`);
    await assertAdminLanguageSwitch(page);
    console.log("[OK] Admin language switch changes labels and returns to English.");
    await waitForText(page, "Active Users", "Active Users section");
    await waitForText(page, "Archived Users", "Archived Users section");
    await assertUserStatusDropdownAbsent(page);
    await submitByHeading(page, "Create User", {
      chineseName: "测试用户",
      displayName: "Workflow E2E Viewer",
      roleId: viewerRole.id,
      username: ADMIN_TEST_USERNAME
    });
    userPasswords.set(ADMIN_TEST_USERNAME, "123456");
    await waitForText(page, `Saved account ${ADMIN_TEST_USERNAME}.`, "Admin user creation");
    await saveUserDisplayName(page, ADMIN_TEST_USERNAME, "Workflow E2E Viewer Edited");
    await waitForText(page, "Saved 1 user row.", "Admin user edit");
    await submitUserAction(page, ADMIN_TEST_USERNAME, "Archive");
    await waitForText(page, "Saved 1 user row.", "Admin user archive");
    await assertUserInSection(page, "Active Users", ADMIN_TEST_USERNAME, false);
    await assertUserInSection(page, "Archived Users", ADMIN_TEST_USERNAME, true);
    await assertLoginRejected(page, ADMIN_TEST_USERNAME, "123456");
    await switchUser(page, "admin");
    await page.navigate(`${BASE_URL}${workflowProjectPath}`);
    await assertUserOptionVisible(page, ADMIN_TEST_USERNAME, false);
    await page.navigate(`${BASE_URL}/admin?tab=users`);
    await submitUserAction(page, ADMIN_TEST_USERNAME, "Restore");
    await waitForText(page, "Saved 1 user row.", "Admin user restore");
    await assertUserInSection(page, "Active Users", ADMIN_TEST_USERNAME, true);
    await assertUserInSection(page, "Archived Users", ADMIN_TEST_USERNAME, false);
    userPasswords.set(ADMIN_TEST_USERNAME, "123456");
    await page.navigate(`${BASE_URL}/`);
    await switchUser(page, ADMIN_TEST_USERNAME);
    await switchUser(page, "admin");
    await page.navigate(`${BASE_URL}/admin?tab=users`);
    await submitUserAction(page, "admin", "Archive");
    await waitForText(page, "At least one active account", "last admin archive guard");
    await clickBatchDiscard(page);
    await assertUserInSection(page, "Active Users", "admin", true);
    console.log("[OK] Admin archive/restore lifecycle works and preserves admin-path guardrails.");

    await page.navigate(`${BASE_URL}/admin?tab=clients`);
    await waitForText(page, "Active Clients", "Active Clients section");
    await waitForText(page, "Archived Clients", "Archived Clients section");
    await submitByHeading(page, "Create Client", {
      code: ADMIN_TEST_CUSTOMER_CODE,
      notes: "Sanitized Customer Master note without contact fields.",
      shortName: "Workflow E2E"
    });
    await waitForText(page, `Saved client ${ADMIN_TEST_CUSTOMER_CODE}.`, "Admin client creation");
    await saveClientShortName(page, ADMIN_TEST_CUSTOMER_CODE, "Workflow E2E Customer Edited");
    await waitForText(page, "Saved 1 client row.", "Admin client edit");
    await submitCustomerAction(page, ADMIN_TEST_CUSTOMER_CODE, "Archive");
    await waitForText(page, "Saved 1 client row.", "Admin client archive");
    await page.navigate(`${BASE_URL}/`);
    await assertCustomerCodeVisible(page, ADMIN_TEST_CUSTOMER_CODE, false);
    console.log("[OK] Admin Clients create/edit/archive works and archived clients are not selectable.");

    await page.navigate(`${BASE_URL}/admin?tab=roles`);
    await submitByHeading(page, "Create Role", {
      active: "true",
      code: ADMIN_TEST_ROLE_CODE,
      description: "Temporary workflow E2E role for hard-delete coverage.",
      name: ADMIN_TEST_ROLE_NAME
    });
    await waitForText(page, `Saved role ${ADMIN_TEST_ROLE_NAME}.`, "Admin role creation");
    await removeRoleByName(page, ADMIN_TEST_ROLE_NAME);
    await waitForText(page, `Deleted role ${ADMIN_TEST_ROLE_NAME}.`, "Admin unused role deletion");
    console.log("[OK] Admin created and hard-deleted an unused role from Roles & Permissions.");

    await setRolePermission(page, "QC", "trial.schedule.reschedule", true);
    await waitForText(page, "Saved role permission matrix.", "grant QC reschedule");

    await page.navigate(`${BASE_URL}${workflowProjectPath}`);
    await switchUser(page, "jun");
    await submitInTrialPanel(page, "T1", "Add Trial Issue", {
      description: "Workflow E2E T1 QC follow-up issue.",
      dueDate: "2026-09-14",
      issueType: "QC_DIMENSION_ISSUE",
      severity: "MEDIUM",
      source: "QC_INSPECTION",
      status: "OPEN",
      title: "Workflow E2E T1 QC follow-up issue"
    });
    await waitForText(page, "Trial issue created.", "T1 QC issue creation");
    await submitInTrialPanel(page, "T1", "Record Result", {
      actualDate: "2026-09-10",
      mainIssuesSummary: "Workflow E2E T1 verified enough for QC follow-up scheduling.",
      outcomeNote: "Conditional approval remains documented for workflow E2E.",
      result: "CONDITIONAL"
    });
    await waitForText(page, "Completed trial recorded.", "T1 result");
    await switchUser(page, "gong");
    assert.equal(await sectionIsBlocked(page, "Add Next Planned Trial"), false);
    await submitByHeading(page, "Add Next Planned Trial", {
      planReasonCategory: "QC_FAILURE",
      planReasonDetail: "QC schedules T2 after Admin grants reschedule permission.",
      plannedDate: "2026-09-18",
      requesterUsername: "gong",
      sourceArea: "QC"
    });
    await waitForText(page, "New planned trial added.", "QC T2 after grant");

    await switchUser(page, "admin");
    await page.navigate(`${BASE_URL}/admin?tab=roles`);
    await setRolePermission(page, "QC", "trial.schedule.reschedule", false);
    await waitForText(page, "Saved role permission matrix.", "revoke QC reschedule");
    await page.navigate(`${BASE_URL}${workflowProjectPath}`);
    await switchUser(page, "gong");
    assert.equal(await sectionIsBlocked(page, "Add Next Planned Trial"), true);
    console.log("[OK] Admin role permission toggle changed UI and server-action behavior.");

    await assertManagementReportsWorkflow(page);
    console.log("[OK] Management Reports passed Admin, GM, scored-staff, report-only, bilingual, and 360px browser checks.");

    await verifyWorkflowOutcome();
    console.log(`[OK] ${PROJECT_CODE} completed browser/server-action workflow E2E.`);
  } finally {
    page?.close();
    if (chrome != null) {
      await terminateProcess(chrome);
    }
    if (devServer != null) {
      await terminateProcess(devServer);
    }
    if (userDataDir != null) {
      try {
        await rm(userDataDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
      } catch (error) {
        if (DEBUG_LOGS) {
          console.warn(`[warn] Failed to remove temporary Chrome profile: ${error.message}`);
        }
      }
    }
    await restoreQcPermission();
    await restoreReportTestState();
    await resetWorkflowLoginUsers();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
