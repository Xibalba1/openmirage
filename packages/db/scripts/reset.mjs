import { Client } from "pg";
import { loadScriptEnv } from "./_helpers.mjs";

const env = loadScriptEnv();
const client = new Client({
  connectionString: env.DATABASE_URL
});

try {
  await client.connect();
  await client.query(`
    drop schema if exists public cascade;
    create schema public;
    grant all on schema public to current_user;
    grant all on schema public to public;
  `);
  console.log("[openmirage] database reset complete");
} finally {
  await client.end();
}
