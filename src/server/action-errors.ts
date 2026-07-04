function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

export function friendlyActionErrorMessage(error: unknown, fallback: string): string {
  const message = messageFrom(error);

  if (message.length === 0) {
    return fallback;
  }

  if (
    message.includes("Can't reach database server") ||
    message.includes("ECONNREFUSED") ||
    message.includes("P1001")
  ) {
    return "Database is unavailable. Start PostgreSQL with pnpm db:up, then run pnpm prisma:migrate and pnpm prisma:seed.";
  }

  if (
    message.includes("does not exist in the current database") ||
    message.includes("relation") && message.includes("does not exist") ||
    message.includes("P2021") ||
    message.includes("P2022")
  ) {
    return "Database tables are missing or out of date. Run pnpm prisma:migrate, then pnpm prisma:seed.";
  }

  if (message.includes("Unique constraint failed") || message.includes("P2002")) {
    return "A record with this unique value already exists. Check the project code or other unique field and try again.";
  }

  if (message.includes("Foreign key constraint violated") || message.includes("P2003")) {
    return "A selected related record was not found. Refresh the page and confirm the seeded users and groups exist.";
  }

  if (message.includes("Invalid `") && message.includes("prisma.")) {
    return "Database action failed. Check that PostgreSQL is running and that migrations and seed data are applied.";
  }

  return message;
}
