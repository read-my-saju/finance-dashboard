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
import { buildChannelPeriod, campaignRefs, metaRoasRange } from "./channel-revenue";
import { lastTouch, onePerTx, type Touch } from "./mixpanel";
import { commonCampaignWords, shortCampaignName } from "./campaign-name";
import { buildRecords, daysBetween, isFinal, planFetch, splitByDay, type DayRecord } from "./mixpanel-store";

const CAMPAIGNS: CampaignRef[] = [
  { id: "120252368489210722", name: "26_3Q_sales_rebranding_판매_성공운" },
  { id: "120253569843420722", name: "26_3Q_sales_rebranding_판매_리무진테스트_260814" },
  { id: "120253113163140722", name: "26_3Q_sales_rebranding_판매_취업운_7.27" },
  { id: "120253113163290722", name: "26_3Q_sales_rebranding_판매_연애운" },
  { id: "120253498816350722", name: "26_3Q_sales_rebranding_판매_수능운" },
  { id: "120254000000000722", name: "26_4Q_sales_rebranding판매_신년운" },
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
// 4분기 새 소재 태그 (2026-10-19 Mixpanel 실측: 연애 pu_4Q_lo_*, 신년 pu_4Q_ny_*)
assert.equal(c({ src: "ig", med: "display", camp: "pu_4Q_lo_pf_aut_vid_261012" }).campaignId, CAMPAIGNS[3].id);
assert.equal(c({ src: "ig", med: "display", camp: "pu_4Q_ny_la_lei_vid_261016" }).campaignId, CAMPAIGNS[5].id);
// 키워드 캠페인이 목록에 없으면 키워드 이름으로 메타에 남김
assert.deepEqual(classifyChannel({ ...base, src: "ig", camp: "pu_3Q_lo_x" }, []), { group: "meta", detail: "연애운" });
// 키워드 매칭은 최근 집행 캠페인으로 — 전체 기간이면 4월 옛 연애운 캠페인이 같이 들어옴 (2026-10-19 운영 화면)
const refs = campaignRefs([
  { date: "2026-04-24", campaignId: "100", campaignName: "260424 연애운 랜딩페이지 수정", spend: 5000 },
  { date: "2026-10-18", campaignId: CAMPAIGNS[3].id, campaignName: CAMPAIGNS[3].name, spend: 90000 },
  { date: "2026-04-30", campaignId: "100", campaignName: "260424 연애운 랜딩페이지 수정", spend: 3000 },
  { date: "2026-10-19", campaignId: "100", campaignName: "260424 연애운 랜딩페이지 수정", spend: 0 },
] as any);
assert.deepEqual(refs.map((r) => r.id), [CAMPAIGNS[3].id, "100"], "광고비 쓴 마지막 날 순, 0원 행은 무시, 캠페인당 1개");
assert.deepEqual(campaignRefs([
  { date: "2026-10-18", campaignId: "120200000000000001", campaignName: "a", spend: 1 },
  { date: "2026-10-18", campaignId: "120300000000000001", campaignName: "b", spend: 1 },
  { date: "2026-10-01", campaignId: "120400000000000001", campaignName: "c", spend: 0 },
] as any).map((r) => r.name), ["b", "a", "c"], "같은 날이면 ID 큰 캠페인 먼저, 0원만 있으면 맨 뒤");
assert.equal(classifyChannel({ ...base, src: "ig", camp: "pu_3Q_lo_rl_vid_bnr_290920" }, refs).campaignId, CAMPAIGNS[3].id);
assert.equal(classifyChannel({ ...base, src: "ig", camp: "pu_4Q_lo_pf_aut_vid_261012" }, refs).campaignId, CAMPAIGNS[3].id);
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

// ── 네이버: 파워링크는 검색광고, 로그인·결제 리다이렉트는 유입 경로가 아님 ─────────────
assert.deepEqual(c({ src: "naver", med: "cpc", camp: "pu_powerlink_brand__text_260827" }),
  { group: "search_ad", detail: "네이버 파워링크 · pu_powerlink_brand__text_260827" });
assert.equal(c({ src: "ig", med: "cpc", camp: "x" }).group, "meta", "메타 게재 위치 source 면 cpc 여도 메타");
assert.deepEqual(c({ how: "touch", ref: "nid.naver.com" }), { group: "unattributed", detail: "흔적 없음" });
assert.deepEqual(c({ how: "touch", ref: "orders.pay.naver.com", app: "NAVER" }), { group: "search", detail: "네이버 앱" });
assert.deepEqual(c({ how: "touch", ref: "m.naver.com" }), { group: "referral", detail: "m.naver.com" }, "m.naver.com 은 그대로 (검색 여부 판단 불가)");
assert.deepEqual(c({ how: "touch", ref: "m.search.naver.com" }), { group: "search", detail: "네이버 검색" });
// 검색광고 결제도 채널 합계에 들어간다 (그룹 누락 = 합계 불일치)
const withAd = buildChannelPeriod({
  payments: [pay("a", 29_900), pay("s", 19_900)],
  metaRows: [metaRow(CAMPAIGNS[0].id, 40_000, 0)],
  attributions: new Map([attr("a", { src: "ig", med: "paid", camp: CAMPAIGNS[0].id }), attr("s", { src: "naver", med: "cpc", camp: "pu_powerlink" })]),
  campaigns: CAMPAIGNS,
  range,
});
assert.equal(withAd.groups[0].group, "meta", "groups[0] 은 메타");
assert.equal(withAd.groups.reduce((s, x) => s + x.rev, 0), withAd.revenue);
assert.equal(withAd.groups.find((x) => x.group === "search_ad")!.rev, 19_900);
assert.equal(withAd.daily[0].rev.search_ad, 19_900);

// ── 귀속 저장 규칙 ─────────────────────────────────────────────────────────
const at = (iso: string) => Date.parse(iso);
assert.deepEqual(daysBetween("2026-09-30", "2026-10-02"), ["2026-09-30", "2026-10-01", "2026-10-02"]);
const rec = (iso: string, complete = true): DayRecord => ({ fetchedAt: at(iso), rows: [], complete });
assert.equal(isFinal("2026-10-08", rec("2026-10-11T00:00:00+09:00")), true, "그날 끝 +48시간 이후 완전한 기록 = 확정");
assert.equal(isFinal("2026-10-08", rec("2026-10-10T23:59:00+09:00")), false, "48시간 전에는 늦은 이벤트를 기다림");
assert.equal(isFinal("2026-10-08", rec("2026-10-12T00:00:00+09:00", false)), false, "불완전한 기록은 확정 안 함");
assert.equal(isFinal("2026-10-08", rec("2026-10-16T00:00:00+09:00", false)), true, "불완전해도 7일 지나면 확정");

const now = at("2026-10-10T17:30:00+09:00");
const storedDays = new Map<string, DayRecord>([
  ["2026-10-06", rec("2026-10-09T01:00:00+09:00")], // 확정 → 재조회 없음
  ["2026-10-07", rec("2026-10-08T03:00:00+09:00")], // 48시간 전 조회 → 미확정, 15분 지남 → 재조회
  ["2026-10-10", rec("2026-10-10T17:20:00+09:00")], // 10분 전 조회 → 새로고침해도 재조회 안 함
]);
assert.deepEqual(
  planFetch(["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-10"], storedDays, now),
  ["2026-10-07", "2026-10-08"],
  "확정·15분 이내는 건너뛰고, 미확정·누락만 조회",
);

const split = splitByDay(
  [{ ...base, tx: "p", ts: at("2026-10-08T23:59:00+09:00") }, { ...base, tx: "q", ts: at("2026-10-09T00:01:00+09:00") }],
  ["2026-10-08", "2026-10-09", "2026-10-10"],
);
assert.deepEqual(split.get("2026-10-08")!.map((r) => r.tx), ["p"], "KST 자정 기준으로 나눔");
assert.deepEqual(split.get("2026-10-09")!.map((r) => r.tx), ["q"]);
assert.deepEqual(split.get("2026-10-10"), [], "결제가 없는 날도 빈 기록으로 저장");

// 띄엄띄엄 필요한 날짜: 한 범위로 받아도 저장은 필요한 날짜만 (확정된 중간 날짜를 덮어쓰지 않음)
const fetchedRows = [
  { ...base, tx: "d1", ts: at("2026-10-01T12:00:00+09:00") },
  { ...base, tx: "d5", ts: at("2026-10-05T12:00:00+09:00") },
  { ...base, tx: "d9", ts: at("2026-10-09T12:00:00+09:00") },
];
const built = buildRecords(fetchedRows, ["2026-10-01", "2026-10-09"], new Map([["2026-10-01", 1], ["2026-10-09", 4]]), now);
assert.deepEqual([...built.keys()], ["2026-10-01", "2026-10-09"], "중간 날짜(10/5)는 기록하지 않음");
assert.equal(built.get("2026-10-01")!.complete, true);
assert.equal(built.get("2026-10-09")!.complete, false, "토스 4건 중 1건만 찾음 → 불완전");

// 메타 ROAS 범위: 하한 귀속 ~ 상한 max(귀속, 픽셀), 상한은 MER 을 넘지 않음
assert.deepEqual(metaRoasRange(140, 152.3, 162.5), { low: 140, high: 152.3 });
assert.deepEqual(metaRoasRange(150, 90, 180), { low: 150, high: 150 });           // 최근 며칠 픽셀 집계 지연 — 하한을 끌어내리지 않음
assert.deepEqual(metaRoasRange(150, 190, 170), { low: 150, high: 170 });           // 메타 주장이 회사 전체 매출 초과
assert.deepEqual(metaRoasRange(140, null, 160), { low: 140, high: 140 });
assert.deepEqual(metaRoasRange(null, 150, null), { low: null, high: null });        // 광고비 0

// 접점 복원: 랜딩(utm) 뒤 앱 화면의 fbclid 만 남은 방문이 캠페인을 덮어쓰지 않음
const tUtm: Touch = [1, "ig", "paid", CAMPAIGNS[0].id, null, 1, null];
const tFb: Touch = [3, null, null, null, null, 1, null];
const tRef: Touch = [2, null, null, null, null, 0, "m.blog.naver.com"];
assert.equal(lastTouch([tUtm, tFb]), tUtm, "fbclid 만 남은 마지막 방문 → 앞의 utm 방문");
assert.equal(lastTouch([tUtm, tRef, tFb]), tUtm, "fbclid 방문은 메타 클릭 → 사이의 referrer 보다 utm 방문");
assert.equal(lastTouch([tUtm, tRef]), tRef, "referrer 방문은 그대로 마지막 유입");
assert.equal(lastTouch([tFb]), tFb, "utm 방문이 없으면 fbclid 방문 그대로 (캠페인 불명)");
const tPowerlink: Touch = [1, "naver", "cpc", "pu_powerlink_brand__text_260827", null, 0, null];
const tProfile: Touch = [1, "ig", "social", null, "link_in_bio", 0, null];
const tManual: Touch = [0, "ig", "display", "pu_4Q_lo_pf_aut_vid_261012", null, 0, null];
assert.equal(lastTouch([tPowerlink, tFb]), tFb, "fbclid 방문을 검색광고 utm 으로 넘기지 않음");
assert.equal(lastTouch([tProfile, tFb]), tFb, "fbclid 방문을 프로필 링크 utm 으로 넘기지 않음");
assert.equal(lastTouch([tManual, tPowerlink, tFb]), tManual, "수동 태그 메타 방문은 대상");
const tFbSocial: Touch = [3, null, "social", null, null, 1, null];
assert.equal(lastTouch([tUtm, tFbSocial]), tFbSocial, "fbclid 에 utm_medium 이 같이 있으면 fbclid 만 남은 방문이 아님");
assert.equal(lastTouch([]), undefined);

// 캠페인 이름 축약: 3Q·4Q 가 섞이고 _ 를 빠뜨린 이름이 있어도 공통 단어만 뺌
const names = [CAMPAIGNS[0].name, CAMPAIGNS[1].name, CAMPAIGNS[2].name, CAMPAIGNS[3].name, CAMPAIGNS[5].name];
const common = commonCampaignWords(names);
assert.deepEqual(names.map((n) => shortCampaignName(n, common)),
  ["3Q_성공운", "3Q_리무진테스트_260814", "3Q_취업운_7.27", "3Q_연애운", "4Q_신년운"]);
assert.equal(commonCampaignWords([CAMPAIGNS[0].name]).size, 0, "캠페인 1개면 축약 안 함");
assert.equal(shortCampaignName("26_4Q-sales rebranding판매", new Set()), "26_4Q-sales rebranding판매", "공통 단어 없으면 원래 이름 그대로");
assert.equal(shortCampaignName("a_b", new Set(["a", "b"])), "a_b", "남는 단어가 없으면 원래 이름");

console.log("channel.test OK");
