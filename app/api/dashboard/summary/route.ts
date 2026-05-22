/**
 * GET /api/dashboard/summary?from=YYYY-MM-DD&until=YYYY-MM-DD&force=1
 *
 * 응답:
 *   range, fetchedAt, settings, totals (광고 손익 KPI), metaError, cached
 *
 * lib/calc.ts 의 공식만 사용 — UI 에서 재계산 금지.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { loadProfitSummary } from "@/lib/dashboard-cache";
import { DEFAULT_PG_FEE_RATE, DEFAULT_REPORT_COST_PER_UNIT } from "@/lib/calc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readNumber(s: string | null, fallback: number): number {
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "2026-01-01";
  const until = searchParams.get("until") || new Date().toISOString().slice(0, 10);
  const force = searchParams.get("force") === "1";

  const envPg = readNumber(process.env.DEFAULT_PG_FEE_RATE || null, DEFAULT_PG_FEE_RATE);
  const envReport = readNumber(process.env.DEFAULT_REPORT_COST_PER_UNIT || null, DEFAULT_REPORT_COST_PER_UNIT);
  const pgFeeRate = readNumber(searchParams.get("pgFeeRate"), envPg);
  const reportCostPerUnit = readNumber(searchParams.get("reportCostPerUnit"), envReport);

  try {
    const { summary, metaError, cached } = await loadProfitSummary({
      from,
      until,
      force,
      pgFeeRate,
      reportCostPerUnit,
    });

    return NextResponse.json({
      range: summary.range,
      fetchedAt: new Date().toISOString(),
      settings: summary.settings,
      totals: summary.totals,
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
