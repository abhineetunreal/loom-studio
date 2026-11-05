"use client";

/**
 * ResilientImage
 *
 * Renders a plain <img> instead of next/image <Image>, bypassing the
 * Next.js image optimizer.  This avoids intermittent 400 errors that occur
 * on Vercel cold starts when the optimizer tries to fetch upstream images
 * before the Supabase connection is warm.
 *
 * Accepts a subset of next/image props for drop-in compatibility.
 */

import { useState } from "react";

type Props = {
  src: string;
  alt: string;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

export default function ResilientImage({ src, alt, fill, className, style }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    // Show a neutral placeholder on failure
    return (
      <div
        className={className}
        style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style}
        aria-label={alt}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      crossOrigin="anonymous"
      onError={() => setFailed(true)}
      className={className}
      style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", ...style } : style}
    />
  );
}
