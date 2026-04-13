import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { loadScriptEnv } from "./_helpers.mjs";

const MIGRATIONS_TABLE = "pgmigrations";

function isMigrationFile(fileName) {
  return (
    fileName.endsWith(".cjs") ||
    fileName.endsWith(".js") ||
    fileName.endsWith(".sql") ||
    fileName.endsWith(".ts")
  );
}

async function readMigrationFiles() {
  const migrationsDir = resolve(process.cwd(), "migrations");
  const files = await readdir(migrationsDir);

  return files
    .filter(isMigrationFile)
    .sort((left, right) => left.localeCompare(right));
}

async function readAppliedMigrations(client) {
  try {
    const result = await client.query(`
      select name, run_on
      from ${MIGRATIONS_TABLE}
      order by run_on asc, name asc
    `);

    return result.rows;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
    ) {
      return [];
    }

    throw error;
  }
}

const env = loadScriptEnv();
const client = new Client({
  connectionString: env.DATABASE_URL
});

try {
  const migrationFiles = await readMigrationFiles();

  await client.connect();

  const appliedMigrations = await readAppliedMigrations(client);
  const appliedNames = new Set(
    appliedMigrations.map((migration) => migration.name)
  );
  const pendingMigrations = migrationFiles.filter(
    (migrationFile) => !appliedNames.has(migrationFile)
  );

  console.log("[openmirage] migration status");
  console.log(
    JSON.stringify(
      {
        applied: appliedMigrations,
        pending: pendingMigrations,
        totalApplied: appliedMigrations.length,
        totalPending: pendingMigrations.length
      },
      null,
      2
    )
  );
} catch (error) {
  const message =
    error instanceof Error && error.message ? error.message : String(error);

  console.error(
    `[openmirage] migration status failed for ${env.DATABASE_URL}: ${message}`
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
