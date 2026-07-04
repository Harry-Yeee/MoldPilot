import { prisma } from "@/lib/prisma";

export async function getActiveCustomerOptions() {
  return prisma.customer.findMany({
    where: {
      active: true
    },
    select: {
      id: true,
      code: true,
      displayName: true,
      shortName: true,
      aliases: true,
      active: true,
      ownerUser: {
        select: {
          displayName: true,
          chineseName: true
        }
      }
    },
    orderBy: [{ code: "asc" }]
  });
}
