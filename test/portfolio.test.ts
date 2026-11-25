// test/portfolio.test.ts
// 持仓总账纯计算模块（src/utils/portfolio.ts）契约测试
import assert from "node:assert";
import test from "node:test";
import fs from "node:fs";

import {
  FX_RATES_TO_CNY,
  toBaseCurrency,
  isFiatConvertibleCurrency,
  aggregateHoldingsByCurrency,
  computePortfolioSummary,
  setLiveFxRates,
  getEffectiveFxRates,
  resetLiveFxRatesForTest,
  formatFxSourceNote,
  formatFxDetailNote,
  formatPortfolioAmount,
  deriveTodayProfitRate,
  deriveTotalProfitRate,
  FX_LIVE_STALE_MS,
} from "../src/utils/portfolio.ts";
import { parseSinaFxResponse, resolveFxNetworkOptions } from "../src/services/fxRateService.ts";
import { extractHoldingQuotes } from "../src/utils/symbolHelper.ts";
import type { HoldingItemQuote } from "../src/utils/symbolHelper.ts";
import type { MarketItem, WatchlistConfig } from "../src/types/index.ts";

function makeHolding(
  overrides: Partial<HoldingItemQuote> & Pick<HoldingItemQuote, "currency" | "cost" | "shares" | "price">
): HoldingItemQuote {
  return {
    name: overrides.name ?? "测试标的",
    symbol: overrides.symbol ?? "sh600000",
    changePercent: overrides.changePercent ?? 0,
    ...overrides,
  };
}

void test("toBaseCurrency - CNY 恒等 / USD、HKD、USDT 折算 / CNY→USD 反算 / HKD→USD", () => {
  const fxUsd = FX_RATES_TO_CNY.USD;
  const fxHkd = FX_RATES_TO_CNY.HKD;
  assert.strictEqual(toBaseCurrency(100, "CNY", "CNY"), 100);
  assert.strictEqual(toBaseCurrency(100, "USD", "CNY"), 100 * fxUsd);
  assert.strictEqual(toBaseCurrency(100, "HKD", "CNY"), 100 * fxHkd);
  assert.strictEqual(toBaseCurrency(100, "USDT", "CNY"), 100 * FX_RATES_TO_CNY.USDT);
  assert.ok(Math.abs(toBaseCurrency(100 * fxUsd, "CNY", "USD") - 100) < 1e-9);
  // 100 HKD → 先折 CNY 再折 USD = 100 × HKD/CNY ÷ USD/CNY
  assert.ok(Math.abs(toBaseCurrency(100, "HKD", "USD") - (100 * fxHkd) / fxUsd) < 1e-9);
});

void test("computePortfolioSummary - 混合币种（A+港+美+加密）折算期望值", () => {
  const holdings: HoldingItemQuote[] = [
    // A股：现价 10，成本 9，100 股 → 市值 1000 / 成本 900 / 浮盈 100 / 今日 (10-9.8)*100=20
    makeHolding({ symbol: "sh600000", currency: "CNY", cost: 9, shares: 100, price: 10, change: 0.2, section: "aShare" }),
    // 港股：现价 100，成本 90，10 股 → 原生市值 1000 / 浮盈 100 / 今日 +100
    makeHolding({ symbol: "00700", currency: "HKD", cost: 90, shares: 10, price: 100, change: 10, section: "hkStock" }),
    // 美股：现价 200，成本 210，5 股 → 原生市值 1000 / 浮亏 -50 / 今日 -25
    makeHolding({ symbol: "AAPL", currency: "USD", cost: 210, shares: 5, price: 200, change: -5, section: "usStock" }),
    // 加密：现价 50000，成本 40000，0.1 BTC → 原生市值 5000 / 浮盈 1000 / 今日 +300
    makeHolding({ symbol: "BTCUSDT", currency: "USDT", cost: 40000, shares: 0.1, price: 50000, change: 3000, section: "binance" }),
  ];

  const summary = computePortfolioSummary(holdings, "CNY");

  // 手算（对 CNY 系数）：市值 1000×1 + 1000×HKD + 1000×USD + 5000×USDT。
  // 汇率一律取 FX_RATES_TO_CNY，禁止在断言里写死牌价——静态兜底校准时测试不应同步改数字。
  const fxUsd = FX_RATES_TO_CNY.USD;
  const fxHkd = FX_RATES_TO_CNY.HKD;
  const fxUsdt = FX_RATES_TO_CNY.USDT;
  const expectMarketVal = 1000 + 1000 * fxHkd + 1000 * fxUsd + 5000 * fxUsdt;
  const expectCostVal = 900 + 900 * fxHkd + 1050 * fxUsd + 4000 * fxUsdt;
  const expectTodayProfit = 20 + 100 * fxHkd + -25 * fxUsd + 300 * fxUsdt;

  assert.ok(Math.abs(summary.total.marketVal - expectMarketVal) < 1e-6, `marketVal: ${summary.total.marketVal}`);
  assert.ok(Math.abs(summary.total.costVal - expectCostVal) < 1e-6, `costVal: ${summary.total.costVal}`);
  // 逐标的折算再求和（等价性验证）
  const perItemTotalProfit = holdings.reduce(
    (acc, h) => acc + (isFiatConvertibleCurrency(h.currency) ? (h.price - h.cost) * h.shares * FX_RATES_TO_CNY[h.currency] : 0),
    0
  );
  assert.ok(Math.abs(summary.total.totalProfit - perItemTotalProfit) < 1e-6);
  assert.ok(Math.abs(summary.total.todayProfit - expectTodayProfit) < 1e-6, `todayProfit: ${summary.total.todayProfit}`);
  assert.strictEqual(summary.total.count, 4);
  assert.strictEqual(summary.holdingsCount, 4);
  assert.strictEqual(summary.base, "CNY");

  // 原生币种对账：四币种各一桶
  assert.deepStrictEqual(Object.keys(summary.byCurrency).sort(), ["CNY", "HKD", "USD", "USDT"]);
  assert.strictEqual(summary.byCurrency["HKD"]!.marketVal, 1000);

  // 板块分桶（基准货币）
  assert.ok(Math.abs(summary.bySection["hkStock"]!.marketVal - 1000 * fxHkd) < 1e-6);
  assert.ok(Math.abs(summary.bySection["usStock"]!.marketVal - 1000 * fxUsd) < 1e-6);
  assert.ok(Math.abs(summary.bySection["binance"]!.marketVal - 5000 * fxUsdt) < 1e-6);
});

void test("aggregateHoldingsByCurrency - 与旧状态栏内联累加逐桶等价", () => {
  const holdings: HoldingItemQuote[] = [
    makeHolding({ symbol: "sh600000", currency: "CNY", cost: 9, shares: 100, price: 10, change: 0.2 }),
    makeHolding({ symbol: "sh600519", currency: "CNY", cost: 1700, shares: 2, price: 1600, prevClose: 1650 }),
    makeHolding({ symbol: "AAPL", currency: "USD", cost: 210, shares: 5, price: 200, change: -5 }),
  ];

  const buckets = aggregateHoldingsByCurrency(holdings);

  // 旧逻辑等价复算（statusBar.aggregateHoldings 迁移前口径）
  const expected: Record<string, { todayProfit: number; totalProfit: number; count: number; marketVal: number; costVal: number }> = {};
  for (const h of holdings) {
    const cur = h.currency || "CNY";
    if (!expected[cur]) expected[cur] = { todayProfit: 0, totalProfit: 0, count: 0, marketVal: 0, costVal: 0 };
    const d = expected[cur];
    d.count++;
    d.costVal += h.cost * h.shares;
    d.marketVal += h.price * h.shares;
    d.totalProfit += (h.price - h.cost) * h.shares;
    d.todayProfit += (h.change !== undefined && Number.isFinite(h.change))
      ? h.change * h.shares
      : h.prevClose !== undefined && h.prevClose > 0
        ? (h.price - h.prevClose) * h.shares
        : 0;
  }

  for (const [cur, exp] of Object.entries(expected)) {
    const actual = buckets.get(cur);
    assert.ok(actual, `缺少币种桶 ${cur}`);
    assert.strictEqual(actual.count, exp.count);
    assert.strictEqual(actual.marketVal, exp.marketVal);
    assert.strictEqual(actual.costVal, exp.costVal);
    assert.strictEqual(actual.totalProfit, exp.totalProfit);
    assert.strictEqual(actual.todayProfit, exp.todayProfit);
  }
});

void test("computePortfolioSummary - bySection 基金与A股分开、section 缺失仅计入 total", () => {
  const holdings: HoldingItemQuote[] = [
    makeHolding({ symbol: "sh510300", currency: "CNY", cost: 4, shares: 1000, price: 4.5, change: 0.05, section: "fund" }),
    makeHolding({ symbol: "sh600000", currency: "CNY", cost: 9, shares: 100, price: 10, change: 0.2, section: "aShare" }),
    makeHolding({ symbol: "neutral", currency: "CNY", cost: 1, shares: 10, price: 2, change: 0.1 }),
  ];

  const summary = computePortfolioSummary(holdings, "CNY");

  assert.ok(summary.bySection["fund"], "fund 桶缺失");
  assert.ok(summary.bySection["aShare"], "aShare 桶缺失");
  assert.strictEqual(summary.bySection["fund"]!.count, 1);
  assert.strictEqual(summary.bySection["aShare"]!.count, 1);
  assert.strictEqual(summary.bySection["fund"]!.marketVal, 4500);
  assert.strictEqual(summary.bySection["aShare"]!.marketVal, 1000);
  // 中立分组标的仅计入 total：1000 + 4500 + 20
  assert.strictEqual(summary.total.marketVal, 5520);
  assert.strictEqual(summary.total.count, 3);
});

void test("computePortfolioSummary - 空输入不抛异常且全零", () => {
  const summary = computePortfolioSummary([], "CNY");
  assert.strictEqual(summary.holdingsCount, 0);
  assert.strictEqual(summary.total.marketVal, 0);
  assert.strictEqual(summary.total.costVal, 0);
  assert.strictEqual(summary.total.todayProfit, 0);
  assert.strictEqual(summary.total.totalProfit, 0);
  assert.strictEqual(summary.total.count, 0);
  assert.deepStrictEqual(summary.bySection, {});
  assert.deepStrictEqual(summary.byCurrency, {});
});

void test("computePortfolioSummary - base=USD 与 base=CNY 满足 ÷USD 汇率关系", () => {
  const holdings: HoldingItemQuote[] = [
    makeHolding({ symbol: "sh600000", currency: "CNY", cost: 9, shares: 100, price: 10, change: 0.2 }),
    makeHolding({ symbol: "AAPL", currency: "USD", cost: 210, shares: 5, price: 200, change: -5 }),
  ];

  const cny = computePortfolioSummary(holdings, "CNY");
  const usd = computePortfolioSummary(holdings, "USD");
  const fxUsd = FX_RATES_TO_CNY.USD;

  assert.ok(Math.abs(usd.total.marketVal - cny.total.marketVal / fxUsd) < 1e-9);
  assert.ok(Math.abs(usd.total.todayProfit - cny.total.todayProfit / fxUsd) < 1e-9);
  assert.ok(Math.abs(usd.total.totalProfit - cny.total.totalProfit / fxUsd) < 1e-9);
  // byCurrency 恒为原生币种，不随基准变化
  assert.deepStrictEqual(usd.byCurrency, cny.byCurrency);
});

void test("computePortfolioSummary - 今日盈亏走 deriveTodayProfit 降级链（change 缺失走 prevClose）", () => {
  const holdings: HoldingItemQuote[] = [
    makeHolding({ symbol: "sh600000", currency: "CNY", cost: 9, shares: 100, price: 10, prevClose: 9.5 }),
  ];

  const summary = computePortfolioSummary(holdings, "CNY");
  // (10 - 9.5) × 100 = 50
  assert.strictEqual(summary.total.todayProfit, 50);
});

void test("computePortfolioSummary - 除零守卫：costVal 为 0 时不产生 NaN", () => {
  // 零成本持仓（cost=0）为合法口径，本金为 0 时浮盈率回落 0，总账仍须自防 NaN
  const holdings = [
    makeHolding({ symbol: "sh600000", currency: "CNY", cost: 0, shares: 100, price: 10, change: 0.2 }),
  ];
  const summary = computePortfolioSummary(holdings, "CNY");
  assert.ok(Number.isFinite(summary.total.marketVal));
  assert.ok(Number.isFinite(summary.total.todayProfit));
  assert.ok(Number.isFinite(summary.total.totalProfit));
});

void test("extractHoldingQuotes - forPortfolio 口径：保留休市标的、忽略 statusBar 开关、enabled 仍过滤、默认行为不变", () => {
  const watchlist: WatchlistConfig = {
    "A股": [
      { symbol: "sh600000", type: "A_SHARE", cost: 9, shares: 100 },
      { symbol: "sh600519", type: "A_SHARE", cost: 1700, shares: 2 },
    ],
  };
  const quoteCache = new Map<string, MarketItem>();
  quoteCache.set("sh600000", {
    id: "sh600000", name: "浦发银行", symbol: "sh600000", type: "A_SHARE",
    price: 10, changePercent: 2.04, change: 0.2, prevClose: 9.8,
  });
  quoteCache.set("sh600519", {
    id: "sh600519", name: "贵州茅台", symbol: "sh600519", type: "A_SHARE",
    price: 1600, changePercent: -3.03, change: -50, prevClose: 1650,
  });

  // 周六（休市）+ 板块 statusBar 关闭 + 总控关闭
  const saturday = new Date("2026-11-14T12:00:00+08:00");
  const sectionOpts = {
    statusBarEnabled: false,
    autoCollapseClosedGroups: true,
    now: saturday,
    aShare: { enabled: true, statusBar: false },
  };

  // 默认口径：总控关闭 → 空
  assert.strictEqual(extractHoldingQuotes(watchlist, quoteCache, sectionOpts).length, 0);

  // forPortfolio：总控/statusBar/休市均忽略 → 两只全保留
  const portfolioQuotes = extractHoldingQuotes(watchlist, quoteCache, { ...sectionOpts, forPortfolio: true });
  assert.strictEqual(portfolioQuotes.length, 2);
  assert.ok(portfolioQuotes.every((q) => q.section === "aShare"), "section 字段应填充为 aShare");

  // forPortfolio 下 enabled=false 仍要过滤
  const disabledQuotes = extractHoldingQuotes(watchlist, quoteCache, {
    ...sectionOpts,
    forPortfolio: true,
    aShare: { enabled: false, statusBar: true },
  });
  assert.strictEqual(disabledQuotes.length, 0);

  // 默认口径回归：不传 forPortfolio 时休市标的被剔除（仅周末无行情过滤项时为空）
  const weekdayOpts = {
    statusBarEnabled: true,
    autoCollapseClosedGroups: true,
    now: new Date("2026-11-11T10:00:00+08:00"), // 周三交易时段
    aShare: { enabled: true, statusBar: true },
  };
  assert.strictEqual(extractHoldingQuotes(watchlist, quoteCache, weekdayOpts).length, 2);
  const weekendDefault = extractHoldingQuotes(watchlist, quoteCache, { ...weekdayOpts, now: saturday });
  assert.strictEqual(weekendDefault.length, 0);
});

// ── 在线实时汇率：注入/回退/过期/消毒契约 ──────────────────────────

// 2026-11-13 10:00 新浪外汇接口实测原文（GBK 解码后），逐字保留字段布局。
// 真实报文的字段为：[0]时间 [1]开盘 [2]? [3]昨收 [4]成交量 [5]? [6]? [7]最低 [8]最新价 [9]中文名…
// 旧样本把 [3] 写成成交量、少了一个字段，虽然 [8] 碰巧仍是最新价，但无法保护字段下标语义。
const GOLDEN_SINA_FX_TEXT = [
  'var hq_str_fx_susdcny="10:00:02,6.6678000000,6.6678000000,6.6745000000,41.0000000000,6.6700000000,6.6713000000,6.6672000000,6.6677000000,在岸人民币,-0.1019,-0.0068,0.0041,此行情由新浪财经计算得出,0.0000,0.0000,,2026-11-13";',
  'var hq_str_fx_shkdcny="10:00:54,0.8500293260,0.8500293260,0.8503184443,5.8550930000,0.8502967536,0.8504992431,0.8499137338,0.8500293260,港元兑人民币,-0.0340,-0.0003,0.0006,此行情由新浪财经计算得出,0.0000,0.0000,,2026-11-13";',
  'var hq_str_fx_susdhkd="10:01:42,7.844500,7.845000,7.844700,17,7.844900,7.845400,7.843700,7.844500,美元兑港元即期汇率,-0.010000,-0.000200,0.0002167,,7.849100,7.781500,,2026-11-13";',
].join("\n");

void test("parseSinaFxResponse - 实测黄金样本：字段[8]最新价正确提取（不得误取[3]昨收）", () => {
  const rates = parseSinaFxResponse(GOLDEN_SINA_FX_TEXT);
  assert.ok(rates, "黄金样本应解析成功");
  assert.strictEqual(rates.usdToCny, 6.6677);
  assert.strictEqual(rates.hkdToCny, 0.850029326);
  assert.ok(rates.fetchedAt > 0);
  // [3] 昨收 / [1] 开盘 与 [8] 最新价不同，锁死「取最新价」这一语义
  assert.notStrictEqual(rates.usdToCny, 6.6745, "不得误取 [3] 昨收");
  assert.notStrictEqual(rates.hkdToCny, 0.8503184443, "不得误取 [3] 昨收");
});

void test("parseSinaFxResponse - hkdcny 缺失时由 usdcny/usdhkd 交叉推导", () => {
  const noHkdCny = [
    'var hq_str_fx_susdcny="03:00:00,6.6700,6.6745,78,6.6718,6.6745,6.6667,6.6745,6.6745,在岸人民币";',
    'var hq_str_fx_susdhkd="08:57:45,7.8442,7.8447,7.8447,16,7.8449,7.8454,7.8438,7.8442,美元兑港元";',
  ].join("\n");
  const rates = parseSinaFxResponse(noHkdCny);
  assert.ok(rates, "交叉推导应成功");
  assert.strictEqual(rates.usdToCny, 6.6745);
  assert.ok(Math.abs(rates.hkdToCny - 6.6745 / 7.8442) < 1e-9, `hkdToCny: ${rates.hkdToCny}`);
});

void test("parseSinaFxResponse - 失真/缺失消毒：区间外拒绝、usdcny 必需、空报文返回 undefined", () => {
  // usdcny 超出 (5,15) 区间：整体拒绝
  assert.strictEqual(parseSinaFxResponse('var hq_str_fx_susdcny="x,1,1,1,1,1,1,1,100,美元";'), undefined);
  // 缺 usdcny：拒绝
  assert.strictEqual(parseSinaFxResponse('var hq_str_fx_shkdcny="x,0.85,0.85,1,0.85,0.85,0.85,0.85,0.85,港元兑人民币";'), undefined);
  // hkdcny 推导链全断（usdhkd 也缺失）：拒绝
  assert.strictEqual(parseSinaFxResponse('var hq_str_fx_susdcny="x,6.67,6.67,1,6.67,6.67,6.67,6.67,6.6745,在岸人民币";'), undefined);
  // 空文本 / 非外汇报文
  assert.strictEqual(parseSinaFxResponse(""), undefined);
  assert.strictEqual(parseSinaFxResponse("var hq_str_sh600000=\"浦发银行\";"), undefined);
  // 占位值（空串/"-"）不得伪装成真实零值：字段[8] 与回退[1]均无效 → 拒绝
  assert.strictEqual(parseSinaFxResponse('var hq_str_fx_susdcny="x,-,78,1,6.67,6.67,6.67,6.67,-,在岸人民币";'), undefined);
});

void test("setLiveFxRates / getEffectiveFxRates - 有效注入生效、失真值拒绝、undefined 清除", () => {
  try {
    // 有效注入：source=live，换算使用实时牌价
    setLiveFxRates({ usdToCny: 6.67, hkdToCny: 0.85, fetchedAt: Date.now() });
    const live = getEffectiveFxRates();
    assert.strictEqual(live.source, "live");
    assert.strictEqual(live.usdToCny, 6.67);
    assert.strictEqual(live.hkdToCny, 0.85);
    assert.strictEqual(live.usdtToCny, 6.67, "USDT 应锚定 USD 实时价");
    assert.ok(Math.abs(toBaseCurrency(100, "USD", "CNY") - 667) < 1e-9);

    // 失真值拒绝：区间外 / 非有限值不覆盖已注入的有效值
    setLiveFxRates({ usdToCny: 100, hkdToCny: 0.85, fetchedAt: Date.now() });
    setLiveFxRates({ usdToCny: Number.NaN, hkdToCny: 0.85, fetchedAt: Date.now() });
    setLiveFxRates({ usdToCny: 6.67, hkdToCny: 5, fetchedAt: Date.now() });
    setLiveFxRates({ usdToCny: 6.67, hkdToCny: 0.85, fetchedAt: 0 });
    assert.strictEqual(getEffectiveFxRates().usdToCny, 6.67, "失真注入不得覆盖有效值");

    // computePortfolioSummary 携带实时汇率元信息
    const holdings: HoldingItemQuote[] = [
      makeHolding({ symbol: "AAPL", currency: "USD", cost: 210, shares: 5, price: 200, change: -5 }),
    ];
    const summary = computePortfolioSummary(holdings, "CNY");
    assert.strictEqual(summary.fx.source, "live");
    assert.strictEqual(summary.fx.usdToCny, 6.67);
    assert.ok(Math.abs(summary.total.marketVal - 1000 * 6.67) < 1e-9);
    assert.ok(formatFxSourceNote(summary.fx).includes("在线牌价（更新于"), formatFxSourceNote(summary.fx));

    // undefined 清除：回退静态参考值
    setLiveFxRates(undefined);
    assert.strictEqual(getEffectiveFxRates().source, "static");
    assert.strictEqual(toBaseCurrency(100, "USD", "CNY"), FX_RATES_TO_CNY.USD * 100);
  } finally {
    resetLiveFxRatesForTest();
  }
});

void test("getEffectiveFxRates - 超过 FX_LIVE_STALE_MS 的快照过期回退静态", () => {
  try {
    const now = Date.now();
    setLiveFxRates({ usdToCny: 6.67, hkdToCny: 0.85, fetchedAt: now - (FX_LIVE_STALE_MS + 1000) });
    const stale = getEffectiveFxRates();
    assert.strictEqual(stale.source, "static", "过期快照应回退静态参考值");
    assert.strictEqual(stale.usdToCny, FX_RATES_TO_CNY.USD);
    assert.strictEqual(stale.hkdToCny, FX_RATES_TO_CNY.HKD);
    assert.strictEqual(stale.usdtToCny, FX_RATES_TO_CNY.USDT);
    assert.strictEqual(formatFxSourceNote(stale), "静态参考值兜底");
    // 换算同步回退静态口径（取常量，不写死牌价）
    assert.strictEqual(toBaseCurrency(100, "USD", "CNY"), FX_RATES_TO_CNY.USD * 100);
  } finally {
    resetLiveFxRatesForTest();
  }
});

// ── 盈亏率 / 文案 / 金额格式化：三入口共享出口回归 ───────────────────

void test("deriveTodayProfitRate - 分母是昨收市值而非持仓本金（长期持仓不被放大）", () => {
  // 成本 100 / 昨收 198 / 现价 200 / 今日 +2 → 应为 2/198 ≈ 1.0101%
  const bucket = { marketVal: 200, costVal: 100, todayProfit: 2, totalProfit: 100 };
  assert.ok(Math.abs(deriveTodayProfitRate(bucket) - (2 / 198) * 100) < 1e-9);
  assert.ok(Math.abs(deriveTodayProfitRate(bucket) - 1.0101) < 0.001);
  // 旧错误口径 2/100 = 2%，必须明显不同，防止分母回退
  assert.notStrictEqual(deriveTodayProfitRate(bucket), 2);

  // 累计浮盈率仍以持仓本金为分母，两个口径不得混用
  assert.strictEqual(deriveTotalProfitRate(bucket), 100);

  // 与 computePortfolioSummary 的真实桶联动（上一交易日价格由 prevClose 给出）
  const holdings = [
    makeHolding({ symbol: "sh600000", currency: "CNY", cost: 1, shares: 100, price: 2, prevClose: 1.98 }),
  ];
  const summary = computePortfolioSummary(holdings, "CNY");
  assert.strictEqual(summary.total.marketVal, 200);
  assert.ok(Math.abs(summary.total.todayProfit - 2) < 1e-9, "prevClose 降级链：2 - 1.98 = 0.02/股");
  assert.ok(Math.abs(deriveTodayProfitRate(summary.total) - (2 / 198) * 100) < 1e-9);

  // 除零 / 非法守卫：昨收市值 ≤ 0 或本金 = 0 时回落 0，不产生 NaN/Infinity
  assert.strictEqual(deriveTodayProfitRate({ marketVal: 0, costVal: 0, todayProfit: 0, totalProfit: 0 }), 0);
  assert.strictEqual(deriveTodayProfitRate({ marketVal: 5, costVal: 1, todayProfit: 5, totalProfit: 0 }), 0);
  assert.strictEqual(deriveTotalProfitRate({ marketVal: 0, costVal: 0, todayProfit: 0, totalProfit: 10 }), 0);
  assert.strictEqual(deriveTodayProfitRate({ marketVal: Number.NaN, costVal: 1, todayProfit: 1, totalProfit: 0 }), 0);
});

void test("formatFxSourceNote - 当天显示 HH:mm、跨天带日期、静态显示兜底", () => {
  const now = new Date();
  const sameDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 30).getTime();
  const liveToday = {
    usdToCny: 6.6677, hkdToCny: 0.850029326, usdtToCny: 6.6677, fetchedAt: sameDay, source: "live" as const,
  };
  assert.match(formatFxSourceNote(liveToday), /^在线牌价（更新于 \d{1,2}:\d{2}）$/);
  assert.ok(!formatFxSourceNote(liveToday).includes("月"), "当天快照不应带日期");

  // 24h 有效期内的「昨天」快照必须带日期，否则会被读成今天 HH:mm
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 9, 30).getTime();
  const liveYesterday = { ...liveToday, fetchedAt: yesterday };
  const crossDayNote = formatFxSourceNote(liveYesterday);
  assert.match(crossDayNote, /^在线牌价（更新于 \d{1,2}月\d{1,2}日 \d{1,2}:\d{2}）$/);

  const staticFx = getEffectiveFxRates();
  assert.strictEqual(formatFxSourceNote(staticFx), "静态参考值兜底");
});

void test("formatFxDetailNote - 统一插值牌价、静态兜底明确提示偏差、超长小数收口", () => {
  const staticFx = getEffectiveFxRates();
  const staticNote = formatFxDetailNote(staticFx);
  assert.ok(staticNote.includes(`USD/CNY ${FX_RATES_TO_CNY.USD}`), staticNote);
  assert.ok(staticNote.includes(`HKD/CNY ${FX_RATES_TO_CNY.HKD}`), staticNote);
  assert.ok(staticNote.includes("内置静态参考值"), staticNote);
  assert.ok(staticNote.includes("可能与实时牌价存在偏差"), staticNote);

  const liveNote = formatFxDetailNote({
    usdToCny: 6.6677, hkdToCny: 0.850029326, usdtToCny: 6.6677,
    fetchedAt: Date.now(), source: "live",
  });
  assert.ok(liveNote.includes("USD/CNY 6.6677"), liveNote);
  assert.ok(liveNote.includes("HKD/CNY 0.850029"), "6 位精度收口，不得把 0.8500293260 原样塞进 UI");
  assert.ok(!liveNote.includes("内置静态参考值"), liveNote);
});

void test("formatPortfolioAmount - 恒返回绝对值、亿/万简写、小额 4 位、非有限值守卫", () => {
  assert.strictEqual(formatPortfolioAmount(-1234.567), "1,234.57");
  assert.strictEqual(formatPortfolioAmount(1234.567), "1,234.57");
  assert.strictEqual(formatPortfolioAmount(12345678), "1234.57万");
  assert.strictEqual(formatPortfolioAmount(123456789), "1.23亿");
  assert.strictEqual(formatPortfolioAmount(0.001234), "0.0012");
  assert.strictEqual(formatPortfolioAmount(0), "0.00");
  assert.strictEqual(formatPortfolioAmount(Number.NaN), "0.00");
  assert.strictEqual(formatPortfolioAmount(Number.POSITIVE_INFINITY), "0.00");
});

// ── 汇率链路：代理遵从 / 多入口刷新触发 ──────────────────────────────

void test("resolveFxNetworkOptions - 汇率请求遵从用户代理配置（回归：默认直连）", async () => {
  const vscode = await import("vscode");
  const cfg = vscode.workspace.getConfiguration("marketlens");
  const savedMode = cfg.get("aShare.networkMode");
  const savedUrl = cfg.get("aShare.proxyUrl");
  try {
    await cfg.update("aShare.networkMode", "proxy", vscode.ConfigurationTarget.Global);
    await cfg.update("aShare.proxyUrl", "http://127.0.0.1:7890", vscode.ConfigurationTarget.Global);
    const proxied = resolveFxNetworkOptions();
    assert.strictEqual(proxied.mode, "proxy", "A股板块设为代理时汇率请求不得直连");
    assert.strictEqual(proxied.proxyUrl, "http://127.0.0.1:7890");

    await cfg.update("aShare.networkMode", "direct", vscode.ConfigurationTarget.Global);
    assert.strictEqual(resolveFxNetworkOptions().mode, "direct", "切回直连应即时生效");
  } finally {
    await cfg.update("aShare.networkMode", savedMode, vscode.ConfigurationTarget.Global);
    await cfg.update("aShare.proxyUrl", savedUrl, vscode.ConfigurationTarget.Global);
  }
});

void test("scheduler - Alt+P 取快照触发在线汇率刷新且 TTL 节流", async () => {
  const { RefreshScheduler } = await import("../src/scheduler.ts");
  const vscode = await import("vscode");
  (vscode as any).__resetMock();

  let calls = 0;
  const fakeRates = { usdToCny: 6.6677, hkdToCny: 0.850029326, fetchedAt: Date.now() };
  const scheduler = new RefreshScheduler({
    marketManager: { clearInvalidCache() {}, pruneInvalidCaches() {}, pollAll: async () => [] } as any,
    treeProvider: { setAlerts() {}, buildTree() {}, applyQuotes() {}, isEmpty: () => false } as any,
    statusBar: { setQuotes() {}, show() {}, hide() {}, isBossKeyActive: () => false } as any,
    treeView: { visible: false } as any,
    // autoRefresh=false / 状态栏关闭 / 侧边栏不可见 均不影响本入口
    fxRateFetcher: async () => { calls++; return fakeRates; },
  });

  const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  try {
    scheduler.getPortfolioSnapshot();
    await tick();
    assert.strictEqual(calls, 1, "Alt+P 取快照应触发一次在线汇率刷新");
    assert.strictEqual(getEffectiveFxRates().source, "live", "拉取成功后应注入在线牌价");
    assert.strictEqual(getEffectiveFxRates().usdToCny, 6.6677);

    scheduler.getPortfolioSnapshot();
    await tick();
    assert.strictEqual(calls, 1, "TTL 内重复取快照不得放大请求量");
  } finally {
    resetLiveFxRatesForTest();
    scheduler.stop();
    scheduler.dispose();
  }
});

void test("scheduler 源码契约 - 汇率刷新早于资源节流早退、getPortfolioSnapshot 亦触发", () => {
  const src = fs.readFileSync("src/scheduler.ts", "utf8");
  const refreshBody = src.slice(src.indexOf("public async refresh("));
  const fxTrigger = refreshBody.indexOf("this.maybeRefreshFxRates();");
  const earlyReturn = refreshBody.indexOf("this.scheduleNextTick();");
  assert.ok(fxTrigger > -1 && earlyReturn > -1, "应能定位刷新触发点与节流早退点");
  assert.ok(
    fxTrigger < earlyReturn,
    "汇率刷新必须早于资源节流早退，否则状态栏关闭 + 侧边栏不可见时在线汇率永不更新"
  );

  const snapshotStart = src.indexOf("public getPortfolioSnapshot(");
  const snapshotBody = src.slice(snapshotStart, src.indexOf("public isAdaptiveThrottled(", snapshotStart));
  assert.ok(
    snapshotBody.includes("this.maybeRefreshFxRates();"),
    "Alt+P / autoRefresh=false 场景应能从取快照入口触发汇率刷新"
  );
});

void test("总账展示单一出口契约 - 三处 UI 不得复制盈亏率公式、金额格式化或写死牌价", () => {
  for (const rel of ["src/commands/index.ts", "src/ui/statusBar.ts", "src/ui/watchlistProvider.ts"]) {
    const src = fs.readFileSync(rel, "utf8");
    assert.ok(!src.includes("formatHoldingProfit"), `${rel} 不得保留本地金额格式化副本`);
    assert.ok(src.includes("formatPortfolioAmount"), `${rel} 必须复用统一金额格式化出口`);
    assert.ok(src.includes("deriveTodayProfitRate"), `${rel} 今日盈亏率必须复用共享公式（分母为昨收市值）`);
    assert.ok(src.includes("formatFxDetailNote"), `${rel} 汇率明细必须由共享出口插值生成`);
    assert.ok(
      !src.includes("USD/CNY 7.23") && !src.includes("HKD/CNY 0.92"),
      `${rel} 不得写死旧牌价，避免与 FX_RATES_TO_CNY / 在线快照漂移`
    );
  }
  // 发布物与配置描述同样不得残留旧牌价（.trae 历史设计稿已加过时注记，不在此列）
  for (const rel of [
    "README.md", "README.en.md", "package.nls.json", "package.nls.zh-cn.json",
    "CHANGELOG.md", "src/ui/settingsHtml.ts",
  ]) {
    const doc = fs.readFileSync(rel, "utf8");
    assert.ok(
      !doc.includes("USD/CNY 7.23") && !doc.includes("HKD/CNY 0.92"),
      `${rel} 不得写死已校准的旧静态牌价`
    );
  }
});

void test("P2 回归 - 零成本持仓（赠股）录入/总账同口径合法，负成本脏数据三端一致过滤", () => {
  resetLiveFxRatesForTest();
  const watchlist: WatchlistConfig = {
    "A股": [
      { symbol: "sh600519", name: "赠股", type: "A_SHARE", cost: 0, shares: 100 } as any,
      { symbol: "sh600000", name: "脏数据", type: "A_SHARE", cost: -5, shares: 100 } as any,
    ],
  };
  const cache = new Map<string, MarketItem>();
  cache.set("sh600519", { id: "sh600519", symbol: "sh600519", name: "赠股", type: "A_SHARE", price: 20, changePercent: 0 } as any);
  cache.set("sh600000", { id: "sh600000", symbol: "sh600000", name: "脏数据", type: "A_SHARE", price: 10, changePercent: 0 } as any);

  const holdings = extractHoldingQuotes(watchlist, cache, { forPortfolio: true });
  assert.strictEqual(holdings.length, 1, "cost=0 合法保留，cost<0 过滤（与 isValidHoldingQuote 同口径）");
  assert.strictEqual(holdings[0].cost, 0);

  const summary = computePortfolioSummary(
    holdings.map((h) => ({ ...h, section: "aShare" as const })),
    "CNY"
  );
  assert.strictEqual(summary.holdingsCount, 1);
  assert.strictEqual(summary.total.costVal, 0);
  assert.strictEqual(summary.total.marketVal, 2000);
  assert.strictEqual(summary.total.totalProfit, 2000);
  const section = summary.bySection.aShare;
  assert.ok(section, "板块桶必须存在");
  assert.strictEqual(section!.marketVal, summary.total.marketVal, "total 与 bySection 对账一致");
  assert.strictEqual(section!.totalProfit, summary.total.totalProfit);
});
