/**
 * Mixpanel JQL client — 결제별 유입 귀속 재료(PurchaseAttribution) 수집.
 *
 * 환경변수 (Service Account, Consumer 권한이면 충분 — JQL 만 사용):
 *   MIXPANEL_SA_USERNAME   서비스 계정 username
 *   MIXPANEL_SA_SECRET     서비스 계정 secret
 *   MIXPANEL_PROJECT_ID    프로젝트 ID
 *
 * 쿼리 3개:
 *   1. 결제: s2s_purchase_verified (서버 이벤트, transaction_id = 토스 orderId, utm_* 는 마지막 유입)
 *   2. 이전 결제: 같은 구매자들의 과거 결제 시각 → 신규/재구매 판정
 *   3. 접점 복원: utm 이 비어 있는 결제자만, 결제 전 7일 방문의 utm·fbclid·referrer·인앱 UA
 *
 * 함정: JQL from_date/to_date 는 UTC 날짜다. KST 하루를 다 받으려고 앞뒤 하루씩 넓혀 받고 KST 로 자른다.
 */
import type { PurchaseAttribution } from "./channel";

const JQL_URL = "https://mixpanel.com/api/query/jql";
const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 7;
// 이 날짜 이전 결제 이벤트는 신규/재구매 판정용으로만 본다 (Mixpanel 결제 이벤트 수집 시작 무렵).
const HISTORY_FROM = "2026-07-20";

export class MixpanelConfigError extends Error {}

function env() {
  const u = process.env.MIXPANEL_SA_USERNAME;
  const s = process.env.MIXPANEL_SA_SECRET;
  const p = process.env.MIXPANEL_PROJECT_ID;
  if (!u || !s || !p) {
    throw new MixpanelConfigError(
      "MIXPANEL_SA_USERNAME / MIXPANEL_SA_SECRET / MIXPANEL_PROJECT_ID 환경변수가 없어 채널별 매출을 계산할 수 없습니다.",
    );
  }
  return { u, s, p };
}

async function jql<T>(script: string): Promise<T> {
  const { u, s, p } = env();
  const res = await fetch(JQL_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${u}:${s}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ script, project_id: p }).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mixpanel JQL ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function kstStartMs(ymd: string): number {
  return new Date(`${ymd}T00:00:00+09:00`).getTime();
}

type RawPurchase = {
  t: number; d: string; tx?: string;
  src?: string; med?: string; camp?: string; cont?: string; inf?: string;
};
type Touch = [number, string | null, string | null, string | null, string | null, 0 | 1, string | null];
type TouchState = { touch: Touch[]; apps: Array<[number, "IG" | "FB" | "KAKAO" | "NAVER"]> };

const PURCHASES_JQL = (from: string, to: string) => `function main(){
  return Events({from_date:'${from}',to_date:'${to}',event_selectors:[{event:'s2s_purchase_verified'}]})
  .map(function(e){var p=e.properties;return {t:e.time,d:e.distinct_id,tx:p.transaction_id,
    src:p.utm_source,med:p.utm_medium,camp:p.utm_campaign,cont:p.utm_content,inf:p.influencer_code};});
}`;

const hasUtm = (r: RawPurchase) => Boolean(r.src || r.camp || r.inf || r.med);

/**
 * 같은 transaction_id 이벤트가 재전송돼 여럿이면 하나만 남긴다: UTM 있는 것 → 가장 이른 것.
 * 응답 순서와 무관하게 같은 결과가 나와야 채널 분류가 흔들리지 않는다.
 */
export function onePerTx<T extends RawPurchase>(rows: T[]): T[] {
  const better = (a: T, b: T) => (hasUtm(a) !== hasUtm(b) ? hasUtm(a) : a.t < b.t);
  const byTx = new Map<string, T>();
  for (const r of rows) {
    if (!r.tx) continue;
    const cur = byTx.get(r.tx);
    if (!cur || better(r, cur)) byTx.set(r.tx, r);
  }
  return Array.from(byTx.values());
}

const userSet = (users: string[]) => JSON.stringify(Object.fromEntries(users.map((u) => [u, 1])));

const BUYS_JQL = (users: string[], to: string) => `function main(){var S=${userSet(users)};
  return Events({from_date:'${HISTORY_FROM}',to_date:'${to}',event_selectors:[{event:'s2s_purchase_verified'},{event:'purchase_verified'}]})
  .filter(function(e){return S[e.distinct_id];})
  .groupByUser(function(st,evs){st=st||[];for(var i=0;i<evs.length;i++)st.push(evs[i].time);return st;});
}`;

// 내부 도메인·결제창·로그인 리다이렉트는 유입 경로가 아님.
const TOUCH_JQL = (users: string[], from: string, to: string) => String.raw`function main(){var S=${userSet(users)};
  var INT=/(^|\.)pouri\.kr$|readmysaju\.com$|kauth\.kakao\.com|accounts\.google|toss|portone|iamport|kakaopay|naverpay|payco|inicis|nicepay|\$direct/;
  function ua(s){if(!s)return null;if(s.indexOf('Instagram')>=0)return 'IG';if(s.indexOf('FBAN')>=0||s.indexOf('FB_IAB')>=0)return 'FB';
    if(s.indexOf('KAKAOTALK')>=0)return 'KAKAO';if(s.indexOf('NAVER')>=0)return 'NAVER';return null;}
  return Events({from_date:'${from}',to_date:'${to}'}).filter(function(e){return S[e.distinct_id];})
  .groupByUser(function(st,evs){st=st||{touch:[],apps:[]};for(var i=0;i<evs.length;i++){var e=evs[i],p=e.properties;
    if(e.name==='s2s_purchase_verified'||e.name==='purchase_verified')continue;
    var a=ua(p['$mp_raw_user_agent']);if(a)st.apps.push([e.time,a]);
    var rd=p['$referring_domain'];var ext=rd&&!INT.test(rd)?rd:null;
    if(p.utm_source||p.utm_campaign||p.entry_utm_source||p.fbclid||ext)
      st.touch.push([e.time,p.utm_source||p.entry_utm_source||null,p.utm_medium||null,p.utm_campaign||p.entry_utm_campaign||null,p.utm_content||null,p.fbclid?1:0,ext]);
  }return st;});
}`;

/**
 * KST [from, until] 결제의 귀속 재료. 결제 1건 = 원소 1개 (transaction_id 없는 이벤트는 버림).
 */
export async function fetchPurchaseAttributions(from: string, until: string): Promise<PurchaseAttribution[]> {
  const lo = kstStartMs(from);
  const hi = kstStartMs(shiftYmd(until, 1));
  const utcTo = shiftYmd(until, 1);

  const raw = onePerTx((await jql<RawPurchase[]>(PURCHASES_JQL(shiftYmd(from, -1), utcTo)))
    .filter((r) => r.t >= lo && r.t < hi));
  if (raw.length === 0) return [];

  const users = Array.from(new Set(raw.map((r) => r.d)));
  const untagged = Array.from(new Set(raw.filter((r) => !hasUtm(r)).map((r) => r.d)));

  const [buysRows, touchRows] = await Promise.all([
    jql<Array<{ key: [string]; value: number[] }>>(BUYS_JQL(users, utcTo)),
    untagged.length
      ? jql<Array<{ key: [string]; value: TouchState }>>(TOUCH_JQL(untagged, shiftYmd(from, -LOOKBACK_DAYS - 1), utcTo))
      : Promise.resolve([]),
  ]);
  const buys = new Map(buysRows.map((r) => [r.key[0], r.value]));
  const touches = new Map(touchRows.map((r) => [r.key[0], r.value]));

  return raw.map((r): PurchaseAttribution => {
    // 1분 여유: 같은 결제의 클라이언트 이벤트(purchase_verified)가 몇 초 앞서 찍히는 경우 재구매로 오판 방지.
    const isNew = !(buys.get(r.d) || []).some((t) => t < r.t - 60_000);
    const base = { tx: r.tx!, user: r.d, ts: r.t, isNew };
    if (hasUtm(r)) {
      return { ...base, how: "utm", src: r.src, med: r.med, camp: r.camp, cont: r.cont, inf: r.inf };
    }
    const st = touches.get(r.d);
    const inWindow = (t: number) => t <= r.t && t >= r.t - LOOKBACK_DAYS * DAY_MS;
    const last = st?.touch.filter((x) => inWindow(x[0])).sort((a, b) => a[0] - b[0]).pop();
    if (last) {
      return {
        ...base, how: "touch",
        src: last[1] || undefined, med: last[2] || undefined, camp: last[3] || undefined, cont: last[4] || undefined,
        fbclid: last[5] === 1 || undefined, ref: last[6] || undefined,
      };
    }
    const app = st?.apps.filter((x) => inWindow(x[0])).sort((a, b) => a[0] - b[0]).pop()?.[1];
    return { ...base, how: "none", app };
  });
}
