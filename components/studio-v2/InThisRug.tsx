"use client";

/**
 * "In this rug" (spec §3 right panel, left column): the colours currently in the
 * rug as a grid of named wool swatches, biggest area first. Tap to select; the
 * padlock keeps a colour fixed when the four options generate alternatives.
 */

import type { YarnOption } from "@/types";
import Swatch from "./Swatch";

type Entry = {
  hex: string;
  current: YarnOption | null;
  displayHex: string;
  percentage: number;
};

type Props = {
  entries: Entry[];
  selectedHex: string | null;
  onSelect: (hex: string) => void;
  lockedHexes: Set<string>;
  onToggleLock: (hex: string) => void;
};

export default function InThisRug({ entries, selectedHex, onSelect, lockedHexes, onToggleLock }: Props) {
  return (
    <div className="w-[228px] shrink-0 flex flex-col min-h-0 border-r border-[var(--line)] bg-[var(--panel)]">
      <div className="shrink-0 px-4 py-3 border-b border-[var(--line)]">
        <h2 className="u-label">In this rug · {entries.length}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2.5">
          {entries.map((e) => {
            const selected = selectedHex === e.hex;
            return (
              <div key={e.hex} className="group">
                {e.current ? (
                  <Swatch
                    yarn={e.current}
                    selected={selected}
                    locked={lockedHexes.has(e.hex)}
                    onClick={() => onSelect(e.hex)}
                    onToggleLock={() => onToggleLock(e.hex)}
                  />
                ) : (
                  <button
                    onClick={() => onSelect(e.hex)}
                    className={`relative aspect-square w-full rounded-[3px] border border-[var(--line-strong)] ${
                      selected ? "ring-2 ring-[var(--sel)] ring-offset-2 ring-offset-[var(--panel)]" : ""
                    }`}
                    style={{ backgroundColor: e.displayHex }}
                  />
                )}
                <div className="mt-1 flex items-baseline justify-between gap-1">
                  <span className="u-mono text-[10.5px] text-[var(--ink-soft)] truncate">
                    {e.current?.name ?? e.current?.code ?? "—"}
                  </span>
                  <span className="u-mono text-[9.5px] text-[var(--ink-faint)] tabular-nums shrink-0">
                    {e.percentage.toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
