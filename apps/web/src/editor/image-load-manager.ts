import { type AssetRecordDto } from "@openmirage/types";

export interface LoadableImage {
  onerror: HTMLImageElement["onerror"];
  onload: HTMLImageElement["onload"];
  src: string;
}

export type ImageResourceState<TImage extends LoadableImage = HTMLImageElement> =
  Record<
    string,
    {
      image: TImage | null;
      status: "error" | "loaded" | "loading";
      url: string;
    }
  >;

export interface ImageLoadManager<TImage extends LoadableImage> {
  clear(): void;
  getInFlightSnapshot(): Record<string, string>;
  sync(input: {
    assetsById: Record<string, AssetRecordDto | undefined>;
    imageResources: ImageResourceState<TImage>;
    referencedAssetIds: readonly string[];
  }): void;
}

export function createImageLoadManager<TImage extends LoadableImage>(input: {
  createImage: () => TImage;
  updateResources: (
    updater: (
      current: ImageResourceState<TImage>
    ) => ImageResourceState<TImage>
  ) => void;
}): ImageLoadManager<TImage> {
  const inFlightLoads = new Map<
    string,
    {
      image: TImage;
      url: string;
    }
  >();

  function detachLoad(assetId: string): void {
    const currentLoad = inFlightLoads.get(assetId);

    if (!currentLoad) {
      return;
    }

    currentLoad.image.onload = null;
    currentLoad.image.onerror = null;
    inFlightLoads.delete(assetId);
  }

  return {
    clear(): void {
      for (const assetId of inFlightLoads.keys()) {
        detachLoad(assetId);
      }
    },

    getInFlightSnapshot(): Record<string, string> {
      return Object.fromEntries(
        Array.from(inFlightLoads.entries(), ([assetId, currentLoad]) => [
          assetId,
          currentLoad.url
        ])
      );
    },

    sync({
      assetsById,
      imageResources,
      referencedAssetIds
    }: {
      assetsById: Record<string, AssetRecordDto | undefined>;
      imageResources: ImageResourceState<TImage>;
      referencedAssetIds: readonly string[];
    }): void {
      const referencedAssetIdSet = new Set(referencedAssetIds);

      for (const [assetId, currentLoad] of Array.from(inFlightLoads.entries())) {
        const asset = assetsById[assetId];

        if (!referencedAssetIdSet.has(assetId) || !asset) {
          detachLoad(assetId);
          continue;
        }

        if (asset.contentUrl !== currentLoad.url) {
          detachLoad(assetId);
        }
      }

      for (const assetId of referencedAssetIds) {
        const asset = assetsById[assetId];

        if (!asset) {
          continue;
        }

        const existingResource = imageResources[assetId];

        if (existingResource?.url === asset.contentUrl) {
          continue;
        }

        const currentLoad = inFlightLoads.get(assetId);

        if (currentLoad?.url === asset.contentUrl) {
          continue;
        }

        if (currentLoad) {
          detachLoad(assetId);
        }

        const image = input.createImage();
        inFlightLoads.set(assetId, {
          image,
          url: asset.contentUrl
        });
        input.updateResources((current) => ({
          ...current,
          [assetId]: {
            image: null,
            status: "loading",
            url: asset.contentUrl
          }
        }));

        image.onload = () => {
          const activeLoad = inFlightLoads.get(assetId);

          if (
            !activeLoad ||
            activeLoad.image !== image ||
            activeLoad.url !== asset.contentUrl
          ) {
            return;
          }

          inFlightLoads.delete(assetId);
          input.updateResources((current) => {
            const currentResource = current[assetId];

            if (currentResource && currentResource.url !== asset.contentUrl) {
              return current;
            }

            return {
              ...current,
              [assetId]: {
                image,
                status: "loaded",
                url: asset.contentUrl
              }
            };
          });
        };
        image.onerror = () => {
          const activeLoad = inFlightLoads.get(assetId);

          if (
            !activeLoad ||
            activeLoad.image !== image ||
            activeLoad.url !== asset.contentUrl
          ) {
            return;
          }

          inFlightLoads.delete(assetId);
          input.updateResources((current) => {
            const currentResource = current[assetId];

            if (currentResource && currentResource.url !== asset.contentUrl) {
              return current;
            }

            return {
              ...current,
              [assetId]: {
                image: null,
                status: "error",
                url: asset.contentUrl
              }
            };
          });
        };
        image.src = asset.contentUrl;
      }
    }
  };
}
