"use client";

import { useState, useCallback, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  /** Tool calls made during this assistant turn */
  toolCalls?: AiToolCall[];
  /** Images attached to user message */
  images?: string[];
};

export type AiToolCall = {
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

/** Events the UI can react to for interactive integration */
export type AiAction =
  | { type: "recolor_preview"; designId: string; presetUrl: string; swaps: Array<{ from: string; to: string }> }
  | { type: "highlight_yarns"; yarnCodes: string[] }
  | { type: "navigate_design"; designId: string }
  | { type: "colorway_saved"; colorwayId: string; name: string };

type UseAiChatOptions = {
  /** Callback when AI produces an actionable result (recolor, navigate, etc.) */
  onAction?: (action: AiAction) => void;
};

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAiChat(options: UseAiChatOptions = {}) {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string, images?: string[], designId?: string) => {
      if (isStreaming) return;
      setError(null);
      setIsStreaming(true);

      // Add user message immediately
      const userMsg: AiMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
        images,
      };
      setMessages((prev) => [...prev, userMsg]);

      // Prepare streaming assistant message
      const assistantId = crypto.randomUUID();
      const toolCalls: AiToolCall[] = [];
      let fullText = "";

      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          timestamp: new Date().toISOString(),
          toolCalls: [],
        },
      ]);

      try {
        const controller = new AbortController();
        abortRef.current = controller;

        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            sessionId,
            designId,
            images,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let eventType = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7);
            } else if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                handleEvent(eventType, data);
              } catch {
                // skip malformed data
              }
            }
          }
        }

        function handleEvent(event: string, data: Record<string, unknown>) {
          switch (event) {
            case "text":
              fullText += data.text as string;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: fullText } : m,
                ),
              );
              break;

            case "tool_call":
              toolCalls.push({
                name: data.name as string,
                input: data.input as Record<string, unknown>,
              });
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, toolCalls: [...toolCalls] } : m,
                ),
              );
              break;

            case "tool_result": {
              const name = data.name as string;
              const result = data.result;
              const tc = toolCalls.find((t) => t.name === name && !t.result);
              if (tc) tc.result = result;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, toolCalls: [...toolCalls] } : m,
                ),
              );

              // Detect actionable results for UI integration
              if (name === "propose_recolor" && result && typeof result === "object") {
                const r = result as Record<string, unknown>;
                if (r.presetUrl) {
                  options.onAction?.({
                    type: "recolor_preview",
                    designId: r.designId as string,
                    presetUrl: r.presetUrl as string,
                    swaps: (r.validSwaps as Array<{ from: string; to: string }>) ?? [],
                  });
                }
              }

              if (name === "search_yarns_by_color" && Array.isArray(result)) {
                const codes = (result as Array<{ code: string }>).map((y) => y.code);
                if (codes.length) {
                  options.onAction?.({ type: "highlight_yarns", yarnCodes: codes });
                }
              }

              if (name === "get_design" && result && typeof result === "object") {
                const r = result as Record<string, unknown>;
                if (r.id) {
                  options.onAction?.({ type: "navigate_design", designId: r.id as string });
                }
              }

              if (name === "save_colorway" && result && typeof result === "object") {
                const r = result as Record<string, unknown>;
                if (r.colorwayId) {
                  options.onAction?.({
                    type: "colorway_saved",
                    colorwayId: r.colorwayId as string,
                    name: r.name as string,
                  });
                }
              }
              break;
            }

            case "tool_error": {
              const name = data.name as string;
              const tc = toolCalls.find((t) => t.name === name && !t.result && !t.error);
              if (tc) tc.error = data.error as string;
              break;
            }

            case "done":
              if (data.sessionId) setSessionId(data.sessionId as string);
              break;

            case "error":
              setError(data.error as string);
              break;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // User cancelled — ok
        } else {
          setError(err instanceof Error ? err.message : "Request failed");
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, sessionId, options],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearSession = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setError(null);
  }, []);

  return {
    messages,
    isStreaming,
    sessionId,
    error,
    sendMessage,
    stopStreaming,
    clearSession,
  };
}
