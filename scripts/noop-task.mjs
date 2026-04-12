import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [task = "task", workspace = "workspace"] = process.argv.slice(2);

if (task === "build") {
  const distDir = resolve(process.cwd(), "dist");
  mkdirSync(distDir, { recursive: true });
  writeFileSync(
    resolve(distDir, ".openmirage-placeholder"),
    `${workspace}\n`,
    "utf8"
  );
}

console.log(`[openmirage] ${workspace}: ${task} placeholder complete`);
