import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

function normalizePath(filePath) {
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
}

function parseArgs(argv) {
  const files = [];
  let format = "lcov";
  let reportFile = resolve(process.cwd(), "coverage/lcov.info");

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--format") {
      format = argv[index + 1] ?? format;
      index += 1;
      continue;
    }

    if (arg === "--report-file") {
      reportFile = normalizePath(argv[index + 1] ?? reportFile);
      index += 1;
      continue;
    }

    files.push(arg);
  }

  return {
    files,
    format,
    reportFile
  };
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

function readLcovCoverage(reportFile) {
  if (!existsSync(reportFile)) {
    throw new Error(`coverage file not found at ${reportFile}`);
  }

  const coverageByFile = new Map();
  let currentFile = null;

  for (const line of readFileSync(reportFile, "utf8").split("\n")) {
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

function parseUncoveredLines(rawValue) {
  const uncoveredLines = new Set();

  for (const token of rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const rangeMatch = token.match(/^(\d+)-(\d+)$/);

    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1] ?? "0", 10);
      const end = Number.parseInt(rangeMatch[2] ?? "0", 10);

      for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
        uncoveredLines.add(lineNumber);
      }

      continue;
    }

    const lineNumber = Number.parseInt(token, 10);

    if (!Number.isNaN(lineNumber)) {
      uncoveredLines.add(lineNumber);
    }
  }

  return uncoveredLines;
}

function readNodeTestCoverage(reportFile) {
  if (!existsSync(reportFile)) {
    throw new Error(`coverage report not found at ${reportFile}`);
  }

  const coverageByFile = new Map();

  for (const line of readFileSync(reportFile, "utf8").split("\n")) {
    if (!line.startsWith("# ")) {
      continue;
    }

    const trimmed = line.slice(2).trim();

    if (
      trimmed.startsWith("-") ||
      trimmed.startsWith("file") ||
      trimmed.startsWith("all files") ||
      trimmed.startsWith("start of coverage report") ||
      trimmed.startsWith("end of coverage report")
    ) {
      continue;
    }

    const columns = trimmed.split("|").map((column) => column.trim());

    if (columns.length < 4) {
      continue;
    }

    const filePath = columns[0];

    if (!filePath || filePath === "file") {
      continue;
    }

    coverageByFile.set(normalizePath(filePath), {
      uncoveredLines: parseUncoveredLines(columns[4] ?? "")
    });
  }

  return coverageByFile;
}

function verifyLcov(files, changedLinesByFile, reportFile) {
  const coverageByFile = readLcovCoverage(reportFile);
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

  return uncovered;
}

function verifyNodeTestCoverage(files, changedLinesByFile, reportFile) {
  const coverageByFile = readNodeTestCoverage(reportFile);
  const uncovered = [];

  for (const file of files) {
    const changedLines = changedLinesByFile.get(file) ?? new Set();

    if (changedLines.size === 0) {
      continue;
    }

    const fileCoverage = coverageByFile.get(normalizePath(file));

    if (!fileCoverage) {
      uncovered.push(`${file}: missing coverage data`);
      continue;
    }

    for (const lineNumber of changedLines) {
      if (fileCoverage.uncoveredLines.has(lineNumber)) {
        uncovered.push(`${file}:${lineNumber}`);
      }
    }
  }

  return uncovered;
}

function main() {
  const { files, format, reportFile } = parseArgs(process.argv.slice(2));

  if (files.length === 0) {
    throw new Error("expected one or more source files to verify");
  }

  const changedLinesByFile = readChangedLines(files);
  const uncovered =
    format === "node-test-coverage"
      ? verifyNodeTestCoverage(files, changedLinesByFile, reportFile)
      : verifyLcov(files, changedLinesByFile, reportFile);

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
