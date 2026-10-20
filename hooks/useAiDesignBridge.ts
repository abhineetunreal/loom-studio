"use client";

// Bridges the AI context with DesignViewer — registers the active design
// and dispatches AI-proposed recolors to the canvas reducer.

import { useEffect } from "react";
import { useAiContext } from "@/components/ai/AiContext";
import type { AiAction } from "@/hooks/useAiChat";

/**
 * Call this inside DesignViewer to:
 * 1. Register the design ID so AiPromptBar knows which design is open.
 * 2. Subscribe to AI actions and handle them (e.g. navigate to preset URL,
 *    highlight yarns in the picker, etc.)
 */
export function useAiDesignBridge(
  designId: string,
  handlers: {
    onRecolorPreview?: (presetUrl: string) => void;
    onHighlightYarns?: (yarnCodes: string[]) => void;
    onNavigateDesign?: (designId: string) => void;
    onColorwaySaved?: (colorwayId: string, name: string) => void;
  },
) {
  const aiCtx = useAiContext();

  // Register/unregister the active design
  useEffect(() => {
    aiCtx?.setActiveDesignId(designId);
    return () => {
      aiCtx?.setActiveDesignId(null);
    };
  }, [designId, aiCtx]);

  // Subscribe to AI actions
  useEffect(() => {
    if (!aiCtx) return;

    const unsubscribe = aiCtx.onAiAction((action: AiAction) => {
      switch (action.type) {
        case "recolor_preview":
          handlers.onRecolorPreview?.(action.presetUrl);
          break;
        case "highlight_yarns":
          handlers.onHighlightYarns?.(action.yarnCodes);
          break;
        case "navigate_design":
          handlers.onNavigateDesign?.(action.designId);
          break;
        case "colorway_saved":
          handlers.onColorwaySaved?.(action.colorwayId, action.name);
          break;
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiCtx]);
}
