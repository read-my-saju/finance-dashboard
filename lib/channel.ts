/**
 * 결제 1건의 유입 채널 분류 (순수 함수 — 네트워크·KV 없음).
 *
 * 판정 순서 (2026-10-10 사장님 확정, 마지막 유입 기준):
 *   1. 결제 이벤트(s2s_purchase_verified)의 utm_* / influencer_code
 *   2. 없으면 결제 전 7일 안 마지막 방문의 utm·fbclid·referrer (lib/mixpanel.ts 가 채움)
 *   3. 인앱 브라우저 흔적
 *   4. 미귀속
 *
 * 메타 캠페인은 utm_campaign 의 캠페인 ID 로 잇고, 수동 태그(pu_3Q_*)는 캠페인 이름의 키워드로 찾는다.
 * 캠페인 이름·ID 를 하드코딩하지 않는다 — Meta insights 에서 받은 목록을 넘겨받음.
 */

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
  fbclid?: boolean;
  ref?: string;            // 외부 referring domain
  app?: "IG" | "FB" | "KAKAO" | "NAVER";
};

export type CampaignRef = { id: string; name: string };

export type ChannelResult = {
  group: ChannelGroup;
  detail: string;          // 표의 세부 행 이름
  campaignId?: string;     // 메타 캠페인으로 확정된 경우
};

// 수동 UTM 태그 → 캠페인 이름 키워드. 메타 광고 URL 을 {{campaign.id}} 로 통일하면 필요 없어짐.
const MANUAL_TAG_KEYWORD: Array<[RegExp, string]> = [
  [/^pu_3Q_job|^pu_3Q_sun_new_mg/i, "취업운"],
  [/^pu_3Q_lo/i, "연애운"],
  [/^pu_[34]Q_sun/i, "수능운"],
];

const OWNED_SOURCE: Record<string, string> = { ig: "인스타 프로필", kakao: "카카오 채널", meta: "페이스북 프로필", fb: "페이스북 프로필" };
const META_SOURCES = new Set(["ig", "fb", "meta", "th", "fbig", "an", "msg"]);
// 유료 검색광고 매체값 (네이버 파워링크 = utm_source=naver&utm_medium=cpc). 메타 게재 위치 source 면 메타로 둔다.
const SEARCH_AD_MEDIUMS = new Set(["cpc", "ppc", "sa", "paid_search"]);
const SEARCH_AD_NAME: Record<string, string> = { naver: "네이버 파워링크", google: "구글 검색광고" };
// 로그인·결제 중간 페이지 — 유입 경로가 아니므로 referrer 로 쓰지 않는다.
const REDIRECT_REF = /(^|\.)nid\.naver\.com$|(^|\.)pay\.naver\.com$/;

function byUtm(a: PurchaseAttribution, campaigns: CampaignRef[]): ChannelResult {
  const src = (a.src || "").toLowerCase();
  const med = (a.med || "").toLowerCase();
  const camp = a.camp || "";
  if (src === "claudetest") return { group: "unattributed", detail: "내부 테스트" };
  if (a.inf || med === "inf") return { group: "influencer", detail: a.inf ? `할인 링크 ${a.inf}` : camp || "인플루언서" };
  if (med === "social" || med === "profile" || a.cont === "link_in_bio") {
    return { group: "owned", detail: OWNED_SOURCE[src] || src || "자사 SNS" };
  }
  const byId = campaigns.find((c) => c.id === camp);
  if (byId) return { group: "meta", detail: byId.name, campaignId: byId.id };
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

export function classifyChannel(a: PurchaseAttribution | undefined, campaigns: CampaignRef[]): ChannelResult {
  if (!a) return { group: "unattributed", detail: "Mixpanel 기록 없음" };
  if (a.src || a.camp || a.inf || a.med) return byUtm(a, campaigns);
  if (a.fbclid) return { group: "meta", detail: "캠페인 불명" };
  if (a.ref && !REDIRECT_REF.test(a.ref)) return byReferrer(a.ref);
  if (a.app === "NAVER") return { group: "search", detail: "네이버 앱" };
  if (a.app === "IG" || a.app === "FB") return { group: "unattributed", detail: "인스타 인앱(광고/오가닉 불명)" };
  if (a.app === "KAKAO") return { group: "unattributed", detail: "카카오톡 인앱" };
  return { group: "unattributed", detail: "흔적 없음" };
}
