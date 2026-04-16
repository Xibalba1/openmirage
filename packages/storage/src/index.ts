import {
  DeleteObjectCommand,
  type DeleteObjectCommandOutput,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadBucketCommand,
  type HeadBucketCommandOutput,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  type PutObjectCommandOutput,
  S3Client,
  CreateBucketCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  type ServiceCheck,
  type StorageConfig,
  type StorageDeleteResult,
  type StorageHealthStatus,
  type StorageObjectDescriptor,
  type StoragePutInput,
  type StorageReadResult,
  type S3StorageConfig
} from "@openmirage/types";

export interface StorageAdapter {
  delete(key: string): Promise<StorageDeleteResult>;
  ensureBucket(): Promise<void>;
  healthCheck(): Promise<StorageHealthStatus>;
  list(prefix?: string): Promise<StorageObjectDescriptor[]>;
  put(input: StoragePutInput): Promise<StorageObjectDescriptor>;
  read(key: string): Promise<StorageReadResult>;
  resolveDownloadUrl(key: string): Promise<string>;
}

export interface StorageFactoryOptions {
  s3Client?: S3ClientLike;
}

export interface S3ClientLike {
  send(
    command:
      | CreateBucketCommand
      | DeleteObjectCommand
      | GetObjectCommand
      | HeadBucketCommand
      | ListObjectsV2Command
      | PutObjectCommand
  ): Promise<
    | DeleteObjectCommandOutput
    | GetObjectCommandOutput
    | HeadBucketCommandOutput
    | ListObjectsV2CommandOutput
    | PutObjectCommandOutput
  >;
}

interface ByteReadableBody {
  transformToByteArray?: () => Promise<Uint8Array>;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | Buffer | string>;
}

async function readBodyToUint8Array(
  body: ByteReadableBody | Uint8Array | Buffer | string | undefined
): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array();
  }

  if (body instanceof Uint8Array) {
    return body;
  }

  if (Buffer.isBuffer(body)) {
    return new Uint8Array(body);
  }

  if (typeof body === "string") {
    return new Uint8Array(Buffer.from(body));
  }

  if (typeof body.transformToByteArray === "function") {
    return body.transformToByteArray();
  }

  if (typeof body[Symbol.asyncIterator] === "function") {
    const asyncIterable = body as AsyncIterable<Uint8Array | Buffer | string>;
    const chunks: Buffer[] = [];

    for await (const chunk of asyncIterable) {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : typeof chunk === "string"
            ? Buffer.from(chunk)
            : Buffer.from(chunk)
      );
    }

    return new Uint8Array(Buffer.concat(chunks));
  }

  throw new Error("Unsupported storage body type");
}

class LocalStorageAdapter implements StorageAdapter {
  readonly #bucketPath: string;
  readonly #bucketName: string;
  readonly #rootDirectory: string;
  readonly #provider: StorageConfig["provider"];

  constructor(config: Extract<StorageConfig, { provider: "local" }>) {
    this.#rootDirectory = resolve(config.rootDirectory);
    this.#bucketPath = resolve(this.#rootDirectory, config.bucket);
    this.#bucketName = config.bucket;
    this.#provider = config.provider;
  }

  async ensureBucket(): Promise<void> {
    await mkdir(this.#bucketPath, { recursive: true });
  }

  async put(input: StoragePutInput): Promise<StorageObjectDescriptor> {
    const targetPath = this.#resolveKeyPath(input.key);

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, input.body);
    const fileStats = await stat(targetPath);

    return {
      key: input.key,
      size: fileStats.size,
      lastModified: fileStats.mtime.toISOString()
    };
  }

  async list(prefix = ""): Promise<StorageObjectDescriptor[]> {
    await this.ensureBucket();

    const entries: StorageObjectDescriptor[] = [];

    async function walk(
      currentPath: string,
      bucketPath: string
    ): Promise<void> {
      const childEntries = await readdir(currentPath, { withFileTypes: true });

      for (const entry of childEntries) {
        const nextPath = join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await walk(nextPath, bucketPath);
          continue;
        }

        const fileStats = await stat(nextPath);
        const key = relative(bucketPath, nextPath).split("\\").join("/");

        entries.push({
          key,
          size: fileStats.size,
          lastModified: fileStats.mtime.toISOString()
        });
      }
    }

    await walk(this.#bucketPath, this.#bucketPath);

    return entries
      .filter((entry) => entry.key.startsWith(prefix))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async resolveDownloadUrl(key: string): Promise<string> {
    const targetPath = this.#resolveKeyPath(key);
    await stat(targetPath);
    return pathToFileURL(targetPath).toString();
  }

  async read(key: string): Promise<StorageReadResult> {
    const targetPath = this.#resolveKeyPath(key);

    return {
      body: await readFile(targetPath)
    };
  }

  async delete(key: string): Promise<StorageDeleteResult> {
    const targetPath = this.#resolveKeyPath(key);
    await rm(targetPath, { force: true });
    return { key };
  }

  async healthCheck(): Promise<StorageHealthStatus> {
    try {
      await this.ensureBucket();
      return {
        ok: true,
        provider: this.#provider,
        bucket: this.#bucketName,
        summary: "local storage ready"
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.#provider,
        bucket: this.#bucketName,
        summary: error instanceof Error ? error.message : String(error)
      };
    }
  }

  #resolveKeyPath(key: string): string {
    const targetPath = resolve(this.#bucketPath, key);

    if (
      !targetPath.startsWith(`${this.#bucketPath}/`) &&
      targetPath !== this.#bucketPath
    ) {
      throw new Error(`Storage key escapes bucket root: ${key}`);
    }

    return targetPath;
  }
}

class S3StorageAdapter implements StorageAdapter {
  readonly #client: S3ClientLike;
  readonly #config: S3StorageConfig;

  constructor(config: S3StorageConfig, client?: S3ClientLike) {
    this.#config = config;
    this.#client =
      client ??
      new S3Client({
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey
        },
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
        region: config.region
      });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.#client.send(
        new HeadBucketCommand({
          Bucket: this.#config.bucket
        })
      );
    } catch {
      await this.#client.send(
        new CreateBucketCommand({
          Bucket: this.#config.bucket
        })
      );
    }
  }

  async put(input: StoragePutInput): Promise<StorageObjectDescriptor> {
    const response = (await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#config.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType
      })
    )) as PutObjectCommandOutput;

    return {
      key: input.key,
      size: input.body.byteLength,
      ...(response.ETag ? { etag: response.ETag } : {})
    };
  }

  async list(prefix = ""): Promise<StorageObjectDescriptor[]> {
    const response = (await this.#client.send(
      new ListObjectsV2Command({
        Bucket: this.#config.bucket,
        Prefix: prefix || undefined
      })
    )) as ListObjectsV2CommandOutput;

    return (response.Contents ?? [])
      .map((entry) => ({
        key: entry.Key ?? "",
        size: entry.Size ?? 0,
        ...(entry.ETag ? { etag: entry.ETag } : {}),
        ...(entry.LastModified
          ? { lastModified: entry.LastModified.toISOString() }
          : {})
      }))
      .filter((entry) => entry.key.length > 0)
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async resolveDownloadUrl(key: string): Promise<string> {
    if (this.#config.publicBaseUrl) {
      const trimmedBaseUrl = this.#config.publicBaseUrl.replace(/\/$/, "");
      return `${trimmedBaseUrl}/${key}`;
    }

    return getSignedUrl(
      this.#client as S3Client,
      new GetObjectCommand({
        Bucket: this.#config.bucket,
        Key: key
      }),
      {
        expiresIn: 900
      }
    );
  }

  async read(key: string): Promise<StorageReadResult> {
    const response = (await this.#client.send(
      new GetObjectCommand({
        Bucket: this.#config.bucket,
        Key: key
      })
    )) as GetObjectCommandOutput;

    return {
      body: await readBodyToUint8Array(
        response.Body as ByteReadableBody | Uint8Array | Buffer | string | undefined
      ),
      ...(response.ContentType ? { contentType: response.ContentType } : {})
    };
  }

  async delete(key: string): Promise<StorageDeleteResult> {
    await this.#client.send(
      new DeleteObjectCommand({
        Bucket: this.#config.bucket,
        Key: key
      })
    );

    return { key };
  }

  async healthCheck(): Promise<StorageHealthStatus> {
    try {
      await this.#client.send(
        new HeadBucketCommand({
          Bucket: this.#config.bucket
        })
      );

      return {
        ok: true,
        provider: this.#config.provider,
        bucket: this.#config.bucket,
        summary: `storage bucket ${this.#config.bucket} reachable`
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.#config.provider,
        bucket: this.#config.bucket,
        summary: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

export function createStorage(
  config: StorageConfig,
  options: StorageFactoryOptions = {}
): StorageAdapter {
  if (config.provider === "local") {
    return new LocalStorageAdapter(config);
  }

  return new S3StorageAdapter(config, options.s3Client);
}

export async function checkStorage(
  config: StorageConfig
): Promise<ServiceCheck> {
  const storage = createStorage(config);
  const status = await storage.healthCheck();

  return {
    ok: status.ok,
    summary: status.summary
  };
}

export async function createStorageContract(config: StorageConfig): Promise<{
  kind: StorageConfig["provider"];
  operations: [
    "put",
    "resolveDownloadUrl",
    "delete",
    "list",
    "ensureBucket",
    "healthCheck"
  ];
}> {
  const storage = createStorage(config);
  await storage.ensureBucket();

  return {
    kind: config.provider,
    operations: [
      "put",
      "resolveDownloadUrl",
      "delete",
      "list",
      "ensureBucket",
      "healthCheck"
    ]
  };
}

export async function readObjectFromLocalStorage(
  config: Extract<StorageConfig, { provider: "local" }>,
  key: string
): Promise<Uint8Array> {
  return readFile(resolve(config.rootDirectory, config.bucket, key));
}
