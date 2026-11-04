"use client";

/**
 * ResilientImage
 *
 * Drop-in replacement for next/image <Image> that handles transient load
 * failures gracefully.  On first error it retries once (the Next.js image
 * optimizer may 400 on cold starts); on a second failure it falls back to a
 * plain <img> that bypasses the optimizer entirely.
 *
 * Accepts the same props as next/image <Image>.
 */

import { useState, useCallback } from "react";
import Image, { type ImageProps } from "next/image";

type Props = Omit<ImageProps, "onError"> & {
  /** Extra className applied only to the <img> fallback (defaults to same as className). */
  fallbackClassName?: string;
};

export default function ResilientImage({ fallbackClassName, ...props }: Props) {
  // 0 = first attempt (next/image), 1 = retry (next/image), 2 = fallback (<img>)
  const [attempt, setAttempt] = useState(0);

  const handleError = useCallback(() => {
    setAttempt((a) => Math.min(a + 1, 2));
  }, []);

  if (attempt >= 2) {
    // Fallback: plain <img> bypasses the Next.js image optimizer entirely.
    // This always works even when /_next/image returns 400.
    const { fill, sizes, priority, quality, placeholder, blurDataURL, loading, ...rest } = props;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        {...rest}
        src={typeof props.src === "string" ? props.src : ""}
        alt={props.alt ?? ""}
        className={fallbackClassName ?? props.className}
        style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" } : props.style}
        onError={undefined}
      />
    );
  }

  return (
    <Image
      key={attempt} // Force remount on retry so next/image refetches
      {...props}
      onError={handleError}
    />
  );
}
