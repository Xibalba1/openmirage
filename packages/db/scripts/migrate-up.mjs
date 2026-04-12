import { runNodePgMigrate } from "./_helpers.mjs";

runNodePgMigrate([
  "up",
  "--migrations-dir",
  "./migrations",
  "--database-url-var",
  "DATABASE_URL"
]);
