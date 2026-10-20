"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAiChat, type AiMessage, type AiToolCall } from "@/hooks/useAiChat";
import { useAiContext } from "@/components/ai/AiContext";

// ─── Component ───────────────────────────────────────────────────────────────

export default function AiPromptBar() {
  const aiCtx = useAiContext();
  const designId = aiCtx?.activeDesignId ?? undefined;
  const onAction = aiCtx?.emitAiAction;
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { messages, isStreaming, error, sendMessage, stopStreaming, clearSession } =
    useAiChat({ onAction });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() && !images.length) return;
    sendMessage(input.trim(), images.length ? images : undefined, designId);
    setInput("");
    setImages([]);
    if (!expanded) setExpanded(true);
  }, [input, images, designId, sendMessage, expanded]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 10 * 1024 * 1024) continue; // 10MB limit
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    }
    // Reset so the same file can be uploaded again
    e.target.value = "";
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="border-b-2 border-red-500 bg-stone-50 shrink-0 z-20">
      {/* ── Collapsed: single-line prompt bar ──────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* AI badge */}
        <span className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold uppercase tracking-wider">
          <SparklesIcon />
          AI
        </span>

        {/* Text input */}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (messages.length) setExpanded(true); }}
          placeholder="Recolor this design in warm autumn tones..."
          rows={1}
          className="flex-1 resize-none border-0 bg-transparent text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-0 py-1 min-w-0"
        />

        {/* Image upload thumbnails */}
        {images.map((img, i) => (
          <button
            key={i}
            onClick={() => removeImage(i)}
            className="relative shrink-0 w-8 h-8 rounded border border-stone-200 overflow-hidden group"
            title="Remove image"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt="" className="w-full h-full object-cover" />
            <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <XIcon className="w-3 h-3 text-white" />
            </span>
          </button>
        ))}

        {/* Image upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 p-1.5 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors"
          title="Upload image for trend analysis"
        >
          <ImageUploadIcon />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleImageUpload}
        />

        {/* Send / Stop button */}
        {isStreaming ? (
          <button
            onClick={stopStreaming}
            className="shrink-0 p-1.5 rounded bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
            title="Stop"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!input.trim() && !images.length}
            className="shrink-0 p-1.5 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Send"
          >
            <SendIcon />
          </button>
        )}

        {/* Expand/collapse chat history */}
        {messages.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 p-1.5 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors"
            title={expanded ? "Collapse chat" : "Expand chat"}
          >
            {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </button>
        )}

        {/* New session */}
        {messages.length > 0 && (
          <button
            onClick={clearSession}
            className="shrink-0 p-1 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors"
            title="New AI session"
          >
            <PlusIcon />
          </button>
        )}
      </div>

      {/* ── Expanded: chat history ─────────────────────────────────────────── */}
      {expanded && messages.length > 0 && (
        <div className="max-h-80 overflow-y-auto border-t border-stone-200 bg-white">
          <div className="p-3 space-y-3">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {error && (
              <div className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">
                {error}
              </div>
            )}
            {isStreaming && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content && (
              <div className="flex items-center gap-2 text-xs text-stone-400">
                <LoadingDots />
                <span>Thinking...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Message Bubble ──────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: AiMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-stone-100 text-stone-800"
            : "bg-white border border-stone-200 text-stone-700"
        }`}
      >
        {/* User images */}
        {isUser && message.images?.length ? (
          <div className="flex gap-1 mb-2">
            {message.images.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={img}
                alt=""
                className="w-16 h-16 rounded object-cover"
              />
            ))}
          </div>
        ) : null}

        {/* Message text */}
        {message.content && (
          <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
        )}

        {/* Tool calls (collapsed by default) */}
        {message.toolCalls?.length ? (
          <ToolCallsSummary toolCalls={message.toolCalls} />
        ) : null}
      </div>
    </div>
  );
}

// ─── Tool Calls Summary ──────────────────────────────────────────────────────

function ToolCallsSummary({ toolCalls }: { toolCalls: AiToolCall[] }) {
  const [expanded, setExpanded] = useState(false);

  const toolLabels: Record<string, string> = {
    get_design: "Looking up design",
    list_designs: "Browsing designs",
    get_yarn_palette: "Loading yarn palette",
    search_yarns_by_color: "Finding matching yarns",
    propose_recolor: "Building preview",
    save_colorway: "Saving colorway",
  };

  return (
    <div className="mt-2 border-t border-stone-100 pt-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-600 transition-colors"
      >
        <ToolIcon />
        <span>
          {toolCalls.length} tool call{toolCalls.length !== 1 ? "s" : ""}
        </span>
        {expanded ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {toolCalls.map((tc, i) => (
            <div key={i} className="text-[11px] text-stone-500 bg-stone-50 rounded px-2 py-1">
              <span className="font-medium">{toolLabels[tc.name] ?? tc.name}</span>
              {tc.error && <span className="text-red-500 ml-1">— {tc.error}</span>}
              {tc.result != null && !tc.error && (
                <span className="text-green-600 ml-1">✓</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Loading dots ────────────────────────────────────────────────────────────

function LoadingDots() {
  return (
    <span className="flex gap-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-bounce [animation-delay:0ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-bounce [animation-delay:150ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-bounce [animation-delay:300ms]" />
    </span>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function SparklesIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function ImageUploadIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function XIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ChevronUpIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 15l-6-6-6 6" />
    </svg>
  );
}

function ChevronDownIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function ToolIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
