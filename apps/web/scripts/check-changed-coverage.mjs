import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

function normalizePath(filePath) {
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
}

function parseChangedLinesFromDiff(diffOutput) {
  const changedLinesByFile = new Map();
  let currentFile = null;

  for (const line of diffOutput.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
      if (!changedLinesByFile.has(currentFile)) {
        changedLinesByFile.set(currentFile, new Set());
      }
      continue;
    }

    if (!currentFile || !line.startsWith("@@")) {
      continue;
    }

    const match = line.match(/\+(\d+)(?:,(\d+))?/);

    if (!match) {
      continue;
    }

    const start = Number.parseInt(match[1] ?? "0", 10);
    const count = Number.parseInt(match[2] ?? "1", 10);
    const changedLines = changedLinesByFile.get(currentFile);

    if (!changedLines) {
      continue;
    }

    for (let lineNumber = start; lineNumber < start + count; lineNumber += 1) {
      changedLines.add(lineNumber);
    }
  }

  return changedLinesByFile;
}

function readChangedLines(files) {
  const diffOutput = execFileSync(
    "git",
    ["diff", "--unified=0", "--relative", "HEAD", "--", ...files],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );
  const changedLinesByFile = parseChangedLinesFromDiff(diffOutput);

  const untrackedFilesOutput = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "--", ...files],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  for (const untrackedFile of untrackedFilesOutput
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const absolutePath = normalizePath(untrackedFile);
    const lineCount = readFileSync(absolutePath, "utf8").split("\n").length;
    const changedLines = new Set();

    for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
      changedLines.add(lineNumber);
    }

    changedLinesByFile.set(untrackedFile, changedLines);
  }

  return changedLinesByFile;
}

function readCoverageByFile() {
  const lcovPath = resolve(process.cwd(), "coverage/lcov.info");

  if (!existsSync(lcovPath)) {
    throw new Error(`coverage file not found at ${lcovPath}`);
  }

  const coverageByFile = new Map();
  let currentFile = null;

  for (const line of readFileSync(lcovPath, "utf8").split("\n")) {
    if (line.startsWith("SF:")) {
      currentFile = normalizePath(line.slice(3));
      coverageByFile.set(currentFile, new Map());
      continue;
    }

    if (!currentFile || !line.startsWith("DA:")) {
      continue;
    }

    const [lineNumberRaw, hitCountRaw] = line.slice(3).split(",");
    const lineNumber = Number.parseInt(lineNumberRaw ?? "0", 10);
    const hitCount = Number.parseInt(hitCountRaw ?? "0", 10);

    coverageByFile.get(currentFile)?.set(lineNumber, hitCount);
  }

  return coverageByFile;
}

function main() {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    throw new Error("expected one or more source files to verify");
  }

  const changedLinesByFile = readChangedLines(files);
  const coverageByFile = readCoverageByFile();
  const uncovered = [];

  for (const file of files) {
    const changedLines = changedLinesByFile.get(file) ?? new Set();

    if (changedLines.size === 0) {
      continue;
    }

    const lineHits = coverageByFile.get(normalizePath(file));

    if (!lineHits) {
      uncovered.push(`${file}: missing coverage data`);
      continue;
    }

    for (const lineNumber of changedLines) {
      if (!lineHits.has(lineNumber)) {
        continue;
      }

      const hitCount = lineHits.get(lineNumber) ?? 0;

      if (hitCount < 1) {
        uncovered.push(`${file}:${lineNumber}`);
      }
    }
  }

  if (uncovered.length > 0) {
    console.error("[openmirage] changed-line coverage failed");
    for (const entry of uncovered) {
      console.error(`- ${entry}`);
    }
    process.exit(1);
  }

  console.log("[openmirage] changed-line coverage passed");
}

main();
