/**
 * Meta Marketing API (Graph) — 광고 인사이트 fetcher.
 *
 * 환경변수:
 *   META_ACCESS_TOKEN     System User 또는 long-lived access token (필수, 서버 전용)
 *   META_AD_ACCOUNT_ID    `act_xxxxxxx` 형식의 광고계정 ID (필수)
 *   META_API_VERSION      graph API version, default "v21.0"
 *
 * 호출 정책 (사장님 요구사항):
 *   - level=campaign, time_increment=1 (일별 campaign 단위)
 *   - filtering=[{field:"campaign.effective_status",operator:"IN",
 *                 value:["ACTIVE","PAUSED","ARCHIVED","DELETED"]}] 모두 포함
 *   - paging cursor 따라가서 전체 수집
 *   - access token 은 어떤 응답/로그에도 포함되지 않도록 마스킹
 *   - 권한/만료 오류는 사람이 이해할 한국어 메시지로 변환
 *
 * spend 단위: Meta 는 광고계정 통화 (KRW) 의 정수 문자열을 반환. Number 로 변환.
 */

const GRAPH = "https://graph.facebook.com";

export type MetaInsightRow = {
  date: string;            // YYYY-MM-DD (date_start)
  campaignId: string;
  campaignName: string;
  spend: number;           // KRW (광고계정 통화)
  impressions: number;
  clicks: number;
  ctr: number | null;      // %
  cpc: number | null;      // KRW
  cpm: number | null;      // KRW
  // 광고 운영 핵심 KPI — Meta insights actions/action_values 에서 파생.
  // purchases: action_type === "purchase" 의 value 합.
  // purchaseValue: action_type === "purchase" 의 action_values value 합 (광고비 통화).
  purchases: number;
  purchaseValue: number;
  // reach / frequency: Meta insights 가 일자별 캠페인 단위로 직접 제공.
  reach: number;
  frequency: number | null;
};

export type MetaCampaignBudget = {
  campaignId: string;
  // daily_budget / lifetime_budget 둘 중 하나만 세팅됨 (Meta 규칙).
  // 광고계정 통화의 minor unit (KRW 는 1=1원). 자릿수 그대로 사용.
  dailyBudget: number | null;
  lifetimeBudget: number | null;
};

export type MetaFetchDebug = {
  attempts: Array<{
    url: string;
    status: number;
    itemsCount: number;
    nextPage: boolean;
  }>;
  totalItems: number;
  stopReason: string;
};

export class MetaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaConfigError";
  }
}

export class MetaApiError extends Error {
  status: number;
  userMessage: string;
  constructor(status: number, userMessage: string, internal: string) {
    super(internal);
    this.name = "MetaApiError";
    this.status = status;
    this.userMessage = userMessage;
  }
}

function token(): string {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) {
    throw new MetaConfigError(
      "META_ACCESS_TOKEN 이 설정되지 않았습니다. Vercel 환경변수에 페이스북 광고관리자 → 비즈니스설정 → 시스템사용자 access token 을 추가해주세요.",
    );
  }
  return t;
}

function adAccountId(): string {
  const a = process.env.META_AD_ACCOUNT_ID;
  if (!a) {
    throw new MetaConfigError(
      "META_AD_ACCOUNT_ID 가 설정되지 않았습니다. `act_숫자` 형식 (예: act_123456789) 으로 환경변수에 추가해주세요.",
    );
  }
  return a.startsWith("act_") ? a : `act_${a}`;
}

function apiVersion(): string {
  return process.env.META_API_VERSION || "v21.0";
}

/**
 * Meta access token 을 query string 에 그대로 노출하면 Vercel access log,
 * Next.js fetch warning 등에서 새어나갈 수 있다. 사람이 읽는 출력
 * 어디에도 token 자체가 들어가지 않도록 마스킹 후 사용.
 */
function maskUrl(u: string): string {
  return u.replace(/access_token=[^&]+/g, "access_token=***");
}

/**
 * Meta error 응답을 사장님이 읽을 한국어 메시지로 변환.
 *
 *  - OAuthException + code 190  → 토큰 만료
 *  - OAuthException + code 200  → 권한 부족
 *  - rate limit code 17, 4, 32  → 요청 제한
 *  - 그 외                       → "광고 API 호출 실패: <짧은 메시지>"
 */
function humanizeMetaError(status: number, body: any): string {
  const err = body?.error || {};
  const code = err.code;
  const subcode = err.error_subcode;
  const type = err.type || "";
  const msg = (err.message || "").slice(0, 200);

  if (status === 400 && type === "OAuthException" && code === 190) {
    return "Meta access token 이 만료되었거나 유효하지 않습니다. 비즈니스 설정에서 시스템 사용자 토큰을 재발급해주세요.";
  }
  if (status === 403 || (type === "OAuthException" && code === 200)) {
    return "Meta access token 의 권한이 부족합니다. ads_read 권한과 광고계정 접근 권한을 확인해주세요.";
  }
  if (code === 17 || code === 4 || code === 32 || code === 613) {
    return "Meta API rate limit 에 도달했습니다. 1~2시간 후 다시 시도해주세요.";
  }
  if (status === 404) {
    return `Meta 광고계정을 찾을 수 없습니다. META_AD_ACCOUNT_ID 가 정확한지 확인해주세요.`;
  }
  if (subcode === 463) {
    return "Meta access token 의 세션이 만료되었습니다. 토큰을 재발급해주세요.";
  }
  return `Meta API 호출 실패 (status ${status}): ${msg || "알 수 없는 오류"}`;
}

function buildInsightsUrl(args: { from: string; until: string; after?: string }): string {
  const fields = [
    "date_start",
    "date_stop",
    "campaign_id",
    "campaign_name",
    "spend",
    "impressions",
    "clicks",
    "ctr",
    "cpc",
    "cpm",
    "reach",
    "frequency",
    "actions",
    "action_values",
  ].join(",");

  const params = new URLSearchParams({
    access_token: token(),
    fields,
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since: args.from, until: args.until }),
    // ACTIVE 외에 일시정지·삭제된 캠페인도 spend 가 있을 수 있어 모두 포함.
    filtering: JSON.stringify([
      {
        field: "campaign.effective_status",
        operator: "IN",
        value: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES"],
      },
    ]),
    limit: "500",
  });
  if (args.after) params.set("after", args.after);
  return `${GRAPH}/${apiVersion()}/${adAccountId()}/insights?${params.toString()}`;
}

function parseNum(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Meta insights 의 actions/action_values 배열에서 purchase 전환만 합산.
 * action_type 은 채널마다 다양 (offsite_conversion.fb_pixel_purchase 등) 하므로
 * 정확히 "purchase" 인 항목과 ".purchase" 로 끝나는 항목을 모두 포함.
 */
function sumPurchaseActions(arr: any): number {
  if (!Array.isArray(arr)) return 0;
  let total = 0;
  for (const a of arr) {
    const type = String(a?.action_type || "");
    if (type === "purchase" || type.endsWith(".purchase")) {
      total += parseNum(a?.value);
    }
  }
  return total;
}

/**
 * 기간 내 일별 campaign 광고 인사이트 전량 fetch.
 * from/until: YYYY-MM-DD (Meta time_range 와 동일 포맷)
 */
export async function fetchDailyCampaignInsights(opts: {
  from: string;
  until: string;
}): Promise<{ rows: MetaInsightRow[]; debug: MetaFetchDebug }> {
  const debug: MetaFetchDebug = { attempts: [], totalItems: 0, stopReason: "loop_end" };
  const rows: MetaInsightRow[] = [];

  let after: string | undefined;
  for (let i = 0; i < 50; i++) {
    const url = buildInsightsUrl({ from: opts.from, until: opts.until, after });
    let res: Response;
    try {
      res = await fetch(url, { method: "GET", cache: "no-store" });
    } catch (e: any) {
      throw new MetaApiError(0, `네트워크 오류로 Meta API 호출이 실패했습니다: ${e?.message || e}`, "fetch_failed");
    }
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }

    if (!res.ok) {
      const user = humanizeMetaError(res.status, body);
      // 디버그/로그에 token 노출 금지.
      debug.attempts.push({
        url: maskUrl(url),
        status: res.status,
        itemsCount: 0,
        nextPage: false,
      });
      debug.stopReason = `status_${res.status}`;
      throw new MetaApiError(res.status, user, `meta_status_${res.status}`);
    }

    const items: any[] = Array.isArray(body?.data) ? body.data : [];
    for (const it of items) {
      rows.push({
        date: String(it.date_start || ""),
        campaignId: String(it.campaign_id || ""),
        campaignName: String(it.campaign_name || ""),
        spend: parseNum(it.spend),
        impressions: parseNum(it.impressions),
        clicks: parseNum(it.clicks),
        ctr: nullableNum(it.ctr),
        cpc: nullableNum(it.cpc),
        cpm: nullableNum(it.cpm),
        reach: parseNum(it.reach),
        frequency: nullableNum(it.frequency),
        purchases: sumPurchaseActions(it.actions),
        purchaseValue: sumPurchaseActions(it.action_values),
      });
    }

    const next = body?.paging?.cursors?.after as string | undefined;
    const hasNextPage = Boolean(body?.paging?.next) && Boolean(next);
    debug.attempts.push({
      url: maskUrl(url),
      status: res.status,
      itemsCount: items.length,
      nextPage: hasNextPage,
    });

    if (!hasNextPage) {
      debug.stopReason = "no_next_page";
      break;
    }
    after = next;
  }

  debug.totalItems = rows.length;
  return { rows, debug };
}

/**
 * 일별 캠페인 row 를 (date) 기준으로 합산한다.
 * campaign 별 한 줄씩 들어오는 raw 를 일별 광고비 시계열로 압축.
 */
export function aggregateMetaByDay(
  rows: MetaInsightRow[],
): Array<{ date: string; spend: number; impressions: number; clicks: number }> {
  const m = new Map<string, { spend: number; impressions: number; clicks: number }>();
  for (const r of rows) {
    if (!r.date) continue;
    const cur = m.get(r.date) || { spend: 0, impressions: 0, clicks: 0 };
    cur.spend += r.spend;
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    m.set(r.date, cur);
  }
  return Array.from(m.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type CampaignAggregate = {
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  purchases: number;
  purchaseValue: number;
};

/**
 * 캠페인 단위 집계 — 기간 전체 합산. ROAS 표 표시용.
 *
 * reach 는 일별 unique user 합 — 기간 reach 와 동일하지 않음 (Meta API 한계).
 * frequency 는 표시 단계에서 impressions/reach 로 다시 계산.
 */
export function aggregateMetaByCampaign(rows: MetaInsightRow[]): CampaignAggregate[] {
  const m = new Map<string, Omit<CampaignAggregate, "campaignId">>();
  for (const r of rows) {
    if (!r.campaignId) continue;
    const cur = m.get(r.campaignId) || {
      campaignName: r.campaignName,
      spend: 0,
      impressions: 0,
      clicks: 0,
      reach: 0,
      purchases: 0,
      purchaseValue: 0,
    };
    cur.spend += r.spend;
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    cur.reach += r.reach;
    cur.purchases += r.purchases;
    cur.purchaseValue += r.purchaseValue;
    if (r.campaignName) cur.campaignName = r.campaignName;
    m.set(r.campaignId, cur);
  }
  return Array.from(m.entries())
    .map(([campaignId, v]) => ({ campaignId, ...v }))
    .sort((a, b) => b.spend - a.spend);
}

/**
 * 활성/최근 캠페인의 daily_budget / lifetime_budget 을 한 번에 fetch.
 *
 * Meta 는 캠페인 예산을 insights 가 아니라 별도 /campaigns 엔드포인트에서만
 * 제공한다. campaign_id 1개씩 부르면 N+1 폭발이므로 광고계정 단위로
 * effective_status 전체 통과시키고 paging cursor 따라가서 한꺼번에 받는다.
 *
 * 반환: 캠페인 id → 예산. id 가 응답에 없으면 빈 항목 (UI 에서 "-").
 */
export async function fetchCampaignBudgets(): Promise<Map<string, MetaCampaignBudget>> {
  const fields = ["id", "daily_budget", "lifetime_budget"].join(",");
  const out = new Map<string, MetaCampaignBudget>();

  const baseParams = new URLSearchParams({
    access_token: token(),
    fields,
    limit: "500",
    filtering: JSON.stringify([
      {
        field: "effective_status",
        operator: "IN",
        value: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES"],
      },
    ]),
  });

  let after: string | undefined;
  for (let i = 0; i < 50; i++) {
    const params = new URLSearchParams(baseParams);
    if (after) params.set("after", after);
    const url = `${GRAPH}/${apiVersion()}/${adAccountId()}/campaigns?${params.toString()}`;

    let res: Response;
    try {
      res = await fetch(url, { method: "GET", cache: "no-store" });
    } catch (e: any) {
      throw new MetaApiError(0, `네트워크 오류로 Meta API 호출이 실패했습니다: ${e?.message || e}`, "fetch_failed");
    }
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }

    if (!res.ok) {
      const user = humanizeMetaError(res.status, body);
      throw new MetaApiError(res.status, user, `meta_campaigns_status_${res.status}`);
    }

    const items: any[] = Array.isArray(body?.data) ? body.data : [];
    for (const it of items) {
      const id = String(it.id || "");
      if (!id) continue;
      out.set(id, {
        campaignId: id,
        dailyBudget: nullableNum(it.daily_budget),
        lifetimeBudget: nullableNum(it.lifetime_budget),
      });
    }

    const next = body?.paging?.cursors?.after as string | undefined;
    if (!body?.paging?.next || !next) break;
    after = next;
  }
  return out;
}
