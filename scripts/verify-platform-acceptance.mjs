import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const evidenceFile =
  process.env.OPENMIRAGE_ACCEPTANCE_EVIDENCE_FILE ??
  path.join(repoRoot, "ops", "platform-acceptance-evidence.json");

const assetAudit = [
  {
    label: "CI workflow",
    path: ".github/workflows/ci.yml",
    classification: "reuse as-is"
  },
  {
    label: "staging deploy workflow",
    path: ".github/workflows/staging-deploy.yml",
    classification: "reuse as-is"
  },
  {
    label: "local prerequisite verifier",
    path: "scripts/verify-platform-prereqs.mjs",
    classification: "reuse as-is"
  },
  {
    label: "local infra verifier",
    path: "scripts/verify-platform-infra.mjs",
    classification: "reuse as-is"
  },
  {
    label: "local MVP browser smoke verifier",
    path: "scripts/verify-mvp-browser-smoke.mjs",
    classification: "new canonical acceptance step"
  },
  {
    label: "repo operator guidance",
    path: "README.md",
    classification: "reuse with doc updates"
  },
  {
    label: "acceptance runbook",
    path: "ops/platform-acceptance.md",
    classification: "gap closed in step 13"
  },
  {
    label: "external evidence contract",
    path: "ops/platform-acceptance-evidence.example.json",
    classification: "gap closed in step 13"
  }
];

function log(message) {
  console.log(`[openmirage] ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
    ...options
  });

  return {
    ok: result.status === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join("").trim()
  };
}

function printChecklist(results) {
  console.log("[openmirage] acceptance checklist:");

  for (const result of results) {
    console.log(
      `[openmirage] - ${result.name}: ${result.status.toUpperCase()} - ${result.detail}`
    );
  }
}

function recordAssetInventory() {
  const missingAssets = assetAudit.filter((asset) => !existsSync(asset.path));

  if (missingAssets.length > 0) {
    return {
      name: "existing-step inventory",
      status: "fail",
      detail: `missing required acceptance asset(s): ${missingAssets
        .map((asset) => asset.path)
        .join(", ")}`
    };
  }

  return {
    name: "existing-step inventory",
    status: "pass",
    detail: assetAudit
      .map((asset) => `${asset.label} (${asset.classification})`)
      .join("; ")
  };
}

function validateBoolean(value) {
  return value === true;
}

function validateExternalEvidence() {
  if (!existsSync(evidenceFile)) {
    return [
      {
        name: "staging acceptance",
        status: "blocked",
        detail: `missing operator-managed evidence file ${path.relative(repoRoot, evidenceFile)}`
      },
      {
        name: "backup/restore acceptance",
        status: "blocked",
        detail: `missing operator-managed evidence file ${path.relative(repoRoot, evidenceFile)}`
      }
    ];
  }

  let evidence;

  try {
    evidence = JSON.parse(readFileSync(evidenceFile, "utf8"));
  } catch (error) {
    return [
      {
        name: "staging acceptance",
        status: "fail",
        detail: `could not parse evidence file: ${
          error instanceof Error ? error.message : String(error)
        }`
      },
      {
        name: "backup/restore acceptance",
        status: "fail",
        detail: `could not parse evidence file: ${
          error instanceof Error ? error.message : String(error)
        }`
      }
    ];
  }

  const staging = evidence.staging ?? {};
  const backupRestore = evidence.backupRestore ?? {};
  const stagingFields = [
    "workflowRunUrl",
    "gitSha",
    "publicBaseUrl",
    "verifiedAt",
    "fullMvpSmokeVerifiedAt",
    "twoUserCollaborationVerifiedAt",
    "secureCookiesVerifiedAt",
    "observabilityVerifiedAt",
    "freshVpsVerifiedAt",
    "freshVpsTarget",
    "errorReportingVerifiedAt",
    "errorReportingReference",
    "remainingItemsReference"
  ];
  const backupFields = [
    "artifactLocation",
    "backupCreatedAt",
    "restoreVerifiedAt",
    "restoreTarget"
  ];
  const missingStagingFields = stagingFields.filter(
    (field) => typeof staging[field] !== "string" || staging[field].length === 0
  );
  const missingBackupFields = backupFields.filter(
    (field) =>
      typeof backupRestore[field] !== "string" ||
      backupRestore[field].length === 0
  );

  const stagingBooleans = [
    ["sameArtifactsAsCi", staging.sameArtifactsAsCi],
    ["publicOriginVerified", staging.publicOriginVerified],
    ["websocketUpgradeVerified", staging.websocketUpgradeVerified],
    ["secureCookiesVerified", staging.secureCookiesVerified],
    ["observabilityVerified", staging.observabilityVerified],
    ["fullMvpSmokeVerified", staging.fullMvpSmokeVerified],
    ["twoUserCollaborationVerified", staging.twoUserCollaborationVerified],
    ["freshVpsPreparedFromRunbook", staging.freshVpsPreparedFromRunbook],
    ["errorReportingSinkVerified", staging.errorReportingSinkVerified],
    ["remainingItemsNonBlocking", staging.remainingItemsNonBlocking]
  ].filter(([, value]) => !validateBoolean(value));
  const backupBooleans = [
    ["postRestoreSmokeVerified", backupRestore.postRestoreSmokeVerified]
  ].filter(([, value]) => !validateBoolean(value));

  const stagingResult =
    missingStagingFields.length === 0 && stagingBooleans.length === 0
      ? {
          name: "staging acceptance",
          status: "pass",
          detail:
            `workflow ${staging.workflowRunUrl} verified ${staging.publicBaseUrl} at ${staging.verifiedAt}; ` +
            `full MVP smoke recorded at ${staging.fullMvpSmokeVerifiedAt}; ` +
            `two-user collaboration recorded at ${staging.twoUserCollaborationVerifiedAt}; ` +
            `fresh VPS proof recorded for ${staging.freshVpsTarget} at ${staging.freshVpsVerifiedAt}; ` +
            `error reporting verified at ${staging.errorReportingVerifiedAt}`
        }
      : {
          name: "staging acceptance",
          status: "blocked",
          detail: [
            missingStagingFields.length > 0
              ? `missing fields: ${missingStagingFields.join(", ")}`
              : null,
            stagingBooleans.length > 0
              ? `unset verification flags: ${stagingBooleans
                  .map(([field]) => field)
                  .join(", ")}`
              : null
          ]
            .filter(Boolean)
            .join("; ")
        };

  const backupResult =
    missingBackupFields.length === 0 && backupBooleans.length === 0
      ? {
          name: "backup/restore acceptance",
          status: "pass",
          detail: `artifact ${backupRestore.artifactLocation} restored into ${backupRestore.restoreTarget} at ${backupRestore.restoreVerifiedAt}`
        }
      : {
          name: "backup/restore acceptance",
          status: "blocked",
          detail: [
            missingBackupFields.length > 0
              ? `missing fields: ${missingBackupFields.join(", ")}`
              : null,
            backupBooleans.length > 0
              ? `unset verification flags: ${backupBooleans
                  .map(([field]) => field)
                  .join(", ")}`
              : null
          ]
            .filter(Boolean)
            .join("; ")
        };

  return [stagingResult, backupResult];
}

function determineExitCode(results) {
  return results.every((result) => result.status === "pass") ? 0 : 1;
}

function summarizeDecision(results) {
  if (results.some((result) => result.status === "fail")) {
    return "fail";
  }

  if (results.some((result) => result.status === "blocked")) {
    return "blocked";
  }

  return "pass";
}

async function main() {
  console.log(
    "before modifying any code, identify any prerequisites to your work that you cannot accomplish (ex: software installs on the local machine). check those prerequisites (pass or fail), if any fail, do not proceed. output the failures and provide procedural, step-by-step instructions on how to complete/fulfill the failing prerequisites"
  );

  const results = [];

  log("auditing acceptance assets");
  results.push(recordAssetInventory());

  log("running prerequisite gate");
  const prereqs = run("node", ["./scripts/verify-platform-prereqs.mjs"]);
  results.push({
    name: "prerequisite gate",
    status: prereqs.ok ? "pass" : "fail",
    detail: prereqs.ok
      ? "pnpm, Docker, Docker Compose, ports, and baseline dependency startup verified"
      : prereqs.output || "prerequisite verification failed"
  });

  if (prereqs.ok) {
    log("running local infra acceptance flow");
    const localInfraAcceptance = run(
      "node",
      ["./scripts/verify-platform-infra.mjs"],
      {
        env: {
          ...process.env,
          ENABLE_TEST_ERROR_ROUTES: "true",
          OPENMIRAGE_VERIFY_ERROR_ROUTE: "true"
        },
        maxBuffer: 1024 * 1024 * 20
      }
    );

    results.push({
      name: "local infra acceptance",
      status: localInfraAcceptance.ok ? "pass" : "fail",
      detail: localInfraAcceptance.ok
        ? "Caddy-routed local boot, auth, storage, collab, worker, metrics, logs, and diagnostics error route verified"
        : localInfraAcceptance.output ||
          "local infra acceptance verification failed"
    });

    if (localInfraAcceptance.ok) {
      log("running local MVP browser smoke");
      const localBrowserAcceptance = run(
        "node",
        ["./scripts/verify-mvp-browser-smoke.mjs"],
        {
          maxBuffer: 1024 * 1024 * 20
        }
      );

      results.push({
        name: "local MVP browser smoke",
        status: localBrowserAcceptance.ok ? "pass" : "fail",
        detail: localBrowserAcceptance.ok
          ? "sign-in, file/page authoring, collaboration, comments, inspect, sharing, asset upload, and export flows verified through the browser"
          : localBrowserAcceptance.output ||
            "local MVP browser smoke verification failed"
      });
    } else {
      results.push({
        name: "local MVP browser smoke",
        status: "blocked",
        detail: "skipped because the local infra acceptance flow failed"
      });
    }
  } else {
    results.push({
      name: "local infra acceptance",
      status: "blocked",
      detail: "skipped because the prerequisite gate failed"
    });
    results.push({
      name: "local MVP browser smoke",
      status: "blocked",
      detail: "skipped because the prerequisite gate failed"
    });
  }

  log("checking external staging and backup evidence");
  results.push(...validateExternalEvidence());

  const finalDecision = summarizeDecision(results);
  printChecklist(results);
  log(`final acceptance decision: ${finalDecision.toUpperCase()}`);
  process.exitCode = determineExitCode(results);
}

await main();
