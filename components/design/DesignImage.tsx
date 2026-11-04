type Props = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

export default function DesignImage({ src, alt, width, height }: Props) {
  return (
    // Wrapper constrains the image to the available column height on desktop.
    // On mobile it fills the full width and lets the height flow naturally.
    <div className="w-full">
      <div
        className="relative w-full rounded-xl overflow-hidden bg-stone-100 border border-stone-200"
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        {/* Plain <img> — bypasses Next.js image optimizer to avoid 400s on
            Vercel cold starts.  The design images are already served at their
            native resolution from Supabase and don't benefit from re-optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          fetchPriority="high"
          className="absolute inset-0 w-full h-full object-contain"
        />
      </div>
    </div>
  );
}
