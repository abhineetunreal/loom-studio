import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { getCurrentTenant } from "@/lib/tenant";

// Bug reports from the in-app "Report a problem" widget.
//
// Public endpoint (customers may be signed out), so it is deliberately strict:
// size caps, a light per-instance rate limit, and no secrets echoed back. Each
// report becomes a GitHub issue (the triage agent's queue); if GitHub can't be
// reached the full report is parked in storage so it is never lost.

const BUCKET = process.env.SUPABASE_SNAPSHOTS_BUCKET ?? "snapshots";
const REPO = process.env.BUGBOT_REPO ?? "abhineetunreal/loom-studio";
const TOKEN = process.env.BUGBOT_GITHUB_TOKEN;

const MAX_DESC = 5000;
const MAX_SHOT_BYTES = 8 * 1024 * 1024;

// Best-effort per-instance rate limit: 5 reports / 10 min / IP.
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const win = 10 * 60 * 1000;
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < win);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 5;
}

type Ctx = {
  url?: string;
  path?: string;
  target?: { kind: string; id: string } | null;
  viewport?: { w: number; h: number } | null;
  ua?: string;
  at?: string;
  errors?: unknown[];
  net?: unknown[];
};

function fence(label: string, value: unknown): string {
  if (!value || (Array.isArray(value) && value.length === 0)) return "";
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return `\n**${label}**\n\`\`\`json\n${body.slice(0, 6000)}\n\`\`\`\n`;
}

async function uploadScreenshot(dataUrl: string): Promise<string | null> {
  try {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    if (base64.length * 0.75 > MAX_SHOT_BYTES) return null;
    const buffer = Buffer.from(base64, "base64");
    const admin = createAdminClient();
    const filename = `bug-reports/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await admin.storage.from(BUCKET).upload(filename, buffer, {
      contentType: "image/jpeg", upsert: false,
    });
    if (error) return null;
    return admin.storage.from(BUCKET).getPublicUrl(filename).data.publicUrl;
  } catch {
    return null;
  }
}

async function parkReport(key: string, data: unknown): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.storage.from(BUCKET).upload(
      `bug-reports/unfiled/${key}.json`,
      Buffer.from(JSON.stringify(data, null, 2)),
      { contentType: "application/json", upsert: true }
    );
  } catch { /* nothing more we can do */ }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many reports. Please wait a bit." }, { status: 429 });
  }

  let body: { description?: string; email?: string | null; context?: Ctx; screenshot?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const description = (body.description ?? "").trim().slice(0, MAX_DESC);
  if (!description) {
    return NextResponse.json({ error: "A description is required." }, { status: 400 });
  }
  const email = (body.email ?? "")?.toString().trim().slice(0, 200) || null;
  const ctx = body.context ?? {};

  // Best-effort tenant tag (the report is public, so this must not throw).
  let tenantName = "unknown";
  try {
    const t = await getCurrentTenant();
    if (t) tenantName = t.slug ?? t.name ?? "unknown";
  } catch { /* ignore */ }

  const shotUrl = body.screenshot ? await uploadScreenshot(body.screenshot) : null;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

  const title = `[Bug] ${description.split("\n")[0].slice(0, 80)}`;
  const issueBody =
    `${description}\n\n---\n` +
    `**Reporter:** ${email ?? "—"}\n` +
    `**Tenant:** ${tenantName}\n` +
    `**Page:** ${ctx.url ?? "—"}\n` +
    (ctx.target ? `**Item:** ${ctx.target.kind}/${ctx.target.id}\n` : "") +
    `**Build:** \`${sha}\`\n` +
    `**When:** ${ctx.at ?? new Date().toISOString()}\n` +
    `**Viewport:** ${ctx.viewport ? `${ctx.viewport.w}×${ctx.viewport.h}` : "—"}\n` +
    `**Agent:** ${(ctx.ua ?? "—").slice(0, 300)}\n` +
    (shotUrl ? `\n**Screenshot**\n![screenshot](${shotUrl})\n` : "") +
    fence("Console errors", ctx.errors) +
    fence("Failed requests", ctx.net);

  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (!TOKEN) {
    await parkReport(key, { title, issueBody, email, tenantName });
    return NextResponse.json({ ok: true });
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body: issueBody, labels: ["bug", "from-app"] }),
    });
    if (!res.ok) {
      await parkReport(key, { title, issueBody, githubStatus: res.status });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: true });
  } catch {
    await parkReport(key, { title, issueBody });
    return NextResponse.json({ ok: true });
  }
}
