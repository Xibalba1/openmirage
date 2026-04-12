import {
  type RuntimeEnvironment,
  type ServiceCheck,
  type ServiceName
} from "@openmirage/types";

export interface LogFields {
  [key: string]: boolean | number | string | undefined;
}

export interface ServiceLogger {
  child(fields: LogFields): ServiceLogger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  service: ServiceName;
  environment: RuntimeEnvironment;
  level?: "debug" | "info";
  baseFields?: LogFields;
}

interface LogRecord extends LogFields {
  environment: RuntimeEnvironment;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  service: ServiceName;
  timestamp: string;
}

function shouldLog(
  configuredLevel: "debug" | "info",
  nextLevel: LogRecord["level"]
): boolean {
  if (configuredLevel === "debug") {
    return true;
  }

  return nextLevel !== "debug";
}

function writeLog(record: LogRecord): void {
  console.log(JSON.stringify(record));
}

export function createServiceLogger(options: LoggerOptions): ServiceLogger {
  const baseFields = options.baseFields ?? {};
  const configuredLevel = options.level ?? "info";

  function log(level: LogRecord["level"], message: string, fields?: LogFields) {
    if (!shouldLog(configuredLevel, level)) {
      return;
    }

    writeLog({
      ...baseFields,
      ...fields,
      environment: options.environment,
      level,
      message,
      service: options.service,
      timestamp: new Date().toISOString()
    });
  }

  return {
    child(fields) {
      return createServiceLogger({
        ...options,
        baseFields: {
          ...baseFields,
          ...fields
        }
      });
    },
    debug(message, fields) {
      log("debug", message, fields);
    },
    info(message, fields) {
      log("info", message, fields);
    },
    warn(message, fields) {
      log("warn", message, fields);
    },
    error(message, fields) {
      log("error", message, fields);
    }
  };
}

export function summarizeChecks(
  checks: Record<string, ServiceCheck>
): Record<string, string> {
  const details: Record<string, string> = {};

  for (const [name, check] of Object.entries(checks)) {
    details[name] = check.summary;
  }

  return details;
}
