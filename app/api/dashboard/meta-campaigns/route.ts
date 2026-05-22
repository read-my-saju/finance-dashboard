/**
 * GET /api/dashboard/meta-campaigns?from=YYYY-MM-DD&until=YYYY-MM-DD&force=1
 *
 * 응답:
 *   range, fetchedAt, campaigns[], metaError, cached
 *
 * campaigns 정렬: spend 큰 순.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { loadMetaCampaigns } from "@/lib/dashboard-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "2026-01-01";
  const until = searchParams.get("until") || new Date().toISOString().slice(0, 10);
  const force = searchParams.get("force") === "1";

  try {
    const { campaigns, metaError, cached } = await loadMetaCampaigns({ from, until, force });
    return NextResponse.json({
      range: { from, until },
      fetchedAt: new Date().toISOString(),
      campaigns,
      metaError,
      cached,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "fetch_failed", detail: String(e?.message || e).slice(0, 300) },
      { status: 502 },
    );
  }
}
