import { requireFlagValue, runNodePgMigrate } from "./_helpers.mjs";

const name = requireFlagValue("--name");

runNodePgMigrate(["create", name, "--migrations-dir", "./migrations"]);
