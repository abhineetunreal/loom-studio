import Image from "next/image";

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
        <Image
          src={src}
          alt={alt}
          fill
          priority
          sizes="(max-width: 768px) 100vw, 60vw"
          className="object-contain"
        />
      </div>
    </div>
  );
}
