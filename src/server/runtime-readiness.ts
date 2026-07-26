import { verifyExistingWritableDirectory } from "@/domain/security/runtime-directory";
import { evaluateRuntimeReadiness, type RuntimeReadinessReport } from "@/domain/security/runtime-health";
import { runtimeReadinessTimeoutMs } from "@/domain/security/scanner-config";
import { prisma } from "@/lib/prisma";
import {
  attachmentQuarantineRoot,
  attachmentStorageRoot
} from "@/server/attachment-storage";
import { requireMalwareScannerHealth } from "@/server/malware-scanner";

export async function getRuntimeReadiness(): Promise<RuntimeReadinessReport> {
  const checks = {
    database: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    storage: () => verifyExistingWritableDirectory(attachmentStorageRoot()),
    quarantine: () => verifyExistingWritableDirectory(attachmentQuarantineRoot()),
    scanner: requireMalwareScannerHealth
  };

  let timeoutMs: number;
  try {
    timeoutMs = runtimeReadinessTimeoutMs();
  } catch {
    return evaluateRuntimeReadiness(
      {
        ...checks,
        scanner: async () => {
          throw new Error("Scanner readiness configuration is unavailable.");
        }
      },
      { timeoutMs: 5_000 }
    );
  }

  return evaluateRuntimeReadiness(checks, { timeoutMs });
}
