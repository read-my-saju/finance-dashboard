/**
 * GET /api/dashboard/channels?from=YYYY-MM-DD&until=YYYY-MM-DD&force=1
 *
 * 채널 성과: 토스 결제를 Mixpanel 유입 경로로 나눈 매출·메타 귀속 ROAS (lib/channel-revenue.ts).
 * 같은 길이의 바로 앞 기간(prev)도 함께 돌려줘 화면이 증감을 표시한다.
 *
 * 응답: range, prevRange, clampedFrom, fetchedAt, cur, prev, error
 *   clampedFrom: 요청 기간이 데이터 시작일(2026-09-03) 이전을 포함해 그날부터만 집계했으면 그 날짜 (비교 기간 없음).
 *   cur/prev 가 null 이면 error 에 사유 (Mixpanel 환경변수 없음 등).
 */
import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { loadChannelRevenue } from "@/lib/dashboard-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "2026-01-01";
  const until = searchParams.get("until") || new Date().toISOString().slice(0, 10);
  const force = searchParams.get("force") === "1";

  try {
    const { cur, prev, prevRange, clampedFrom, error } = await loadChannelRevenue({ from, until, force });
    return NextResponse.json({
      range: { from, until },
      prevRange,
      clampedFrom,
      fetchedAt: new Date().toISOString(),
      cur,
      prev,
      error,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "fetch_failed", detail: String(e?.message || e).slice(0, 300) },
      { status: 502 },
    );
  }
}
