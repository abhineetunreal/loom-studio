"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";
import type { AiAction } from "@/hooks/useAiChat";

type AiContextValue = {
  /** The design ID currently being viewed */
  activeDesignId: string | null;
  /** Register the active design (called by DesignViewer on mount) */
  setActiveDesignId: (id: string | null) => void;
  /** Subscribe to AI actions (called by DesignViewer) */
  onAiAction: (handler: (action: AiAction) => void) => () => void;
  /** Emit an AI action (called by AiPromptBar/useAiChat) */
  emitAiAction: (action: AiAction) => void;
};

const AiCtx = createContext<AiContextValue | null>(null);

export function AiProvider({ children }: { children: React.ReactNode }) {
  const [activeDesignId, setActiveDesignId] = useState<string | null>(null);
  const listenersRef = useRef<Set<(action: AiAction) => void>>(new Set());

  const onAiAction = useCallback((handler: (action: AiAction) => void) => {
    listenersRef.current.add(handler);
    return () => {
      listenersRef.current.delete(handler);
    };
  }, []);

  const emitAiAction = useCallback((action: AiAction) => {
    for (const handler of listenersRef.current) {
      handler(action);
    }
  }, []);

  return (
    <AiCtx.Provider
      value={{ activeDesignId, setActiveDesignId, onAiAction, emitAiAction }}
    >
      {children}
    </AiCtx.Provider>
  );
}

export function useAiContext() {
  return useContext(AiCtx);
}
