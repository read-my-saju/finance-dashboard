/**
 * GET /api/dashboard/channels?from=YYYY-MM-DD&until=YYYY-MM-DD&force=1
 *
 * 채널 성과: 토스 결제를 Mixpanel 유입 경로로 나눈 매출·메타 귀속 ROAS (lib/channel-revenue.ts).
 * 같은 길이의 바로 앞 기간(prev)도 함께 돌려줘 화면이 증감을 표시한다.
 *
 * 응답: range, prevRange, clampedFrom, fetchedAt, attributionAsOf, attributionStale, cur, prev, error
 *   attributionAsOf: 유입 귀속(Mixpanel) 중 아직 확정 전인 날짜의 조회 시각 (모두 확정이면 null). 15분마다 갱신.
 *   attributionStale: Mixpanel 조회가 실패해(한도 초과 등) 저장해 둔 귀속으로 계산했으면 true.
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
  const until = searchParams.get("until") || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST 오늘
  const force = searchParams.get("force") === "1";

  try {
    const { cur, prev, prevRange, clampedFrom, error, attributionAsOf, attributionStale } = await loadChannelRevenue({ from, until, force });
    return NextResponse.json({
      range: { from, until },
      prevRange,
      clampedFrom,
      fetchedAt: new Date().toISOString(),
      attributionAsOf: attributionAsOf ? new Date(attributionAsOf).toISOString() : null,
      attributionStale,
      cur,
      prev,
      error,
    });
  } catch (e: any) {
    // 외부 API 오류 본문은 응답에 싣지 않고 서버 로그에만 남긴다.
    console.error("[channels] 조회 실패", e);
    return NextResponse.json({ error: "채널 성과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }
}
