// ─── Tier ─────────────────────────────────────────────────────────────────────

export type Tier = "demo" | "full" | "admin";

export type TierInfo = {
  tier: Tier;
  pendingApproval: boolean;
};

// ─── Palette ──────────────────────────────────────────────────────────────────

// One entry in a design's indexed palette.
// Stored as JSON on the Design model.
export type PaletteEntry = {
  index: number;           // palette index (0–255) in the source BMP
  hex: string;             // "#rrggbb" — source of truth from the BMP
  pixelCount: number;      // how many pixels in the image use this color
  percentage: number;      // pixelCount / totalPixels * 100, rounded to 1 decimal
  matchedYarnCode?: string; // OneLoom yarn name from oneloom-rendered-lookup.json, if matched at process time
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
  library: string | null;  // "OneLoom" | "ARS 1400" | "ARS 1200" — mapped from DB `material`
  pileType: string | null; // e.g. "Standard", "Loop" — null for most XML-imported yarns
  swatchImageUrl: string | null;
};

// ─── Design ───────────────────────────────────────────────────────────────────

// Shape used on the catalog page and in the left-panel design browser
export type DesignSummary = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string;
  width: number;
  height: number;
  collection: { id: string; name: string; slug: string } | null;
};

// Full design including palette, used on the design viewer page
export type DesignDetail = DesignSummary & {
  sourceBmpUrl: string;
  width: number;
  height: number;
  palette: PaletteEntry[];
  externalSku: string | null;
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
