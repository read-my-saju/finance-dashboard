/**
 * 결제 1건의 유입 채널 분류 (순수 함수 — 네트워크·KV 없음).
 *
 * 판정 순서 (2026-10-10 사장님 확정, 마지막 유입 기준):
 *   1. 결제 이벤트(s2s_purchase_verified)의 utm_* / influencer_code
 *      UTM 안에서는 할인코드 → 메타(캠페인 ID·광고 URL 태그) → utm_medium=inf → 자사 SNS(카카오 포함) → 키워드 → 검색광고 → 기타
 *   2. 없으면 결제 전 7일 안 마지막 방문의 utm·fbclid·referrer (lib/mixpanel.ts 가 채움)
 *   3. 인앱 브라우저 흔적
 *   4. 미귀속
 *
 * 메타 캠페인은 utm_campaign 의 캠페인 ID 로 잇는다. 수동 태그(264QS·pu_3Q_* 등)는 Meta 에서 받은 광고별 url_tags
 * 표(utm_content 까지 같은 광고 → utm_campaign 만 같은 광고)로 찾고, 표에 없으면 캠페인 이름 키워드로 찾는다.
 * 캠페인 이름·ID 를 하드코딩하지 않는다 — Meta insights 에서 받은 목록을 넘겨받음.
 */

import type { AdTagRef } from "./meta";
import { influencerName } from "./influencers";

export type ChannelGroup = "meta" | "search" | "search_ad" | "owned" | "influencer" | "referral" | "unattributed";

export const CHANNEL_LABEL: Record<ChannelGroup, string> = {
  meta: "메타 광고",
  search: "검색",
  search_ad: "검색광고",
  owned: "자사 SNS",
  influencer: "인플루언서",
  referral: "레퍼럴",
  unattributed: "미귀속",
};

/** Mixpanel 에서 모은 결제 1건의 귀속 재료. KV 에 그대로 저장하고 분류는 읽을 때 한다. */
export type PurchaseAttribution = {
  tx: string;              // transaction_id = 토스 orderId
  user: string;
  ts: number;              // epoch ms
  isNew: boolean;          // 이 결제 이전에 결제 이력이 없음
  // 결제 이벤트 값 (how=utm) 또는 복원한 마지막 방문 값 (how=touch)
  how: "utm" | "touch" | "none";
  src?: string;
  med?: string;
  camp?: string;
  cont?: string;
  inf?: string;            // influencer_code
  term?: string;           // utm_term — 할인 링크 추적값 (lib/influencers.ts)
  // 할인 링크 결제인데 결제 전 7일 안에 메타 광고 링크로 들어온 방문이 있으면 그 방문의 utm (lib/mixpanel.ts).
  // 시딩 광고 → 댓글 → DM 할인 링크 → 결제 흐름에서 광고가 만든 매출을 메타 캠페인에 돌려준다 (2026-11-03).
  viaMeta?: { src?: string; med?: string; camp?: string; cont?: string };
  fbclid?: boolean;
  ref?: string;            // 외부 referring domain
  app?: "IG" | "FB" | "KAKAO" | "NAVER";
  rt?: string;             // 결제 이벤트 report_type — 세트 구분용 (lib/sets.ts)
};

export type CampaignRef = { id: string; name: string };

export type ChannelResult = {
  group: ChannelGroup;
  detail: string;          // 표의 세부 행 이름
  campaignId?: string;     // 메타 캠페인으로 확정된 경우
  viaDiscount?: boolean;   // 할인 링크 결제를 결제 전 메타 광고 클릭으로 메타에 넣은 경우
};

// 수동 UTM 태그 → 캠페인 이름 키워드. 광고 url_tags 표에 없을 때만 쓰는 예비 규칙.
// 이름 일부만 쓴다 — 연애 캠페인 이름이 '…연애운'에서 '26_3Q_연애_…'로 바뀌어 매칭이 끊겼다 (2026-11-02).
const MANUAL_TAG_KEYWORD: Array<[RegExp, string]> = [
  [/^pu_3Q_job|^pu_3Q_sun_new_mg/i, "취업운"],
  // 10/22 새 소재는 pu_ 없이 4Q_lo·4Q_ny, dohwa.lin 파트너십은 264QS 로 들어옴
  [/^(pu_)?[34]Q_lo|^264QS$/i, "연애"],
  [/^pu_[34]Q_sun/i, "수능운"],
  [/^(pu_)?4Q_ny/i, "신년운"],
];

const OWNED_SOURCE: Record<string, string> = { ig: "인스타 프로필", kakao: "카카오 채널", kko: "카카오 채널", meta: "페이스북 프로필", fb: "페이스북 프로필" };
const META_SOURCES = new Set(["ig", "fb", "meta", "th", "fbig", "an", "msg"]);
// 유료 검색광고 매체값 (네이버 파워링크 = utm_source=naver&utm_medium=cpc). 메타 게재 위치 source 면 메타로 둔다.
const SEARCH_AD_MEDIUMS = new Set(["cpc", "ppc", "sa", "paid_search"]);
const SEARCH_AD_NAME: Record<string, string> = { naver: "네이버 파워링크", google: "구글 검색광고" };
// 로그인·결제 중간 페이지 — 유입 경로가 아니므로 referrer 로 쓰지 않는다.
const REDIRECT_REF = /(^|\.)nid\.naver\.com$|(^|\.)pay\.naver\.com$/;

/**
 * 광고 url_tags 표로 캠페인 찾기. utm_content 까지 같은 광고가 있으면 그 광고들만, 없으면 utm_campaign 이 같은 광고.
 * 후보가 여러 캠페인이면 최근 집행 캠페인(campaigns 순서). 그 기간 광고비가 없어 목록에 없는 캠페인이어도
 * 다른 캠페인으로 넘기지 않고 그 캠페인으로 둔다 (264QS 가 연애로 잘못 가던 문제의 재발 방지).
 */
function byAdTag(camp: string, cont: string, campaigns: CampaignRef[], tags: AdTagRef[]): CampaignRef | undefined {
  const same = tags.filter((t) => t.camp.toLowerCase() === camp.toLowerCase());
  const exact = same.filter((t) => t.cont.toLowerCase() === cont.toLowerCase());
  const pool = exact.length ? exact : same;
  if (!pool.length) return undefined;
  const ids = new Set(pool.map((t) => t.campaignId));
  return campaigns.find((c) => ids.has(c.id)) ?? { id: pool[0].campaignId, name: pool[0].campaignName || "캠페인 불명" };
}

function byUtm(a: PurchaseAttribution, campaigns: CampaignRef[], tags: AdTagRef[]): ChannelResult {
  const src = (a.src || "").toLowerCase();
  const med = (a.med || "").toLowerCase();
  const camp = a.camp || "";
  if (src === "claudetest") return { group: "unattributed", detail: "내부 테스트" };
  // 카카오 채널·메시지는 할인 코드가 붙어도 우리가 보낸 링크 (263Q_p 푸리 고객 = 9/25 추석 카카오, 2026-11-03 사장님 결정)
  if (src === "kko" || src === "kakao") {
    return { group: "owned", detail: src === "kko" && med === "ms" ? "카카오 메시지" : OWNED_SOURCE[src] };
  }
  // 할인 링크 결제: 결제 전 메타 광고 클릭이 있으면 그 메타 캠페인, 아니면 인플루언서(이름은 콘솔 목록)
  const discount = (fallback: string): ChannelResult => {
    if (a.viaMeta) {
      const viaAd = byUtm({ ...a, ...a.viaMeta, inf: undefined, term: undefined, viaMeta: undefined }, campaigns, tags);
      if (viaAd.group === "meta") return { ...viaAd, viaDiscount: true };
    }
    return { group: "influencer", detail: influencerName(a.inf, a.term) ?? fallback };
  };
  if (a.inf) return discount(`할인 링크 ${a.inf}`);
  // 메타 광고 URL 매개변수에 실제로 있는 태그면 유료 광고 클릭 — utm_medium=inf 인 파트너십 광고도 메타 (2026-11-02 사장님 결정)
  const byId = campaigns.find((c) => c.id === camp);
  if (byId) return { group: "meta", detail: byId.name, campaignId: byId.id };
  const byTag = camp ? byAdTag(camp, a.cont || "", campaigns, tags) : undefined;
  if (byTag) return { group: "meta", detail: byTag.name, campaignId: byTag.id };
  // 할인 코드 없이 링크 UTM 만 남은 할인 링크 결제(토큰 유실 등). 8월 초기 링크는 utm_medium=influencer
  if (med === "inf" || med === "influencer") return discount(camp || "인플루언서");
  if (med === "social" || med === "profile" || a.cont === "link_in_bio") {
    return { group: "owned", detail: OWNED_SOURCE[src] || src || "자사 SNS" };
  }
  for (const [re, keyword] of MANUAL_TAG_KEYWORD) {
    if (re.test(camp)) {
      const hit = campaigns.find((c) => c.name.includes(keyword));
      return hit ? { group: "meta", detail: hit.name, campaignId: hit.id } : { group: "meta", detail: keyword };
    }
  }
  if (SEARCH_AD_MEDIUMS.has(med) && !META_SOURCES.has(src)) {
    const name = SEARCH_AD_NAME[src] || src || "검색광고";
    return { group: "search_ad", detail: camp ? `${name} · ${camp}` : name };
  }
  if (/^\d{12,}$/.test(camp) || med === "paid" || med === "display" || META_SOURCES.has(src)) {
    return { group: "meta", detail: "캠페인 불명" };
  }
  return { group: "referral", detail: src || camp || "기타 UTM" };
}

function byReferrer(ref: string): ChannelResult {
  if (ref.includes("search.naver")) return { group: "search", detail: "네이버 검색" };
  if (ref.includes("google.")) return { group: "search", detail: "구글 검색" };
  if (ref.includes("search.daum") || ref.includes("bing.")) return { group: "search", detail: "기타 검색" };
  if (ref.includes("blog.naver")) return { group: "referral", detail: "네이버 블로그" };
  if (ref.includes("instagram")) return { group: "unattributed", detail: "인스타 유입(광고/오가닉 불명)" };
  return { group: "referral", detail: ref };
}

export function classifyChannel(a: PurchaseAttribution | undefined, campaigns: CampaignRef[], tags: AdTagRef[] = []): ChannelResult {
  if (!a) return { group: "unattributed", detail: "Mixpanel 기록 없음" };
  if (a.src || a.camp || a.inf || a.med) return byUtm(a, campaigns, tags);
  if (a.fbclid) return { group: "meta", detail: "캠페인 불명" };
  if (a.ref && !REDIRECT_REF.test(a.ref)) return byReferrer(a.ref);
  if (a.app === "NAVER") return { group: "search", detail: "네이버 앱" };
  if (a.app === "IG" || a.app === "FB") return { group: "unattributed", detail: "인스타 인앱(광고/오가닉 불명)" };
  if (a.app === "KAKAO") return { group: "unattributed", detail: "카카오톡 인앱" };
  return { group: "unattributed", detail: "흔적 없음" };
}
