import {
  type ApplicationVersionInfo,
  type ErrorReportingConfig,
  type RuntimeEnvironment,
  type ServiceCheck,
  type ServiceName
} from "@openmirage/types";
import * as Sentry from "@sentry/node";
import { randomUUID } from "node:crypto";

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
  version: string;
  level?: "debug" | "info";
  baseFields?: LogFields;
}

interface LogRecord extends LogFields {
  environment: RuntimeEnvironment;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  service: ServiceName;
  timestamp: string;
  version: string;
}

export interface MetricLabels {
  [key: string]: string | number;
}

export interface MetricDefinition {
  help: string;
  labelNames?: string[];
  name: string;
  type: "counter" | "gauge" | "histogram";
}

export interface CounterMetric {
  inc(labels?: MetricLabels, value?: number): void;
}

export interface GaugeMetric {
  inc(labels?: MetricLabels, value?: number): void;
  set(labels?: MetricLabels, value?: number): void;
}

export interface HistogramMetric {
  observe(labels?: MetricLabels, value?: number): void;
}

export interface MetricsRegistry {
  counter(definition: MetricDefinition): CounterMetric;
  gauge(definition: MetricDefinition): GaugeMetric;
  histogram(
    definition: MetricDefinition & { buckets?: number[] }
  ): HistogramMetric;
  render(): string;
}

export interface HttpMetrics {
  requestDurationSeconds: HistogramMetric;
  requestsTotal: CounterMetric;
}

export interface ErrorReporter {
  captureException(error: unknown, context?: LogFields): void;
  enabled: boolean;
  flush(timeoutMs?: number): Promise<boolean>;
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

function serializeLabels(
  labels: MetricLabels | undefined,
  labelNames: string[]
): string {
  if (labelNames.length === 0) {
    return "";
  }

  const normalized = labelNames
    .map((name) => `${name}="${String(labels?.[name] ?? "")}"`)
    .join(",");

  return `{${normalized}}`;
}

function escapeHelp(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}

function escapeLabelValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}

function formatMetricLabels(
  labels: MetricLabels | undefined,
  labelNames: string[]
): string {
  if (labelNames.length === 0) {
    return "";
  }

  const normalized = labelNames
    .map(
      (name) => `${name}="${escapeLabelValue(String(labels?.[name] ?? ""))}"`
    )
    .join(",");

  return `{${normalized}}`;
}

function normalizeMetricArgs(
  labelsOrValue?: MetricLabels | number,
  maybeValue?: number
): { labels: MetricLabels | undefined; value: number } {
  if (typeof labelsOrValue === "number") {
    return {
      labels: undefined,
      value: labelsOrValue
    };
  }

  return {
    labels: labelsOrValue,
    value: maybeValue ?? 1
  };
}

function normalizeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      error_message: error.message,
      error_name: error.name,
      error_stack: error.stack
    };
  }

  return {
    error_message: String(error),
    error_name: "NonError"
  };
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
      timestamp: new Date().toISOString(),
      version: options.version
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

class BaseMetricStore {
  readonly definition: MetricDefinition;
  readonly labelNames: string[];
  readonly samples = new Map<
    string,
    { labels: MetricLabels | undefined; value: number }
  >();

  constructor(definition: MetricDefinition) {
    this.definition = definition;
    this.labelNames = definition.labelNames ?? [];
  }

  protected ensureSample(labels?: MetricLabels): {
    labels: MetricLabels | undefined;
    value: number;
  } {
    const key = serializeLabels(labels, this.labelNames);
    const existing = this.samples.get(key);

    if (existing) {
      return existing;
    }

    const sample = {
      labels,
      value: 0
    };

    this.samples.set(key, sample);
    return sample;
  }
}

class CounterStore extends BaseMetricStore implements CounterMetric {
  inc(labelsOrValue?: MetricLabels | number, maybeValue?: number): void {
    const { labels, value } = normalizeMetricArgs(labelsOrValue, maybeValue);
    const sample = this.ensureSample(labels);
    sample.value += value;
  }
}

class GaugeStore extends BaseMetricStore implements GaugeMetric {
  inc(labelsOrValue?: MetricLabels | number, maybeValue?: number): void {
    const { labels, value } = normalizeMetricArgs(labelsOrValue, maybeValue);
    const sample = this.ensureSample(labels);
    sample.value += value;
  }

  set(labelsOrValue?: MetricLabels | number, maybeValue?: number): void {
    const { labels, value } = normalizeMetricArgs(labelsOrValue, maybeValue);
    const sample = this.ensureSample(labels);
    sample.value = value;
  }
}

class HistogramStore implements HistogramMetric {
  readonly definition: MetricDefinition;
  readonly labelNames: string[];
  readonly buckets: number[];
  readonly bucketSamples = new Map<
    string,
    { counts: number[]; labels: MetricLabels | undefined; sum: number }
  >();

  constructor(definition: MetricDefinition & { buckets?: number[] }) {
    this.definition = definition;
    this.labelNames = definition.labelNames ?? [];
    this.buckets = definition.buckets ?? [0.01, 0.05, 0.1, 0.3, 1, 3, 10];
  }

  observe(labelsOrValue?: MetricLabels | number, maybeValue?: number): void {
    const { labels, value } = normalizeMetricArgs(labelsOrValue, maybeValue);
    const key = serializeLabels(labels, this.labelNames);
    const existing = this.bucketSamples.get(key) ?? {
      labels,
      counts: [...Array.from({ length: this.buckets.length + 1 }, () => 0)],
      sum: 0
    };

    let matchedBucket = false;

    for (const [index, bucket] of this.buckets.entries()) {
      if (value <= bucket) {
        existing.counts[index] = (existing.counts[index] ?? 0) + 1;
        matchedBucket = true;
        break;
      }
    }

    if (!matchedBucket) {
      existing.counts[this.buckets.length] =
        (existing.counts[this.buckets.length] ?? 0) + 1;
    }
    existing.sum += value;
    this.bucketSamples.set(key, existing);
  }
}

export function createMetricsRegistry(): MetricsRegistry {
  const metrics: Array<BaseMetricStore | HistogramStore> = [];

  return {
    counter(definition) {
      const metric = new CounterStore(definition);
      metrics.push(metric);
      return metric;
    },
    gauge(definition) {
      const metric = new GaugeStore(definition);
      metrics.push(metric);
      return metric;
    },
    histogram(definition) {
      const metric = new HistogramStore(definition);
      metrics.push(metric);
      return metric;
    },
    render() {
      const lines: string[] = [];

      for (const metric of metrics) {
        lines.push(
          `# HELP ${metric.definition.name} ${escapeHelp(metric.definition.help)}`
        );
        lines.push(
          `# TYPE ${metric.definition.name} ${metric.definition.type}`
        );

        if (metric instanceof HistogramStore) {
          for (const sample of metric.bucketSamples.values()) {
            let cumulative = 0;

            for (const [index, bucket] of metric.buckets.entries()) {
              cumulative += sample.counts[index] ?? 0;
              lines.push(
                `${metric.definition.name}_bucket${formatMetricLabels(
                  {
                    ...sample.labels,
                    le: bucket
                  },
                  [...metric.labelNames, "le"]
                )} ${cumulative}`
              );
            }

            cumulative += sample.counts[metric.buckets.length] ?? 0;
            lines.push(
              `${metric.definition.name}_bucket${formatMetricLabels(
                {
                  ...sample.labels,
                  le: "+Inf"
                },
                [...metric.labelNames, "le"]
              )} ${cumulative}`
            );
            lines.push(
              `${metric.definition.name}_sum${formatMetricLabels(
                sample.labels,
                metric.labelNames
              )} ${sample.sum}`
            );
            lines.push(
              `${metric.definition.name}_count${formatMetricLabels(
                sample.labels,
                metric.labelNames
              )} ${cumulative}`
            );
          }

          continue;
        }

        for (const sample of metric.samples.values()) {
          lines.push(
            `${metric.definition.name}${formatMetricLabels(
              sample.labels,
              metric.labelNames
            )} ${sample.value}`
          );
        }
      }

      return `${lines.join("\n")}\n`;
    }
  };
}

export function createHttpMetrics(
  registry: MetricsRegistry,
  service: ServiceName
): HttpMetrics {
  const requestsTotal = registry.counter({
    name: "openmirage_http_requests_total",
    help: "Total number of HTTP requests served",
    labelNames: ["service", "method", "route", "status_code"],
    type: "counter"
  });
  const requestDurationSeconds = registry.histogram({
    name: "openmirage_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["service", "method", "route", "status_code"],
    type: "histogram"
  });

  requestsTotal.inc(
    {
      method: "GET",
      route: "/metrics",
      service,
      status_code: 200
    },
    0
  );

  return {
    requestDurationSeconds,
    requestsTotal
  };
}

export function registerServiceInfoMetrics(
  registry: MetricsRegistry,
  service: ServiceName,
  environment: RuntimeEnvironment,
  versionInfo: ApplicationVersionInfo
): void {
  const serviceInfo = registry.gauge({
    name: "openmirage_service_info",
    help: "Static information about the running service",
    labelNames: ["service", "environment", "version", "release"],
    type: "gauge"
  });
  const appSchemaInfo = registry.gauge({
    name: "openmirage_app_schema_info",
    help: "Application release and schema version info",
    labelNames: ["service", "release", "schema_version"],
    type: "gauge"
  });

  serviceInfo.set(
    {
      environment,
      release: versionInfo.release,
      service,
      version: versionInfo.release
    },
    1
  );
  appSchemaInfo.set(
    {
      release: versionInfo.release,
      schema_version: versionInfo.schemaVersion,
      service
    },
    1
  );
}

export function createRequestId(candidate?: string): string {
  return candidate && candidate.trim() ? candidate.trim() : randomUUID();
}

export function initErrorReporter(
  config: ErrorReportingConfig,
  logger: ServiceLogger
): ErrorReporter {
  if (!config.enabled || !config.dsn) {
    logger.info("error reporting disabled", {
      sentryEnabled: false
    });

    return {
      captureException(error, context) {
        logger.debug("error reporting skipped", {
          ...normalizeError(error),
          ...context
        });
      },
      enabled: false,
      async flush() {
        return true;
      }
    };
  }

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    sendDefaultPii: false
  });

  logger.info("error reporting enabled", {
    sentryEnabled: true
  });

  return {
    captureException(error, context) {
      Sentry.withScope((scope) => {
        for (const [key, value] of Object.entries(context ?? {})) {
          if (value !== undefined) {
            scope.setTag(key, String(value));
          }
        }

        scope.setTag("environment", config.environment);
        scope.setTag("release", config.release);
        Sentry.captureException(
          error instanceof Error ? error : new Error(String(error))
        );
      });
    },
    enabled: true,
    flush(timeoutMs = 2_000) {
      return Sentry.flush(timeoutMs);
    }
  };
}

export function registerProcessErrorHandlers(
  logger: ServiceLogger,
  reporter: ErrorReporter
): void {
  process.on("uncaughtException", (error) => {
    logger.error("uncaught exception", normalizeError(error));
    reporter.captureException(error, {
      event: "uncaughtException"
    });
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled rejection", normalizeError(reason));
    reporter.captureException(reason, {
      event: "unhandledRejection"
    });
  });
}

export function createErrorLogFields(
  error: unknown,
  extraFields?: LogFields
): LogFields {
  return {
    ...normalizeError(error),
    ...extraFields
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
