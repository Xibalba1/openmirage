export function getMissingAssetRefreshKey(
  referencedAssetIds: readonly string[],
  knownAssetIds: readonly string[]
): string | null {
  const knownAssetIdSet = new Set(knownAssetIds);
  const missingAssetIds = Array.from(
    new Set(
      referencedAssetIds.filter((assetId) => !knownAssetIdSet.has(assetId))
    )
  ).sort();

  return missingAssetIds.length > 0 ? missingAssetIds.join("\u0000") : null;
}
