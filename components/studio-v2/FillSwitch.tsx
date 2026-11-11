"use client";

/**
 * FillSwitch (spec §3 + §10.9 rename): "All of this colour" | "Only what I tap".
 * Whole-colour fill is the default; area fill is the second option.
 */

type Props = {
  mode: "whole" | "area";
  onChange: (m: "whole" | "area") => void;
};

export default function FillSwitch({ mode, onChange }: Props) {
  return (
    <div className="inline-flex rounded-md border border-neutral-300 overflow-hidden text-[13px]">
      <button
        onClick={() => onChange("whole")}
        aria-pressed={mode === "whole"}
        className={`px-3 py-1.5 font-medium transition-colors ${
          mode === "whole" ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"
        }`}
      >
        All of this colour
      </button>
      <button
        onClick={() => onChange("area")}
        aria-pressed={mode === "area"}
        className={`px-3 py-1.5 font-medium border-l border-neutral-300 transition-colors ${
          mode === "area" ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"
        }`}
      >
        Only what I tap
      </button>
    </div>
  );
}
