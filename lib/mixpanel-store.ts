/**
 * Mixpanel 귀속 결과 영속 저장 (Upstash KV) — 채널 성과가 조회할 때마다 JQL 을 치지 않게 한다.
 *
 * Mixpanel JQL 은 프로젝트당 시간당 호출 한도가 있고(약 60회), 귀속 계산 1번에 최대 3회를 쓴다.
 * 결제 1건의 귀속(UTM·방문기록 복원·신규 여부)은 결제 시점에 정해지므로 날짜별로 계산해 저장하고 재사용한다.
 *
 * KV 키: mx:attr:v2:{YYYY-MM-DD(KST)} → { fetchedAt: epoch ms, rows: PurchaseAttribution[], complete: boolean }
 *        mx:attr:lock → 갱신 중인 인스턴스 표시 (60초 만료)
 *
 * 갱신 규칙 (planFetch / isFinal):
 *   - 확정: 그날이 끝나고 48시간 뒤 이후에 받은 완전한 기록. 다시 조회하지 않는다.
 *     결제 이벤트는 서버(s2s)에서 즉시 들어오고, 늦게 올 수 있는 건 복원에 쓰는 클라이언트 방문 이벤트뿐이라 48시간을 둔다.
 *   - 불완전: 토스 결제 수의 절반도 Mixpanel 에서 못 찾은 날. 확정하지 않고 계속 다시 조회하되, 7일이 지나면 그대로 확정한다.
 *   - 확정 전 기록은 받은 지 15분이 지났을 때만 다시 조회한다. 새로고침 버튼도 이 규칙을 따른다.
 *   - 늦게 들어온 이벤트로 지난 날을 다시 계산해야 하면 KEY_PREFIX 버전을 올린다 (전 기간 1회 재조회).
 *
 * 실패 처리: KV 읽기·쓰기 실패는 화면을 막지 않는다(로그만). Mixpanel 실패는 기간 전체 저장본이 있으면 그것으로 계산하고 stale 로 알린다.
 * KV 환경변수가 없으면 같은 규칙을 서버 메모리에서 적용한다 (인스턴스마다 따로라 운영에서는 KV 를 연결할 것).
 */
import { isKvEnabled, kv } from "./kv";
import { fetchPurchaseAttributions, MixpanelConfigError } from "./mixpanel";
import type { PurchaseAttribution } from "./channel";

const KEY_PREFIX = "mx:attr:v2:";
const LOCK_KEY = "mx:attr:lock";
const LOCK_MS = 60_000;
const LOCK_WAIT_MS = 20_000;
const DAY_MS = 86_400_000;
const FINAL_AFTER_MS = 48 * 3600 * 1000;
const GIVE_UP_MS = 7 * DAY_MS;
const REFRESH_MS = 15 * 60 * 1000;
const MIN_MATCH = 0.5;
// Upstash 요청 크기 한도(무료 1MB) 안에 들도록 하루치(수십 KB)를 몇 개씩 묶어 읽고 쓴다.
const KV_BATCH = 8;

export type DayRecord = { fetchedAt: number; rows: PurchaseAttribution[]; complete: boolean };
export type StoredAttributions = {
  rows: PurchaseAttribution[];
  asOf: number | null; // 확정 전 날짜 중 가장 오래된 조회 시각 (모두 확정이면 null)
  stale: boolean; // 다시 조회해야 했지만 Mixpanel 이 실패해 저장본을 쓴 경우
};

const kstStartMs = (ymd: string) => Date.parse(`${ymd}T00:00:00+09:00`);
const kstDay = (ms: number) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function daysBetween(from: string, until: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${until}T00:00:00Z`); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** 더는 다시 조회하지 않는 기록인가. */
export function isFinal(day: string, rec: Pick<DayRecord, "fetchedAt" | "complete">): boolean {
  const end = kstStartMs(day) + DAY_MS;
  return rec.fetchedAt >= end + GIVE_UP_MS || (rec.complete && rec.fetchedAt >= end + FINAL_AFTER_MS);
}

/** 다시 조회해야 하는 날짜 (오름차순). */
export function planFetch(days: string[], stored: Map<string, DayRecord>, now: number): string[] {
  return days.filter((d) => {
    const r = stored.get(d);
    return !r || (!isFinal(d, r) && now - r.fetchedAt >= REFRESH_MS);
  });
}

/** 결제 시각(KST) 기준으로 날짜별로 나눈다. 요청한 날짜는 결제가 없어도 빈 배열로 남기고, 범위 밖 행은 버린다. */
export function splitByDay(rows: PurchaseAttribution[], days: string[]): Map<string, PurchaseAttribution[]> {
  const out = new Map(days.map((d) => [d, [] as PurchaseAttribution[]]));
  for (const r of rows) out.get(kstDay(r.ts))?.push(r);
  return out;
}

/** 조회한 범위에서 필요한 날짜만 기록으로 만든다. 토스 결제 수의 절반도 못 찾은 날은 불완전으로 표시. */
export function buildRecords(
  rows: PurchaseAttribution[],
  need: string[],
  expected: Map<string, number>,
  fetchedAt: number,
): Map<string, DayRecord> {
  const byDay = splitByDay(rows, need);
  return new Map(need.map((d) => {
    const dayRows = byDay.get(d)!;
    const exp = expected.get(d) ?? 0;
    return [d, { fetchedAt, rows: dayRows, complete: exp === 0 || dayRows.length >= exp * MIN_MATCH }];
  }));
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
  try {
    for (const part of chunks(days, KV_BATCH)) {
      const vals = await kv().mget<(DayRecord | null)[]>(...part.map((d) => KEY_PREFIX + d));
      part.forEach((d, i) => {
        const v = vals[i];
        if (v && Array.isArray(v.rows) && typeof v.fetchedAt === "number") out.set(d, { ...v, complete: v.complete !== false });
      });
    }
  } catch (e) {
    console.error("[mixpanel-store] KV 읽기 실패 — 저장본 없이 진행", e);
  }
  return out;
}

async function writeDays(records: Map<string, DayRecord>): Promise<void> {
  if (!isKvEnabled()) {
    records.forEach((rec, d) => memory.set(d, rec));
    return;
  }
  try {
    // 묶음마다 MULTI/EXEC 로 한 번에 쓴다 (일부 키만 쓰이는 일 방지).
    for (const part of chunks(Array.from(records), KV_BATCH)) {
      const tx = kv().multi();
      for (const [d, rec] of part) tx.set(KEY_PREFIX + d, rec);
      await tx.exec();
    }
  } catch (e) {
    console.error("[mixpanel-store] KV 쓰기 실패 — 다음 조회 때 다시 받음", e);
  }
}

/** 다른 인스턴스가 갱신 중이면 false. KV 가 없으면 항상 true. */
async function tryLock(token: string): Promise<boolean> {
  if (!isKvEnabled()) return true;
  try {
    return (await kv().set(LOCK_KEY, token, { nx: true, px: LOCK_MS })) === "OK";
  } catch (e) {
    console.error("[mixpanel-store] 잠금 실패 — 잠금 없이 진행", e);
    return true;
  }
}

async function unlock(token: string): Promise<void> {
  if (!isKvEnabled()) return;
  try {
    if ((await kv().get<string>(LOCK_KEY)) === token) await kv().del(LOCK_KEY);
  } catch (e) {
    console.error("[mixpanel-store] 잠금 해제 실패 — 60초 뒤 자동 만료", e);
  }
}

async function waitForUnlock(): Promise<void> {
  if (!isKvEnabled()) return;
  for (let waited = 0; waited < LOCK_WAIT_MS; waited += 1000) {
    await sleep(1000);
    try {
      if ((await kv().get(LOCK_KEY)) == null) return;
    } catch {
      return;
    }
  }
}

// 같은 인스턴스 안의 동시 요청은 진행 중인 갱신 하나를 기다린다.
let inflight: Promise<unknown> | null = null;

/** 필요한 날짜를 Mixpanel 에서 받아 저장. 다른 갱신이 진행 중이면 끝나길 기다린 뒤 다시 판단한다. */
async function refresh(days: string[], stored: Map<string, DayRecord>, expected: Map<string, number>): Promise<{ failed: unknown }> {
  if (inflight) {
    await inflight.catch(() => undefined);
    (await readDays(days)).forEach((rec, d) => stored.set(d, rec));
  }
  let need = planFetch(days, stored, Date.now());
  if (need.length === 0) return { failed: null };

  const token = `${Date.now()}-${Math.random()}`;
  if (!(await tryLock(token))) {
    await waitForUnlock();
    (await readDays(days)).forEach((rec, d) => stored.set(d, rec));
    need = planFetch(days, stored, Date.now());
    if (need.length === 0) return { failed: null };
  }

  const run = (async () => {
    const fetchedAt = Date.now();
    // 필요한 날짜가 띄엄띄엄이어도 JQL 은 한 범위로 한 번만 보내고, 저장은 필요한 날짜만 한다.
    const rows = await fetchPurchaseAttributions(need[0], need[need.length - 1]);
    const records = buildRecords(rows, need, expected, fetchedAt);
    records.forEach((rec, d) => stored.set(d, rec));
    await writeDays(records);
  })();
  inflight = run;
  try {
    await run;
    return { failed: null };
  } catch (e) {
    return { failed: e };
  } finally {
    if (inflight === run) inflight = null;
    await unlock(token);
  }
}

/**
 * KST [from, until] 결제 귀속. 저장본을 우선 쓰고, 필요한 날짜만 Mixpanel 에서 받아 저장한다.
 * expected: 날짜별 토스 결제 수 (불완전한 조회 판정용).
 */
export async function loadStoredAttributions(
  from: string,
  until: string,
  expected: Map<string, number> = new Map(),
): Promise<StoredAttributions> {
  const days = daysBetween(from, until);
  const stored = await readDays(days);
  let stale = false;

  if (planFetch(days, stored, Date.now()).length > 0) {
    const { failed } = await refresh(days, stored, expected);
    if (failed) {
      if (failed instanceof MixpanelConfigError || days.some((d) => !stored.has(d))) throw failed;
      stale = true;
    }
  }

  const open = days.map((d) => stored.get(d)!).filter((r, i) => !isFinal(days[i], r));
  return {
    rows: days.flatMap((d) => stored.get(d)!.rows),
    asOf: open.length ? Math.min(...open.map((r) => r.fetchedAt)) : null,
    stale,
  };
}
