import { verifyExistingWritableDirectory } from "@/domain/security/runtime-directory";
import { evaluateRuntimeReadiness, type RuntimeReadinessReport } from "@/domain/security/runtime-health";
import { prisma } from "@/lib/prisma";
import {
  attachmentQuarantineRoot,
  attachmentStorageRoot
} from "@/server/attachment-storage";

export async function getRuntimeReadiness(): Promise<RuntimeReadinessReport> {
  return evaluateRuntimeReadiness({
    database: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    storage: () => verifyExistingWritableDirectory(attachmentStorageRoot()),
    quarantine: () => verifyExistingWritableDirectory(attachmentQuarantineRoot())
  });
}
