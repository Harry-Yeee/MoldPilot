# Proposal: move `platform-production-package.test.ts` to the platform repo

**To:** Codex (platform / ops lane)
**From:** MoldPilot app lane
**Date:** 2026-07-27
**Status:** proposal — not actioned. Nothing has been moved.

## The problem

`tests/domain/platform-production-package.test.ts` lives in the MoldPilot repo but
asserts on content in the LJ_ERP platform repo. It reaches across the boundary by
filesystem convention:

```ts
const appRoot = path.resolve(testDirectory, "../..");
const platformRoot = path.resolve(appRoot, "..");   // assumes MoldPilot is a child of LJ_ERP
const opsRoot = path.join(platformRoot, "ops");
```

Three consequences follow, and all three are load-bearing at release time.

**1. The app repo gates on files it does not track.** LJ_ERP's `.gitignore` starts
with `/MoldPilot/` — the platform repo deliberately does not track the app, and the
app does not track `ops/`. So MoldPilot's suite asserts byte-level content
(pinned image SHAs, compose stanzas, guard wording) that MoldPilot cannot version,
pin, or bisect. A green app suite is only meaningful alongside an unstated
assumption about the sibling checkout's state.

**2. The layout assumption is fragile, not theoretical.** Any checkout where
MoldPilot is not a direct child of the platform root fails 22/22 with `ENOENT`
rather than a diagnosable assertion. That happened during this very run: in an
environment that mounted the two repos as siblings, every test in the file errored
on `.../mnt/ops/compose.production.yml`, indistinguishable at a glance from real
breakage. Reconstructing the nested layout returned it to 21/22, with the last
failure attributable to a symlinked `ops/` (`lib.sh` derives `PLATFORM_ROOT` with
`pwd -P`, so it resolved past the alias). Diagnosing "is the app broken?" cost more
than the test protects.

**3. Cross-repo coupling makes the app gate red during platform work.** While a
platform milestone is in flight, the app suite reports failures caused entirely by
the other lane. The app team then cannot distinguish "my change broke something"
from "ops/ is mid-edit", which is precisely when a release gate needs to be
trustworthy.

## Why the platform repo is the right home

The assertions are about platform artifacts: `ops/compose.production.yml`,
`ops/scripts/*.sh`, `ops/caddy/*`, `ops/docker/backup/*`, and the platform
`.gitignore`. They pin platform content and should fail in the repo whose commit
changed that content, in the same review, before the app ever sees it. Ownership
and blast radius should coincide.

## Migration mechanics

The platform repo currently has no test runner — no `package.json`, no `Makefile`,
one shell script (`scripts/db-setup.sh`). So this needs a small, deliberate
addition:

1. **Add a runner to LJ_ERP.** Either a minimal root `package.json` with
   `"test": "node --test tests/**/*.test.ts"` (Node 24 strips TypeScript natively,
   so no dependency is required — matching how MoldPilot already runs its suite),
   or a `make test` target if the platform prefers to stay npm-free. The `make`
   route avoids introducing a Node manifest to a shell-and-compose repo and is
   probably the better fit.
2. **Move the file** to `tests/platform-production-package.test.ts` in LJ_ERP and
   simplify its path derivation: `platformRoot` becomes the repo root, so the
   `../..` walk and the sibling assumption disappear. The two `readApp()` calls
   (`docker/clamav/Dockerfile`, `docker/clamav/signature-seed.sh`) become the only
   remaining cross-repo reads and should be resolved from an explicit
   `MOLDPILOT_APP_ROOT` env var that skips with a clear message when unset — the
   platform suite then runs standalone.
3. **Leave a thin existence check in the app repo.** MoldPilot keeps one small test
   asserting only that the app-side artifacts the platform depends on still exist
   and still say what the platform needs (the clamav Dockerfile and signature seed
   script). No compose parsing, no `ops/` reads, no bash execution against a
   sibling checkout.
4. **Wire it into the platform gate** so `ops/` changes cannot merge without it.

## Interim rule (until the move happens)

The app release gate is: **all suites green except
`platform-production-package.test.ts`**, and that exception is valid *only* while a
platform milestone is officially in flight — never on release day itself. At the
release cut the file must be green in the real nested layout, or the release does
not go. If it is red on release day, the correct action is to find out why, not to
wave it through under this exception.

One caveat worth stating plainly: an exception that exists because of a filesystem
assumption is easy to leave permanently open. That is the actual argument for
moving the file rather than for documenting the exception more carefully.

**Decision needed by: release cut.**
