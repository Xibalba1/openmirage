import assert from "node:assert/strict";
import test from "node:test";
import { type AssetRecordDto } from "@openmirage/types";
import {
  createImageLoadManager,
  type ImageResourceState,
  type LoadableImage
} from "./image-load-manager";

class FakeImage implements LoadableImage {
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  src = "";

  fail(): void {
    this.onerror?.();
  }

  load(): void {
    this.onload?.();
  }
}

function createAsset(id: string, contentUrl: string): AssetRecordDto {
  return {
    byteSize: 1024,
    contentUrl,
    createdAt: "2026-04-17T00:00:00.000Z",
    deletedAt: null,
    fileId: "file-1",
    filename: "image.png",
    height: 120,
    id,
    kind: "image",
    mimeType: "image/png",
    storageKey: `assets/${id}.png`,
    updatedAt: "2026-04-17T00:00:00.000Z",
    uploadedByUserId: "user-1",
    width: 160,
    workspaceId: "workspace-1"
  };
}

test("image load manager transitions loading resources to loaded without duplicate requests", () => {
  let resources: ImageResourceState<FakeImage> = {};
  const createdImages: FakeImage[] = [];
  const manager = createImageLoadManager<FakeImage>({
    createImage: () => {
      const image = new FakeImage();
      createdImages.push(image);
      return image;
    },
    updateResources(updater) {
      resources = updater(resources);
    }
  });
  const assetsById = {
    "asset-1": createAsset("asset-1", "https://app.test/assets/1")
  };

  manager.sync({
    assetsById,
    imageResources: resources,
    referencedAssetIds: ["asset-1"]
  });

  assert.equal(createdImages.length, 1);
  assert.deepEqual(manager.getInFlightSnapshot(), {
    "asset-1": "https://app.test/assets/1"
  });
  assert.deepEqual(resources["asset-1"], {
    image: null,
    status: "loading",
    url: "https://app.test/assets/1"
  });

  const firstImage = createdImages[0];
  assert.ok(firstImage);
  assert.equal(typeof firstImage.onload, "function");
  assert.equal(typeof firstImage.onerror, "function");

  manager.sync({
    assetsById,
    imageResources: resources,
    referencedAssetIds: ["asset-1"]
  });

  assert.equal(createdImages.length, 1);
  assert.equal(typeof firstImage.onload, "function");
  firstImage.load();

  assert.equal(resources["asset-1"]?.status, "loaded");
  assert.equal(resources["asset-1"]?.image, firstImage);
  assert.deepEqual(manager.getInFlightSnapshot(), {});
});

test("image load manager clear prevents late load events from mutating state", () => {
  let resources: ImageResourceState<FakeImage> = {};
  const createdImages: FakeImage[] = [];
  const manager = createImageLoadManager<FakeImage>({
    createImage: () => {
      const image = new FakeImage();
      createdImages.push(image);
      return image;
    },
    updateResources(updater) {
      resources = updater(resources);
    }
  });

  manager.sync({
    assetsById: {
      "asset-1": createAsset("asset-1", "https://app.test/assets/1")
    },
    imageResources: resources,
    referencedAssetIds: ["asset-1"]
  });

  const firstImage = createdImages[0];
  assert.ok(firstImage);
  manager.clear();

  assert.equal(firstImage.onload, null);
  assert.equal(firstImage.onerror, null);
  assert.deepEqual(manager.getInFlightSnapshot(), {});

  firstImage.load();

  assert.equal(resources["asset-1"]?.status, "loading");
  assert.equal(resources["asset-1"]?.image, null);
});

test("image load manager restarts loads when an asset url changes", () => {
  let resources: ImageResourceState<FakeImage> = {};
  const createdImages: FakeImage[] = [];
  const manager = createImageLoadManager<FakeImage>({
    createImage: () => {
      const image = new FakeImage();
      createdImages.push(image);
      return image;
    },
    updateResources(updater) {
      resources = updater(resources);
    }
  });
  const initialAssetsById = {
    "asset-1": createAsset("asset-1", "https://app.test/assets/1")
  };

  manager.sync({
    assetsById: initialAssetsById,
    imageResources: resources,
    referencedAssetIds: ["asset-1"]
  });

  const firstImage = createdImages[0];
  assert.ok(firstImage);

  const refreshedAssetsById = {
    "asset-1": createAsset("asset-1", "https://app.test/assets/2")
  };

  manager.sync({
    assetsById: refreshedAssetsById,
    imageResources: resources,
    referencedAssetIds: ["asset-1"]
  });

  assert.equal(createdImages.length, 2);
  assert.equal(firstImage.onload, null);
  assert.equal(firstImage.onerror, null);
  assert.deepEqual(manager.getInFlightSnapshot(), {
    "asset-1": "https://app.test/assets/2"
  });
  assert.equal(resources["asset-1"]?.status, "loading");
  assert.equal(resources["asset-1"]?.url, "https://app.test/assets/2");

  firstImage.load();
  assert.equal(resources["asset-1"]?.status, "loading");

  const secondImage = createdImages[1];
  assert.ok(secondImage);
  secondImage.load();

  assert.equal(resources["asset-1"]?.status, "loaded");
  assert.equal(resources["asset-1"]?.image, secondImage);
  assert.equal(resources["asset-1"]?.url, "https://app.test/assets/2");
});
