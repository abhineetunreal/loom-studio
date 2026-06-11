// Resolves the display URL for a design's image.
//
// System-seeded designs live in the public `designs` bucket — imageUrl is
// already a full public URL and can be used directly.
//
// User-uploaded designs live in the private `user-designs` bucket — imageUrl
// holds the storage path (e.g. "{authUserId}/{uuid}.png") and must be
// converted to a signed URL before it reaches the browser.
//
// Call this server-side only (Server Components, Route Handlers, Server Actions).

import { getSignedUrl, USER_DESIGNS_BUCKET } from "./supabase";

type DesignForUrlResolution = {
  imageUrl: string;
  uploadedById: string | null | undefined;
};

/**
 * Returns a browser-ready URL for the design's image.
 * For user-uploaded designs this is a signed URL (valid 1 hour).
 * For system designs this is the public URL stored in imageUrl.
 */
export async function resolveDesignImageUrl(
  design: DesignForUrlResolution
): Promise<string> {
  if (!design.uploadedById) return design.imageUrl;
  return getSignedUrl(USER_DESIGNS_BUCKET, design.imageUrl);
}

/**
 * Batch-resolves image URLs for many designs efficiently.
 * Signed URL requests are issued in parallel.
 */
export async function resolveDesignImageUrls<
  T extends DesignForUrlResolution,
>(designs: T[]): Promise<(T & { imageUrl: string })[]> {
  return Promise.all(
    designs.map(async (design) => ({
      ...design,
      imageUrl: await resolveDesignImageUrl(design),
    }))
  );
}
