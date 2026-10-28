import { migrateDatabase, closeDatabase } from "../src/lib/db";

try {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "DATABASE_URL must be configured for this migration command.",
    );
  await migrateDatabase();
  console.log("Database migrations applied.");
} catch (error) {
  console.error(
    "Database migration failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
