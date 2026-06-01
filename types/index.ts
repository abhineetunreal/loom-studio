// ─── Palette ──────────────────────────────────────────────────────────────────

// One entry in a design's indexed palette.
// Stored as JSON on the Design model.
export type PaletteEntry = {
  index: number;      // palette index (0–255) in the source BMP
  hex: string;        // "#rrggbb" — source of truth from the BMP
  pixelCount: number; // how many pixels in the image use this color
  percentage: number; // pixelCount / totalPixels * 100, rounded to 1 decimal
};

// ─── Recolor state ────────────────────────────────────────────────────────────

// The customer's current in-progress colorway: maps original palette hex → yarn
export type ColorMap = Map<string, YarnOption>;

// ─── Yarn ─────────────────────────────────────────────────────────────────────

// Shape of a yarn as used in the UI (subset of DB model)
export type YarnOption = {
  id: string;
  code: string;
  name: string;
  hex: string;
  library: string | null; // "OneLoom" | "ARS 1400" | "ARS 1200" — mapped from DB `material`
  swatchImageUrl: string | null;
};

// ─── Design ───────────────────────────────────────────────────────────────────

// Shape used on the catalog page
export type DesignSummary = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string;
  width: number;
  height: number;
};

// Full design including palette, used on the design viewer page
export type DesignDetail = DesignSummary & {
  sourceBmpUrl: string;
  width: number;
  height: number;
  palette: PaletteEntry[];
};

// ─── Submission ───────────────────────────────────────────────────────────────

export type SubmissionColorMappingInput = {
  originalHex: string;
  percentage: number;
  yarnId: string;
};

export type SubmissionInput = {
  designId: string;
  customerName: string;
  customerEmail: string;
  notes?: string;
  colorMappings: SubmissionColorMappingInput[];
  // snapshotDataUrl: base64 PNG generated on the client, uploaded server-side
  snapshotDataUrl: string;
};
