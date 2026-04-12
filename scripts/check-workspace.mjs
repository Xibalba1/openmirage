import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const [workspaceArg = "."] = process.argv.slice(2);
const workspaceDir = resolve(process.cwd(), workspaceArg);
const packageJsonPath = resolve(workspaceDir, "package.json");
const srcDir = resolve(workspaceDir, "src");

const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));

if (!pkg.name) {
  throw new Error(`Missing package name in ${packageJsonPath}`);
}

if (!existsSync(srcDir) && !pkg.name.startsWith("@openmirage/config-")) {
  throw new Error(`Expected src directory for ${pkg.name}`);
}

console.log(`[openmirage] ${pkg.name}: placeholder checks passed`);
