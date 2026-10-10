/**
 * 채널 분류 검증 (테스트 러너 없음 — node:assert 단일 파일).
 *
 * 실행:
 *   npx tsc lib/channel.test.ts --outDir .test-out --module commonjs --target es2020 --esModuleInterop --skipLibCheck --moduleResolution node && node .test-out/channel.test.js
 *
 * 케이스는 2026-10-07~09 실제 결제 이벤트에 나온 UTM 조합에서 뽑았다.
 */
import assert from "node:assert/strict";
import { classifyChannel, type CampaignRef, type PurchaseAttribution } from "./channel";
import { buildChannelPeriod } from "./channel-revenue";
import { onePerTx } from "./mixpanel";
import { daysBetween, isFinal, planFetch, splitByDay, type DayRecord } from "./mixpanel-store";

const CAMPAIGNS: CampaignRef[] = [
  { id: "120252368489210722", name: "26_3Q_sales_rebranding_판매_성공운" },
  { id: "120253569843420722", name: "26_3Q_sales_rebranding_판매_리무진테스트_260814" },
  { id: "120253113163140722", name: "26_3Q_sales_rebranding_판매_취업운_7.27" },
  { id: "120253113163290722", name: "26_3Q_sales_rebranding_판매_연애운" },
  { id: "120253498816350722", name: "26_3Q_sales_rebranding_판매_수능운" },
];

const base: PurchaseAttribution = { tx: "t", user: "u", ts: 0, isNew: true, how: "utm" };
const c = (p: Partial<PurchaseAttribution>) => classifyChannel({ ...base, ...p }, CAMPAIGNS);

// 메타: 캠페인 ID 동적 태그 (게재 위치 ig/fb/th 무관)
assert.deepEqual(c({ src: "ig", med: "paid", camp: "120252368489210722", cont: "120253001576160722" }),
  { group: "meta", detail: CAMPAIGNS[0].name, campaignId: CAMPAIGNS[0].id });
assert.equal(c({ src: "fb", med: "paid", camp: "120253569843420722" }).campaignId, CAMPAIGNS[1].id);
assert.equal(c({ src: "th", med: "paid", camp: "120252368489210722" }).group, "meta");

// 메타: 수동 태그 → 캠페인 이름 키워드
assert.equal(c({ src: "meta", med: "display", camp: "pu_3Q_sun_new_mg_vid_bnr_260821" }).campaignId, CAMPAIGNS[2].id);
assert.equal(c({ src: "meta", med: "display", camp: "pu_3Q_job_new_h2_recruit_bnr_260821" }).campaignId, CAMPAIGNS[2].id);
assert.equal(c({ src: "ig", med: "display", camp: "pu_3Q_lo_rl_vid_bnr_290920" }).campaignId, CAMPAIGNS[3].id);
assert.equal(c({ src: "meta", med: "display", camp: "pu_4Q_sun_new_sur_in_carousel_260929" }).campaignId, CAMPAIGNS[4].id);
// 키워드 캠페인이 목록에 없으면 키워드 이름으로 메타에 남김
assert.deepEqual(classifyChannel({ ...base, src: "ig", camp: "pu_3Q_lo_x" }, []), { group: "meta", detail: "연애운" });
// 목록에 없는 캠페인 ID → 메타(캠페인 불명)
assert.deepEqual(c({ src: "ig", med: "paid", camp: "120299999999999999" }), { group: "meta", detail: "캠페인 불명" });

// 자사 SNS (오가닉 프로필 링크)
assert.deepEqual(c({ src: "ig", med: "social", cont: "link_in_bio" }), { group: "owned", detail: "인스타 프로필" });
assert.deepEqual(c({ src: "kakao", med: "profile", camp: "br_bio__text_261005", cont: "home" }), { group: "owned", detail: "카카오 채널" });
assert.deepEqual(c({ src: "meta", med: "profile", camp: "br_bio_fb_text_260827", cont: "home" }), { group: "owned", detail: "페이스북 프로필" });

// 인플루언서 할인 링크 (utm_source=fbig 이어도 메타가 아님)
assert.deepEqual(c({ src: "fbig", med: "inf", camp: "pu", cont: "discount_percent", inf: "263Q_SS2" }),
  { group: "influencer", detail: "할인 링크 263Q_SS2" });

// 내부 테스트
assert.equal(c({ src: "claudetest", med: "paid", camp: "utm_probe" }).group, "unattributed");

// 복원(방문기록): fbclid만 / referrer / 인앱
assert.deepEqual(c({ how: "touch", fbclid: true }), { group: "meta", detail: "캠페인 불명" });
assert.deepEqual(c({ how: "touch", ref: "m.search.naver.com" }), { group: "search", detail: "네이버 검색" });
assert.deepEqual(c({ how: "touch", ref: "www.google.com" }), { group: "search", detail: "구글 검색" });
assert.deepEqual(c({ how: "touch", ref: "m.blog.naver.com" }), { group: "referral", detail: "네이버 블로그" });
assert.equal(c({ how: "touch", ref: "instagram.com" }).group, "unattributed");
assert.deepEqual(c({ how: "none", app: "NAVER" }), { group: "search", detail: "네이버 앱" });
assert.equal(c({ how: "none", app: "KAKAO" }).group, "unattributed");
assert.deepEqual(c({ how: "none" }), { group: "unattributed", detail: "흔적 없음" });

// Mixpanel 에 결제 기록이 없는 토스 결제
assert.deepEqual(classifyChannel(undefined, CAMPAIGNS), { group: "unattributed", detail: "Mixpanel 기록 없음" });

// ── 기간 집계: 금액·광고비 보존과 지표 정의 ──────────────────────────────
const range = { from: "2026-10-07", until: "2026-10-07" };
const pay = (orderId: string, total: number) =>
  ({ id: orderId, orderId, status: "PAID", paidAt: "2026-10-07T12:00:00+09:00", amount: { total }, method: { type: "CARD" } }) as any;
const attr = (tx: string, p: Partial<PurchaseAttribution>): [string, PurchaseAttribution] => [tx, { ...base, tx, ...p }];
const metaRow = (campaignId: string, spend: number, purchaseValue: number) =>
  ({ date: "2026-10-07", campaignId, campaignName: CAMPAIGNS.find((x) => x.id === campaignId)!.name, spend, purchaseValue,
    impressions: 0, clicks: 0, ctr: null, cpc: null, cpm: null, purchases: 0, reach: 0, frequency: null }) as any;

const period = buildChannelPeriod({
  payments: [pay("a", 29_900), pay("b", 29_900), pay("c", 19_900), pay("d", 9_900)],
  metaRows: [metaRow(CAMPAIGNS[0].id, 40_000, 70_000), metaRow(CAMPAIGNS[2].id, 10_000, 0)],
  attributions: new Map([
    attr("a", { src: "ig", med: "paid", camp: CAMPAIGNS[0].id, isNew: true }),
    attr("b", { src: "ig", med: "paid", camp: CAMPAIGNS[0].id, isNew: false }),
    attr("c", { how: "touch", ref: "m.search.naver.com" }),
    // d 는 Mixpanel 기록 없음 → 미귀속
  ]),
  campaigns: CAMPAIGNS,
  range,
});
const g = (k: string) => period.groups.find((x) => x.group === k)!;
assert.equal(period.revenue, 89_600);
assert.equal(period.groups.reduce((s, x) => s + x.rev, 0), period.revenue, "채널 합계 = 전체 매출");
assert.equal(g("meta").spend, 50_000, "메타 광고비 = 계정 전체");
assert.equal(g("meta").children.reduce((s, x) => s + x.spend, 0), 50_000, "캠페인 광고비 합 = 메타 광고비");
assert.equal(g("meta").rev, 59_800);
assert.equal(Math.round(period.metaRoas!), Math.round(59_800 / 50_000 * 100));
assert.equal(Math.round(period.mer!), Math.round(89_600 / 50_000 * 100));
assert.equal(Math.round(period.newCustomerRoas!), Math.round(29_900 / 50_000 * 100));
assert.equal(period.newCustomerCac, 50_000);
assert.equal(Math.round(period.pixelRoas!), 140);
assert.equal(g("search").rev, 19_900);
assert.equal(period.restoredCount, 1);
assert.equal(period.unattributedCount, 1);
assert.equal(Math.round(period.coverage! * 10), Math.round((89_600 - 9_900) / 89_600 * 1000));
// 결제 0건인 캠페인도 광고비와 함께 남는다
const job = g("meta").children.find((x) => x.campaignId === CAMPAIGNS[2].id)!;
assert.equal(job.rev, 0);
assert.equal(job.spend, 10_000);
assert.equal(period.daily.length, 1);
assert.equal(period.daily[0].rev.meta, 59_800);

// 같은 결제 이벤트 재전송: UTM 있는 것 → 가장 이른 것, 응답 순서와 무관
const dup = [
  { t: 300, d: "u1", tx: "x" },
  { t: 200, d: "u1", tx: "x", src: "ig", camp: CAMPAIGNS[0].id },
  { t: 250, d: "u1", tx: "x", src: "fb", camp: CAMPAIGNS[1].id },
  { t: 100, d: "u2", tx: "y" },
  { t: 50, d: "u2", tx: "y" },
  { t: 10, d: "u3" },
];
for (const rows of [dup, [...dup].reverse()]) {
  const picked = onePerTx(rows);
  assert.equal(picked.length, 2, "tx 당 1건, tx 없는 이벤트는 버림");
  assert.equal(picked.find((r) => r.tx === "x")!.t, 200);
  assert.equal(picked.find((r) => r.tx === "y")!.t, 50);
}

// ── 귀속 저장 규칙: 확정된 날은 다시 조회하지 않고, 확정 전 날은 15분마다만 ─────────
const at = (iso: string) => Date.parse(iso);
assert.deepEqual(daysBetween("2026-09-30", "2026-10-02"), ["2026-09-30", "2026-10-01", "2026-10-02"]);
assert.equal(isFinal("2026-10-08", at("2026-10-09T02:00:00+09:00")), true, "다음날 02시 이후 조회 = 확정");
assert.equal(isFinal("2026-10-08", at("2026-10-09T01:59:00+09:00")), false);
const now = at("2026-10-10T17:30:00+09:00");
const rec = (iso: string): DayRecord => ({ fetchedAt: at(iso), rows: [] });
const storedDays = new Map<string, DayRecord>([
  ["2026-10-07", rec("2026-10-08T03:00:00+09:00")], // 확정 → 재조회 없음
  ["2026-10-08", rec("2026-10-08T22:00:00+09:00")], // 그날 밤 조회 → 미확정, 15분 지남 → 재조회
  ["2026-10-10", rec("2026-10-10T17:20:00+09:00")], // 10분 전 조회 → 새로고침해도 재조회 안 함
]);
assert.deepEqual(
  planFetch(["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"], storedDays, now),
  ["2026-10-08", "2026-10-09"],
  "확정·15분 이내는 건너뛰고, 미확정·누락만 조회",
);
const split = splitByDay(
  [{ ...base, tx: "p", ts: at("2026-10-08T23:59:00+09:00") }, { ...base, tx: "q", ts: at("2026-10-09T00:01:00+09:00") }],
  ["2026-10-08", "2026-10-09", "2026-10-10"],
);
assert.deepEqual(split.get("2026-10-08")!.map((r) => r.tx), ["p"], "KST 자정 기준으로 나눔");
assert.deepEqual(split.get("2026-10-09")!.map((r) => r.tx), ["q"]);
assert.deepEqual(split.get("2026-10-10"), [], "결제가 없는 날도 빈 기록으로 저장");

console.log("channel.test OK");
