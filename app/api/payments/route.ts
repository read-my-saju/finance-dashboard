import { NextRequest, NextResponse } from "next/server";
import { aggregate } from "@/lib/aggregate";
import { fetchCombinedPayments } from "@/lib/payments-source";
import { isAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 5 분 in-memory cache. force=1 query 로 우회 가능 (새로고침 버튼).
type CacheEntry = { key: string; expiresAt: number; payload: any };
let cache: CacheEntry | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "2026-01-01";
  const until = searchParams.get("until") || new Date().toISOString().slice(0, 10);
  const force = searchParams.get("force") === "1";
  const debug = searchParams.get("debug") === "1";

  const cacheKey = `${from}|${until}`;
  const now = Date.now();
  if (!force && !debug && cache && cache.key === cacheKey && cache.expiresAt > now) {
    return NextResponse.json({ ...cache.payload, cached: true });
  }

  // PortOne(과거) + Toss(2026-06-19~) 합산. 한쪽 실패해도 다른 쪽은 보여준다.
  const { payments, warnings, portoneDebug, tossDebug, bothFailed } =
    await fetchCombinedPayments({ from, until });

  if (bothFailed) {
    return NextResponse.json(
      { error: "fetch_failed", detail: warnings.join(" / ") },
      { status: 502 },
    );
  }

  const summary = aggregate(payments, { from, until });

  const payload: any = { ...summary };
  if (warnings.length) payload.warnings = warnings;
  if (debug) {
    payload._debug = { portone: portoneDebug, toss: tossDebug };
  } else {
    cache = { key: cacheKey, expiresAt: now + TTL_MS, payload };
  }

  return NextResponse.json({ ...payload, cached: false });
}
