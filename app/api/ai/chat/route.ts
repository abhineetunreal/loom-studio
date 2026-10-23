import { NextRequest, NextResponse } from "next/server";
import { validateAiAccess } from "@/lib/ai/auth";
import { anthropic, AI_MODEL, AI_MAX_TOKENS } from "@/lib/ai/client";
import { AI_SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { AI_TOOLS, executeAiTool } from "@/lib/ai/tools";
import {
  createAiSession,
  getAiSession,
  appendMessages,
} from "@/lib/ai/session";
import type Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60; // Vercel function timeout

export async function POST(request: NextRequest) {
  const auth = await validateAiAccess();
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized — PlatformUser access required" },
      { status: 401 },
    );
  }

  let body: {
    message: string;
    sessionId?: string;
    designId?: string;
    images?: string[]; // base64 data URIs for trend analysis
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.message?.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  // ── Resolve or create session ──────────────────────────────────────────────
  let sessionId = body.sessionId;
  let existingMessages: Anthropic.MessageParam[] = [];

  if (sessionId) {
    const session = await getAiSession(sessionId, auth.platformUserId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    // Rebuild Anthropic message history from stored messages
    const stored = (session.messages as Array<{ role: string; content: string; blocks?: unknown[] }>) ?? [];
    existingMessages = stored.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.blocks ?? m.content,
    })) as Anthropic.MessageParam[];
  } else {
    const session = await createAiSession(auth.tenantId, auth.platformUserId, body.designId);
    sessionId = session.id;
  }

  // ── Build the user message ─────────────────────────────────────────────────
  const userContent: Anthropic.ContentBlockParam[] = [];

  // Add images if provided (for trend analysis)
  if (body.images?.length) {
    for (const img of body.images) {
      // Support both data URIs and raw base64
      const match = img.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        userContent.push({
          type: "image",
          source: {
            type: "base64",
            media_type: match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: match[2],
          },
        });
      }
    }
  }

  userContent.push({ type: "text", text: body.message });

  const messages: Anthropic.MessageParam[] = [
    ...existingMessages,
    { role: "user", content: userContent },
  ];

  // ── Inject the active design context ───────────────────────────────────────
  // The editor sends the design currently open on screen. Tell the model about
  // it so "this design" / "the same" / a bare recolor instruction resolves to
  // the open design instead of making the model guess with list_designs.
  const systemPrompt = body.designId
    ? `${AI_SYSTEM_PROMPT}

## Active Design (IMPORTANT)
The user currently has design ID "${body.designId}" open in the editor right now. When they say "this design", "the same", "it", "this rug", or give a recolor/color instruction without naming a design, they mean THIS design. Before proposing any recolor, call get_design with id "${body.designId}" to load its current palette. Do NOT call list_designs to guess which design they mean — you already know it.`
    : AI_SYSTEM_PROMPT;

  // ── Run the agentic loop (tool use) ────────────────────────────────────────
  // Stream the response with Server-Sent Events so the UI gets incremental updates
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      }

      try {
        let currentMessages = messages;
        let loopCount = 0;
        const MAX_TOOL_LOOPS = 10; // safety limit

        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (loopCount++ > MAX_TOOL_LOOPS) {
            send("error", { error: "Too many tool calls — stopping" });
            break;
          }

          const response = await anthropic.messages.create({
            model: AI_MODEL,
            max_tokens: AI_MAX_TOKENS,
            system: systemPrompt,
            tools: AI_TOOLS as Anthropic.Tool[],
            messages: currentMessages,
          });

          // Process response content blocks
          const assistantContent: Anthropic.ContentBlock[] = response.content;
          const textBlocks: string[] = [];
          const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

          for (const block of assistantContent) {
            if (block.type === "text") {
              textBlocks.push(block.text);
              send("text", { text: block.text });
            } else if (block.type === "tool_use") {
              toolUseBlocks.push({
                id: block.id,
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
              send("tool_call", { name: block.name, input: block.input });
            }
          }

          // If no tool calls, we're done
          if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
            // Store the conversation
            const storedUserMsg = {
              role: "user" as const,
              content: body.message,
              timestamp: new Date().toISOString(),
            };
            const storedAssistantMsg = {
              role: "assistant" as const,
              content: textBlocks.join("\n"),
              blocks: assistantContent,
              timestamp: new Date().toISOString(),
            };

            await appendMessages(sessionId!, [storedUserMsg, storedAssistantMsg]);

            send("done", { sessionId, stopReason: response.stop_reason });
            break;
          }

          // Execute tool calls and build tool_result messages
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const tool of toolUseBlocks) {
            try {
              const result = await executeAiTool(tool.name, tool.input, {
                tenantId: auth.tenantId,
                userId: auth.platformUserId,
              });

              send("tool_result", { name: tool.name, result: JSON.parse(result) });

              toolResults.push({
                type: "tool_result",
                tool_use_id: tool.id,
                content: result,
              });
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : "Tool execution failed";
              send("tool_error", { name: tool.name, error: errorMsg });

              toolResults.push({
                type: "tool_result",
                tool_use_id: tool.id,
                content: JSON.stringify({ error: errorMsg }),
                is_error: true,
              });
            }
          }

          // Continue the loop with tool results
          currentMessages = [
            ...currentMessages,
            { role: "assistant" as const, content: assistantContent },
            { role: "user" as const, content: toolResults },
          ];
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "AI request failed";
        send("error", { error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
