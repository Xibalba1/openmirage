import { seedDevelopmentBootstrap } from "../src/index.ts";
import { loadScriptEnv } from "./_helpers.mjs";

const env = loadScriptEnv();
const summary = await seedDevelopmentBootstrap(env.DATABASE_URL);

console.log("[openmirage] development bootstrap summary");
console.log(
  JSON.stringify(
    {
      file: summary.file,
      magicLinkToken: summary.magicLinkToken,
      membership: summary.membership,
      page: summary.page,
      pages: summary.pages,
      project: summary.project,
      session: summary.session,
      user: summary.user,
      workspace: summary.workspace
    },
    null,
    2
  )
);
