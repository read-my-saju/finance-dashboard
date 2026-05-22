import { NextRequest, NextResponse } from "next/server";
import { aggregate } from "@/lib/aggregate";
import { fetchAllPaidPayments } from "@/lib/portone";
import { isAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 5 분 in-memory cache. force=1 query 로 우회 가능 (새로고침 버튼).
type CacheEntry = { key: string; expiresAt: number; payload: any };
let cache: CacheEntry | null = null;
const TTL_MS = 5 * 60 * 1000;

function isoStartOfDay(s: string): string {
  return new Date(s + "T00:00:00+09:00").toISOString();
}
function isoEndOfDay(s: string): string {
  return new Date(s + "T23:59:59+09:00").toISOString();
}

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "2026-01-01";
  const until = searchParams.get("until") || new Date().toISOString().slice(0, 10);
  const force = searchParams.get("force") === "1";

  const cacheKey = `${from}|${until}`;
  const now = Date.now();
  if (!force && cache && cache.key === cacheKey && cache.expiresAt > now) {
    return NextResponse.json({ ...cache.payload, cached: true });
  }

  try {
    const fromISO = isoStartOfDay(from);
    const untilISO = isoEndOfDay(until);
    const payments = await fetchAllPaidPayments({ fromISO, untilISO });
    const summary = aggregate(payments, { from, until });

    cache = { key: cacheKey, expiresAt: now + TTL_MS, payload: summary };
    return NextResponse.json({ ...summary, cached: false });
  } catch (e: any) {
    return NextResponse.json(
      { error: "fetch_failed", detail: String(e?.message || e) },
      { status: 502 },
    );
  }
}
