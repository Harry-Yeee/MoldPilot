import { prisma } from "@/lib/prisma";

export type ActiveUserOption = Awaited<ReturnType<typeof getActiveUserOptions>>[number];

export async function getActiveUserOptions() {
  return prisma.user.findMany({
    where: {
      status: "ACTIVE"
    },
    select: {
      id: true,
      chineseName: true,
      displayName: true,
      role: {
        select: {
          code: true,
          name: true
        }
      },
      username: true
    },
    orderBy: [{ displayName: "asc" }, { username: "asc" }]
  });
}

export async function getActivePmUserOptions() {
  return getActiveUserOptions().then((users) => users.filter((user) => user.role.code === "pm"));
}
