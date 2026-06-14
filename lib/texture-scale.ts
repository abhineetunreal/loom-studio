import { parseRugDimensions, SUPERSAMPLE_FACTOR } from "./texture-shader";

const SWATCH_PHYSICAL_INCHES = 18;
const FALLBACK_FEET = { widthFeet: 8, heightFeet: 10 };

/**
 * Compute the photo-swatch tile sizes in NATIVE CAD pixels.
 * An 18"×18" physical swatch tiles across the rug at the CAD pixel density.
 */
export function computePhotoTileSizes(
  cadWidthPx: number,
  cadHeightPx: number,
  designName: string,
  knotMultiplier = 1.0,
): { tileSizeX: number; tileSizeY: number } {
  const dims = parseRugDimensions(designName) ?? FALLBACK_FEET;
  const widthInches = dims.widthFeet * 12;
  const heightInches = dims.heightFeet * 12;
  return {
    tileSizeX: (cadWidthPx / widthInches) * SWATCH_PHYSICAL_INCHES / knotMultiplier,
    tileSizeY: (cadHeightPx / heightInches) * SWATCH_PHYSICAL_INCHES / knotMultiplier,
  };
}

/** Same as computePhotoTileSizes but in supersampled pixel space (×SUPERSAMPLE_FACTOR). */
export function computePhotoTileSizesSS(
  cadWidthPx: number,
  cadHeightPx: number,
  designName: string,
  knotMultiplier = 1.0,
): { tileSizeX: number; tileSizeY: number } {
  const n = computePhotoTileSizes(cadWidthPx, cadHeightPx, designName, knotMultiplier);
  return { tileSizeX: n.tileSizeX * SUPERSAMPLE_FACTOR, tileSizeY: n.tileSizeY * SUPERSAMPLE_FACTOR };
}
