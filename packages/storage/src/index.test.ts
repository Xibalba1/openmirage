import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createStorage, readObjectFromLocalStorage } from "./index.js";

test("local storage adapter supports ensureBucket, put, list, resolve, and delete", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "openmirage-storage-"));
  const storage = createStorage({
    provider: "local",
    bucket: "assets",
    rootDirectory
  });

  await storage.ensureBucket();

  const putResult = await storage.put({
    key: "smoke/hello.txt",
    body: Buffer.from("hello"),
    contentType: "text/plain"
  });

  assert.equal(putResult.key, "smoke/hello.txt");
  assert.equal(putResult.size, 5);

  const listed = await storage.list("smoke/");
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.key, "smoke/hello.txt");

  const url = await storage.resolveDownloadUrl("smoke/hello.txt");
  assert.match(url, /^file:\/\//);

  const contents = await readObjectFromLocalStorage(
    {
      provider: "local",
      bucket: "assets",
      rootDirectory
    },
    "smoke/hello.txt"
  );
  assert.equal(Buffer.from(contents).toString("utf8"), "hello");

  const deleteResult = await storage.delete("smoke/hello.txt");
  assert.equal(deleteResult.key, "smoke/hello.txt");
  assert.deepEqual(await storage.list("smoke/"), []);

  await rm(rootDirectory, { recursive: true, force: true });
});

test("s3-compatible storage uses injected client for bucket bootstrap and health", async () => {
  const seenCommands: string[] = [];
  let bucketExists = false;

  const storage = createStorage(
    {
      provider: "minio",
      bucket: "assets",
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      accessKeyId: "openmirage",
      secretAccessKey: "openmirage123",
      forcePathStyle: true
    },
    {
      s3Client: {
        async send(command) {
          seenCommands.push(command.constructor.name);

          if (
            command.constructor.name === "HeadBucketCommand" &&
            !bucketExists
          ) {
            throw new Error("missing bucket");
          }

          if (command.constructor.name === "CreateBucketCommand") {
            bucketExists = true;
          }

          return {} as never;
        }
      }
    }
  );

  await storage.ensureBucket();
  const health = await storage.healthCheck();

  assert.deepEqual(seenCommands, [
    "HeadBucketCommand",
    "CreateBucketCommand",
    "HeadBucketCommand"
  ]);
  assert.equal(health.ok, true);
  assert.equal(health.bucket, "assets");
});
