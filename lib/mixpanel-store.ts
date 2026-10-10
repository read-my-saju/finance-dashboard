/**
 * Mixpanel 귀속 결과 영속 저장 (Upstash KV) — 채널 성과가 조회할 때마다 JQL 을 치지 않게 한다.
 *
 * Mixpanel JQL 은 프로젝트당 시간당 호출 한도가 있고(약 60회), 귀속 계산 1번에 최대 3회를 쓴다.
 * 결제 1건의 귀속(UTM·방문기록 복원·신규 여부)은 결제 시점에 정해지므로 날짜별로 한 번 계산해 저장하고 재사용한다.
 *
 * KV 키: mx:attr:v1:{YYYY-MM-DD(KST)} → { fetchedAt: epoch ms, rows: PurchaseAttribution[] }
 *
 * 갱신 규칙 (planFetch):
 *   - 그날이 끝나고 2시간 뒤 이후에 받은 기록은 확정 — 다시 조회하지 않는다.
 *   - 확정 전 기록(보통 오늘·어제)은 받은 지 15분이 지났을 때만 다시 조회한다. 새로고침 버튼도 이 규칙을 따른다.
 *   - 조회가 실패하면(한도 초과 등) 기간 전체의 저장본이 있을 때만 그것을 쓰고 stale 로 알린다.
 * KV 환경변수가 없으면 같은 규칙을 서버 메모리에서 적용한다 (warm 인스턴스 안에서만 유지, cold start 시 비어 있음).
 */
import { isKvEnabled, kv } from "./kv";
import { fetchPurchaseAttributions, MixpanelConfigError } from "./mixpanel";
import type { PurchaseAttribution } from "./channel";

const KEY_PREFIX = "mx:attr:v1:";
const DAY_MS = 86_400_000;
const FINAL_AFTER_MS = 2 * 3600 * 1000;
const REFRESH_MS = 15 * 60 * 1000;
// Upstash 요청 크기 한도(무료 1MB) 안에 들도록 하루치(수십 KB)를 몇 개씩 묶어 읽고 쓴다.
const KV_BATCH = 8;

export type DayRecord = { fetchedAt: number; rows: PurchaseAttribution[] };
export type StoredAttributions = {
  rows: PurchaseAttribution[];
  asOf: number | null; // 확정 전 날짜 중 가장 오래된 조회 시각 (모두 확정이면 null)
  stale: boolean; // 다시 조회해야 했지만 실패해서 저장본을 쓴 경우
};

const kstStartMs = (ymd: string) => Date.parse(`${ymd}T00:00:00+09:00`);
const kstDay = (ms: number) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

export function daysBetween(from: string, until: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${until}T00:00:00Z`); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** 그날이 끝나고 2시간이 지난 뒤 받은 기록이면 더는 바뀌지 않는다. */
export function isFinal(day: string, fetchedAt: number): boolean {
  return fetchedAt >= kstStartMs(day) + DAY_MS + FINAL_AFTER_MS;
}

/** 다시 조회해야 하는 날짜 (오름차순). */
export function planFetch(days: string[], stored: Map<string, DayRecord>, now: number): string[] {
  return days.filter((d) => {
    const r = stored.get(d);
    return !r || (!isFinal(d, r.fetchedAt) && now - r.fetchedAt >= REFRESH_MS);
  });
}

/** 결제 시각(KST) 기준으로 날짜별로 나눈다. 요청한 날짜는 결제가 없어도 빈 배열로 남긴다. */
export function splitByDay(rows: PurchaseAttribution[], days: string[]): Map<string, PurchaseAttribution[]> {
  const out = new Map(days.map((d) => [d, [] as PurchaseAttribution[]]));
  for (const r of rows) out.get(kstDay(r.ts))?.push(r);
  return out;
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// KV 가 없을 때의 저장소. 날짜 수만큼만 커진다 (2026-09-03 이후 하루 1개).
const memory = new Map<string, DayRecord>();

async function readDays(days: string[]): Promise<Map<string, DayRecord>> {
  const out = new Map<string, DayRecord>();
  if (!isKvEnabled()) {
    for (const d of days) if (memory.has(d)) out.set(d, memory.get(d)!);
    return out;
  }
  for (const part of chunks(days, KV_BATCH)) {
    const vals = await kv().mget<(DayRecord | null)[]>(...part.map((d) => KEY_PREFIX + d));
    part.forEach((d, i) => {
      const v = vals[i];
      if (v && Array.isArray(v.rows)) out.set(d, v);
    });
  }
  return out;
}

async function writeDays(records: Map<string, DayRecord>): Promise<void> {
  if (!isKvEnabled()) {
    records.forEach((rec, d) => memory.set(d, rec));
    return;
  }
  for (const part of chunks(Array.from(records), KV_BATCH)) {
    const pipe = kv().pipeline();
    for (const [d, rec] of part) pipe.set(KEY_PREFIX + d, rec);
    await pipe.exec();
  }
}

/** KST [from, until] 결제 귀속. 저장본을 우선 쓰고, 필요한 날짜만 Mixpanel 에서 한 번에 받아 저장한다. */
export async function loadStoredAttributions(from: string, until: string): Promise<StoredAttributions> {
  const days = daysBetween(from, until);
  const stored = await readDays(days);
  const need = planFetch(days, stored, Date.now());
  let stale = false;

  if (need.length > 0) {
    // 필요한 날짜가 띄엄띄엄이어도 한 범위로 받는다 (JQL 호출 수를 늘리지 않으려고).
    const span = daysBetween(need[0], need[need.length - 1]);
    const fetchedAt = Date.now();
    let fetched: PurchaseAttribution[] | null = null;
    try {
      fetched = await fetchPurchaseAttributions(span[0], span[span.length - 1]);
    } catch (e) {
      if (e instanceof MixpanelConfigError || days.some((d) => !stored.has(d))) throw e;
      stale = true;
    }
    if (fetched) {
      const fresh = new Map(Array.from(splitByDay(fetched, span), ([d, rows]) => [d, { fetchedAt, rows }] as const));
      fresh.forEach((rec, d) => stored.set(d, rec));
      await writeDays(fresh);
    }
  }

  const open = days.map((d) => stored.get(d)!).filter((r, i) => !isFinal(days[i], r.fetchedAt));
  return {
    rows: days.flatMap((d) => stored.get(d)!.rows),
    asOf: open.length ? Math.min(...open.map((r) => r.fetchedAt)) : null,
    stale,
  };
}
