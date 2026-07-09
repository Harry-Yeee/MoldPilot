#!/usr/bin/env python3
"""Apply pending Prisma migrations, reseed, and verify the codebase.

Runs, in order, from the project root:
  1. pnpm prisma:migrate   (applies pending migrations + regenerates the client)
  2. pnpm prisma:seed      (refreshes roles/permissions/fixtures)
  3. pnpm typecheck        (prisma generate + next typegen + tsc)
  4. pnpm test             (domain test suite)

Stops at the first failure with a hint. Usage:
  python3 scripts/migrate-and-verify.py
"""

import shutil
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

STEPS = [
    ("Apply migrations + regenerate client", ["pnpm", "prisma:migrate"]),
    ("Seed roles, permissions, fixtures", ["pnpm", "prisma:seed"]),
    ("Typecheck", ["pnpm", "typecheck"]),
    ("Domain tests", ["pnpm", "test"]),
]

HINTS = {
    "prisma:migrate": (
        "Migration failed. Is PostgreSQL running? Try `pnpm pilot:db` to start "
        "Docker Postgres, or `pnpm pilot:preflight` for a full environment report."
    ),
    "prisma:seed": (
        "Seed failed. If migrations changed the schema unexpectedly, inspect the "
        "error above; `pnpm pilot:preflight` can help diagnose."
    ),
    "typecheck": (
        "Type errors remain. If they mention unknown Prisma fields, the client "
        "did not regenerate - run `pnpm prisma:generate` and retry."
    ),
    "test": "Test failures - read the output above; each test names the rule it checks.",
}


def main() -> int:
    if shutil.which("pnpm") is None:
        print("[FAIL] pnpm not found on PATH. Install Node 24+ and pnpm 11+ first.")
        return 1

    if not (PROJECT_ROOT / "package.json").exists():
        print(f"[FAIL] No package.json in {PROJECT_ROOT} - run from the MoldPilot checkout.")
        return 1

    print(f"MoldPilot migrate-and-verify  ({PROJECT_ROOT})")
    print("-" * 60)

    for index, (title, command) in enumerate(STEPS, start=1):
        print(f"\n[{index}/{len(STEPS)}] {title}: {' '.join(command)}")
        started = time.monotonic()
        result = subprocess.run(command, cwd=PROJECT_ROOT)
        elapsed = time.monotonic() - started

        if result.returncode != 0:
            print(f"\n[FAIL] Step {index} ({title}) exited with code {result.returncode} after {elapsed:.0f}s.")
            hint = HINTS.get(command[-1])
            if hint:
                print(f"Hint: {hint}")
            return result.returncode

        print(f"[OK] {title} ({elapsed:.0f}s)")

    print("\n" + "-" * 60)
    print("All green: migrations applied, seed refreshed, typecheck and tests pass.")
    print("Next: manual walkthrough, then commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
