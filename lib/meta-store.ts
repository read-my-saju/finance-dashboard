/**
 * Meta 광고 인사이트 영속 저장소 + rolling 7일 증분 동기화.
 *
 * 동기 전략 (사용자 요구 — 2026-05-23):
 *   - 새로고침은 전체 재조회가 아니라 증분.
 *   - last_synced_at 이후 데이터만 가져와 캠페인 단위 upsert (campaign_id + date).
 *   - 단, Meta 어트리뷰션 윈도우 때문에 최근 7일은 사후에도 전환이 갱신되므로
 *     "마지막 동기화 시점 이후"만 부르면 늦게 잡히는 전환을 놓친다.
 *     → 증분 조회 범위 = [min(last_synced_at, today-7d), today] (rolling window).
 *     → 7일 이전 데이터는 다시 부르지 않음 (영속 저장본 그대로 사용).
 *
 * KV 키 구조 (Upstash Redis):
 *   meta:row:{YYYY-MM-DD}:{campaign_id}  → JSON(MetaInsightRow)
 *   meta:dates                            → SET of YYYY-MM-DD (빠른 range scan 용)
 *   meta:last_synced_at                   → ISO timestamp 문자열
 *   meta:earliest_known                   → YYYY-MM-DD (최초 동기화한 가장 과거 일자)
 *
 * KV 가 비활성 (환경변수 미설정) 일 때는 전 기능 no-op. caller 는 in-memory
 * cache fallback 으로 동작.
 */

import { isKvEnabled, kv } from "./kv";
import {
  fetchDailyCampaignInsights,
  MetaApiError,
  MetaConfigError,
  type MetaInsightRow,
} from "./meta";

const ROLLING_DAYS = 7;

const KEY_LAST_SYNCED = "meta:last_synced_at";
const KEY_EARLIEST = "meta:earliest_known";
const KEY_DATES_SET = "meta:dates";
const KEY_ROW_PREFIX = "meta:row:";

function rowKey(date: string, campaignId: string): string {
  return `${KEY_ROW_PREFIX}${date}:${campaignId}`;
}

function todayKst(): string {
  // Meta 광고계정 시간대를 KST 로 가정. 광고계정 timezone 이 다르면
  // Meta time_range 도 그 시간대로 해석되므로 우리도 KST 로 통일.
  const now = new Date();
  // UTC 기준 시각에 KST offset (+9h) 적용해 YYYY-MM-DD 계산.
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

function ymdMinusDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function ymdMinIso(a: string, b: string): string {
  return a < b ? a : b;
}

function ymdRange(from: string, until: string): string[] {
  const out: string[] = [];
  if (from > until) return out;
  let cur = from;
  while (cur <= until) {
    out.push(cur);
    cur = ymdMinusDays(cur, -1);
  }
  return out;
}

export type IncrementalSyncResult = {
  // KV 가 비활성이거나 fallback 으로 전체 재조회한 경우 false.
  incremental: boolean;
  // 이번 호출에서 Meta API 를 실제로 다시 부른 일자 범위.
  fetchedFrom: string | null;
  fetchedUntil: string | null;
  // 사용자 요청 범위 안에서 KV 에서 가져온 row 들.
  rows: MetaInsightRow[];
  // Meta API 호출 실패 시 사용자에게 보일 메시지. 성공 시 null.
  metaError: string | null;
  // KV 갱신 후의 새 last_synced_at 타임스탬프 (또는 null).
  lastSyncedAt: string | null;
};

async function loadStoredRowsInRange(
  from: string,
  until: string,
): Promise<MetaInsightRow[]> {
  if (!isKvEnabled()) return [];
  const client = kv();
  const dates = await client.smembers<string[]>(KEY_DATES_SET);
  const inRange = (dates || []).filter((d) => d >= from && d <= until);
  if (inRange.length === 0) return [];

  // 모든 row 키를 모은다 — date 별로 그 날짜의 모든 campaign row 키.
  const allKeys: string[] = [];
  for (const date of inRange) {
    // date 단위로 row key prefix 를 scan. Upstash Redis 는 SCAN 을 지원.
    // 비교적 작은 데이터셋 (캠페인 수십 개 × 며칠) 이므로 cursor loop 가 빠르게 끝남.
    // @upstash/redis 의 SCAN cursor 는 number 타입 — 0 일 때 종료.
    let cursor = 0;
    do {
      const [next, batch] = await client.scan(cursor, {
        match: `${KEY_ROW_PREFIX}${date}:*`,
        count: 200,
      });
      allKeys.push(...batch);
      cursor = typeof next === "string" ? Number(next) : next;
    } while (cursor !== 0);
  }
  if (allKeys.length === 0) return [];

  // mget 으로 일괄 fetch. Upstash 는 JSON value 를 자동 parse.
  const values = await client.mget<(MetaInsightRow | null)[]>(...allKeys);
  return values.filter((v): v is MetaInsightRow => v !== null);
}

async function upsertRows(rows: MetaInsightRow[]): Promise<void> {
  if (!isKvEnabled() || rows.length === 0) return;
  const client = kv();

  // Upstash Redis 의 pipeline 으로 배치 처리. 키별 SET + dates SET 에 SADD.
  const pipe = client.pipeline();
  const dates = new Set<string>();
  for (const r of rows) {
    if (!r.date || !r.campaignId) continue;
    pipe.set(rowKey(r.date, r.campaignId), r);
    dates.add(r.date);
  }
  for (const d of dates) {
    pipe.sadd(KEY_DATES_SET, d);
  }
  await pipe.exec();
}

async function getLastSyncedAt(): Promise<string | null> {
  if (!isKvEnabled()) return null;
  const v = await kv().get<string>(KEY_LAST_SYNCED);
  return typeof v === "string" ? v : null;
}

async function setLastSyncedAt(iso: string): Promise<void> {
  if (!isKvEnabled()) return;
  await kv().set(KEY_LAST_SYNCED, iso);
}

async function getEarliestKnown(): Promise<string | null> {
  if (!isKvEnabled()) return null;
  const v = await kv().get<string>(KEY_EARLIEST);
  return typeof v === "string" ? v : null;
}

async function setEarliestKnown(date: string): Promise<void> {
  if (!isKvEnabled()) return;
  await kv().set(KEY_EARLIEST, date);
}

function ymdFromIso(iso: string): string {
  // KST 자정 기준으로 변환.
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return todayKst();
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function callMetaSafe(from: string, until: string): Promise<{
  rows: MetaInsightRow[];
  metaError: string | null;
}> {
  try {
    const { rows } = await fetchDailyCampaignInsights({ from, until });
    return { rows, metaError: null };
  } catch (e: any) {
    if (e instanceof MetaConfigError) return { rows: [], metaError: e.message };
    if (e instanceof MetaApiError) return { rows: [], metaError: e.userMessage };
    return {
      rows: [],
      metaError: `Meta 광고 데이터를 불러오지 못했습니다: ${String(e?.message || e).slice(0, 200)}`,
    };
  }
}

/**
 * 사용자 요청 [requestedFrom, requestedUntil] 범위 데이터를 보장하고 반환.
 *
 * 동작:
 *   1. force=true 또는 last_synced_at 존재
 *      → rolling 범위 [min(last_synced_at, today-7d), today] 를 Meta API 로 다시 조회 후 upsert.
 *   2. earliest_known 이 없거나 requestedFrom < earliest_known
 *      → [requestedFrom, earliest_known - 1] (없으면 [requestedFrom, rolling_from - 1]) 추가 backfill.
 *   3. KV 에서 [requestedFrom, requestedUntil] 의 모든 row 를 읽어 반환.
 *
 * KV 가 비활성이면 fallback 으로 [requestedFrom, requestedUntil] 전체 Meta 호출
 * (기존 동작 동일).
 */
export async function loadIncrementalRows(opts: {
  requestedFrom: string;
  requestedUntil: string;
  force: boolean;
}): Promise<IncrementalSyncResult> {
  const today = todayKst();
  // 일관성: requestedUntil 이 미래여도 today 까지로 자른다 (Meta API 가 어차피 future date 에 빈 응답).
  const requestedUntil = opts.requestedUntil > today ? today : opts.requestedUntil;
  const requestedFrom = opts.requestedFrom;

  // KV 비활성 — fallback 으로 전체 재조회.
  if (!isKvEnabled()) {
    const { rows, metaError } = await callMetaSafe(requestedFrom, requestedUntil);
    return {
      incremental: false,
      fetchedFrom: requestedFrom,
      fetchedUntil: requestedUntil,
      rows,
      metaError,
      lastSyncedAt: null,
    };
  }

  const lastSyncedAt = await getLastSyncedAt();
  const earliestKnown = await getEarliestKnown();
  let fetchedFrom: string | null = null;
  let fetchedUntil: string | null = null;
  let metaError: string | null = null;

  // Rolling 7일 + 그 이후 부분 = [min(last_synced_at_date, today-ROLLING_DAYS), today].
  const rollingFromCandidate = ymdMinusDays(today, ROLLING_DAYS);
  const lastSyncedDate = lastSyncedAt ? ymdFromIso(lastSyncedAt) : null;
  const rollingFrom = lastSyncedDate
    ? ymdMinIso(lastSyncedDate, rollingFromCandidate)
    : rollingFromCandidate;

  const shouldRollingFetch = opts.force || lastSyncedAt === null;
  if (shouldRollingFetch) {
    // 첫 호출 (last_synced_at 없음) 인 경우, 사용자가 7일보다 과거 from 을 요청했다면
    // rolling 범위 대신 [requestedFrom, today] 전체를 한 번에 부르는 게 자연스럽다.
    // → 두 번째 backfill 단계가 필요 없어진다.
    const initialFetch = lastSyncedAt === null;
    const fetchFrom = initialFetch ? ymdMinIso(requestedFrom, rollingFrom) : rollingFrom;
    const r = await callMetaSafe(fetchFrom, today);
    if (r.metaError) {
      metaError = r.metaError;
    } else {
      await upsertRows(r.rows);
      const nowIso = new Date().toISOString();
      await setLastSyncedAt(nowIso);
      const prevEarliest = earliestKnown;
      const newEarliest = prevEarliest
        ? ymdMinIso(prevEarliest, fetchFrom)
        : fetchFrom;
      await setEarliestKnown(newEarliest);
      fetchedFrom = fetchFrom;
      fetchedUntil = today;
    }
  }

  // Backfill: 사용자가 더 과거 from 을 요청한 경우, 알려진 가장 과거 일자보다 더 과거
  // 데이터가 KV 에 없으니 그 범위만 추가 fetch. rolling fetch 가 실패했어도 별도로 시도.
  const currentEarliest = await getEarliestKnown();
  if (currentEarliest && requestedFrom < currentEarliest) {
    const backfillUntil = ymdMinusDays(currentEarliest, 1);
    const r = await callMetaSafe(requestedFrom, backfillUntil);
    if (r.metaError && !metaError) metaError = r.metaError;
    if (!r.metaError) {
      await upsertRows(r.rows);
      await setEarliestKnown(requestedFrom);
      fetchedFrom = fetchedFrom ? ymdMinIso(fetchedFrom, requestedFrom) : requestedFrom;
      fetchedUntil = fetchedUntil || backfillUntil;
    }
  }

  const rows = await loadStoredRowsInRange(requestedFrom, requestedUntil);
  const finalLastSynced = await getLastSyncedAt();
  return {
    incremental: true,
    fetchedFrom,
    fetchedUntil,
    rows,
    metaError,
    lastSyncedAt: finalLastSynced,
  };
}

// Unit-test 및 진단용 export.
export const _testing = {
  ymdMinusDays,
  ymdMinIso,
  ymdRange,
  todayKst,
  ROLLING_DAYS,
};
