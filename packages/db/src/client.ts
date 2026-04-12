import { type ServiceCheck } from "@openmirage/types";
import { Pool } from "pg";

export const DEFAULT_DATABASE_URL =
  "postgres://openmirage:openmirage@localhost:5432/openmirage";

export function resolveDatabaseUrl(databaseUrl?: string): string {
  return databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function createDatabasePool(databaseUrl?: string): Pool {
  return new Pool({
    connectionString: resolveDatabaseUrl(databaseUrl)
  });
}

export async function checkDatabaseConnection(
  databaseUrl?: string
): Promise<ServiceCheck> {
  const pool = createDatabasePool(databaseUrl);

  try {
    await pool.query("select 1");

    return {
      ok: true,
      summary: "database connection healthy"
    };
  } catch (error) {
    return {
      ok: false,
      summary:
        error instanceof Error
          ? `database connection failed: ${error.message || String(error)}`
          : "database connection failed"
    };
  } finally {
    await pool.end();
  }
}
