/**
 * 대시보드 화면 가공 함수 검증 (node:assert 단일 파일).
 *
 * 실행:
 *   npx tsc lib/dashboard-view.test.ts --outDir .test-out --module commonjs --target es2020 --esModuleInterop --skipLibCheck --moduleResolution node && node .test-out/dashboard-view.test.js
 */
import assert from "node:assert/strict";
import { contributionProfitAtRoas } from "./calc";
import { channelMix, fmtMan, mergeCampaignOps, presetOf, presetRange, profitBreakdown, profitHeadline, sameTimeRevenue, verdictOf } from "./dashboard-view";

assert.deepEqual(presetRange("week", "2026-11-14"), { from: "2026-11-07", until: "2026-11-13" });
assert.deepEqual(presetRange("month30", "2026-11-14"), { from: "2026-10-15", until: "2026-11-13" });
assert.deepEqual(presetRange("thisMonth", "2026-11-14"), { from: "2026-11-01", until: "2026-11-14" });
assert.deepEqual(presetRange("lastMonth", "2026-11-14"), { from: "2026-10-01", until: "2026-10-31" });
assert.deepEqual(presetRange("lastMonth", "2026-01-05"), { from: "2025-12-01", until: "2025-12-31" });
assert.deepEqual(presetRange("yesterday", "2026-11-14"), { from: "2026-11-13", until: "2026-11-13" });
assert.deepEqual(presetRange("all", "2026-11-14"), { from: "2026-01-01", until: "2026-11-14" });
assert.equal(presetOf("2026-11-07", "2026-11-13", "2026-11-14"), "week");
assert.equal(presetOf("2026-11-03", "2026-11-09", "2026-11-14"), null);
// 11/13 시간대별: 0시 247,400, 1시 139,600 → 01:33까지 = 247,400 + 139,600 × 33/60
assert.equal(Math.round(sameTimeRevenue([{ hour: 0, amount: 247400 }, { hour: 1, amount: 139600 }, { hour: 2, amount: 89800 }], 1, 33)), 324180);
assert.equal(sameTimeRevenue([], 1, 33), 0);
assert.equal(fmtMan(39455700), "3,946만");
assert.equal(fmtMan(93845), "9.4만");
assert.equal(fmtMan(-280000), "−28만");
assert.equal(fmtMan(0), "0원");
assert.equal(fmtMan(250), "250원");
assert.equal(fmtMan(-300), "−300원");
const wk = { netRevenue: 39455700, vat: 3586882, revenueExVat: 35868818, pgFee: 1360206, reportCost: 550500, adSpend: 26661153, contributionProfit: 7296960 };
const b = profitBreakdown(wk);
assert.deepEqual(b.rows.map((r) => r.sign + r.label), ["결제매출", "−부가세", "=부가세 제외 매출", "−결제수수료", "−리포트 원가", "−광고비", "=공헌이익 (남는 돈)"]);
assert.equal(b.profitPer100.toFixed(1), "18.5");
assert.deepEqual(b.segs.map((s) => s.per100.toFixed(1)), ["13.9", "67.6", "18.5"]);
assert.equal(profitHeadline(b.profitPer100, false), "결제 100원 중 18.5원이 남습니다");
assert.equal(profitHeadline(46.3, true), "결제 100원 중 46.3원이 남습니다 (진행 중)");
const loss = profitBreakdown({ netRevenue: 1000000, vat: 90909, revenueExVat: 909091, pgFee: 32000, reportCost: 5000, adSpend: 1200000, contributionProfit: -327909 });
assert.equal(loss.segs[2].amount, 0);
assert.equal(profitHeadline(loss.profitPer100, false), "결제 100원당 32.8원 손실입니다");
assert.equal(profitHeadline(-32.8, true), "결제 100원당 32.8원 손실입니다 (진행 중)");
assert.ok(profitBreakdown({ ...wk, netRevenue: 0 }).rows.every((r) => Number.isFinite(r.per100)));
assert.equal(verdictOf(138.6, 116.2), "good");
assert.equal(verdictOf(120, 116.2), "warn");
assert.equal(verdictOf(110, 116.2), "bad");
assert.equal(verdictOf(null, 116.2), null);
assert.equal(verdictOf(121.2, 116.2), "good");
assert.equal(verdictOf(121.1, 116.2), "warn");
assert.equal(verdictOf(116.2, 116.2), "warn");
assert.equal(verdictOf(116.1, 116.2), "bad");
assert.deepEqual(b.segs.map((s) => s.label), ["세금과 비용", "광고비", "남는 돈"]);

const kids = [
  { key: "a", name: "26_3Q_성공운_sales_rebranding_판매", campaignId: "a", rev: 300, n: 3, newRev: 0, newN: 0, spend: 100, roas: 300, pixelRoas: 150, breakEvenRoas: 116, contributionProfit: 0 },
  { key: "x", name: "캠페인 불명", rev: 50, n: 1, newRev: 0, newN: 0, spend: 0, roas: null, pixelRoas: null, breakEvenRoas: 116, contributionProfit: 10 },
  { key: "b", name: "26_3Q_취업운_sales_rebranding_판매", campaignId: "b", rev: 0, n: 0, newRev: 0, newN: 0, spend: 300, roas: 0, pixelRoas: null, breakEvenRoas: 116, contributionProfit: -300 },
];
const v = mergeCampaignOps(kids as any, [{ campaignId: "a", ctr: 2.42, cpm: 34257, dailyBudget: 1831868 }], 116);
assert.deepEqual(v.map((c) => c.campaignId), ["b", "a"]);
assert.equal(v[0].ctr, null);
assert.equal(v[0].verdict, null);
assert.equal(v[1].profit, contributionProfitAtRoas(100, 150, 116));
assert.equal(v[1].verdict, "good");
const mix = channelMix([
  { group: "meta", rev: 33660600, n: 928 }, { group: "search", rev: 1693300, n: 51 }, { group: "owned", rev: 2155200, n: 62 },
  { group: "referral", rev: 568400, n: 16 }, { group: "unattributed", rev: 1378200, n: 44 }, { group: "influencer", rev: 0, n: 0 }, { group: "search_ad", rev: 0, n: 0 },
] as any);
assert.deepEqual(mix.rows.map((r) => r.key), ["meta", "search", "unattributed", "owned", "referral", "influencer", "search_ad"]);
assert.equal(mix.influence.share.toFixed(1), "93.1");
assert.equal(channelMix([]).influence.share, 0);

console.log("dashboard-view.test OK");
