// test/optimizations.test.ts
// OPT-1~10 优化项回归测试：全景并行/榜单口径、休市判定缓存与港股半日市、
// 失效计数修剪、CSP 收紧、网络探测合并、币安计价币种、搜索降级与其余健壮性小项。
import assert from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as vscode from "vscode";

import {
  getZonedTimeParts,
  getZonedDateString,
  beijingFormatter,
  beijingDateFormatter,
  isHKMarketOpen,
  HK_HALF_DAYS,
} from "../src/utils/marketHours.ts";
import { BinanceService } from "../src/services/binanceService.ts";
import { DexScreenerService } from "../src/services/dexScreenerService.ts";
import {
  setCustomHttpExecutor,
  resetProxyCache,
  testGatewayTransparentProxy,
} from "../src/services/network.ts";
import { fetchASharePanorama, fetchCryptoPanorama } from "../src/services/panoramaService.ts";
import { computePortfolioSummary, toBaseCurrency, isFiatConvertibleCurrency } from "../src/utils/portfolio.ts";
import { currencyPrefix, currencySuffix, extractStatusBarQuotes } from "../src/utils/symbolHelper.ts";
import type { HoldingItemQuote } from "../src/utils/symbolHelper.ts";
import { searchSymbols, resetSearchCacheForTesting } from "../src/services/symbolSearchService.ts";
import {
  validateBackupData,
  importSettingsFromFile,
  MAX_BACKUP_GROUPS,
  MAX_BACKUP_SYMBOLS,
  MAX_BACKUP_ALERTS,
  MAX_BACKUP_FILE_BYTES,
} from "../src/utils/backupHelper.ts";
import { setMaskSnapshotSource } from "../src/utils/feedback.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const ok = (data: unknown) => ({ data, status: 200, statusText: "OK", headers: {} });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── OPT-2：休市判定 Intl 热路径分钟级缓存 ──────────────────────────

void test("OPT-2 getZonedTimeParts/getZonedDateString - 同一分钟命中缓存，跨分钟重算且结果正确", () => {
  // 2026-11-23 为周一；02:00 UTC = 北京 10:00
  const d1 = new Date("2026-11-23T02:00:10Z");
  const p1 = getZonedTimeParts(beijingFormatter, d1);
  assert.strictEqual(p1.day, 1);
  assert.strictEqual(p1.totalMinutes, 10 * 60);

  const p2 = getZonedTimeParts(beijingFormatter, new Date("2026-11-23T02:00:50Z"));
  assert.strictEqual(p1, p2, "同一 UTC 分钟内必须复用同一缓存结果对象");

  const p3 = getZonedTimeParts(beijingFormatter, new Date("2026-11-23T02:01:00Z"));
  assert.notStrictEqual(p1, p3, "跨分钟必须重算");
  assert.strictEqual(p3.totalMinutes, 10 * 60 + 1);

  assert.strictEqual(getZonedDateString(beijingDateFormatter, d1), "2026-11-23");
  assert.strictEqual(
    getZonedDateString(beijingDateFormatter, new Date("2026-11-23T02:00:59Z")),
    "2026-11-23"
  );
  // 北京时区跨日边界：16:00 UTC 已是次日
  assert.strictEqual(
    getZonedDateString(beijingDateFormatter, new Date("2026-11-23T16:00:00Z")),
    "2026-11-24"
  );
});

// ── OPT-6：港股半日市（平安夜/除夕/农历除夕） ──────────────────────

void test("OPT-6 港股半日市 - 上午开市、午市关闭，普通日与全休日不受影响", () => {
  assert.ok(HK_HALF_DAYS.has("2026-12-24"), "平安夜必须在半日市日历中");
  assert.ok(HK_HALF_DAYS.has("2026-12-31"), "公历除夕必须在半日市日历中");
  assert.ok(HK_HALF_DAYS.has("2026-02-16"), "2026 农历除夕（春节首日前一工作日）必须在半日市日历中");

  // 平安夜（周四）：北京 11:00 开市，13:30 / 15:00 已收市
  assert.strictEqual(isHKMarketOpen(new Date("2026-12-24T03:00:00Z")), true);
  assert.strictEqual(isHKMarketOpen(new Date("2026-12-24T05:30:00Z")), false);
  assert.strictEqual(isHKMarketOpen(new Date("2026-12-24T07:00:00Z")), false);

  // 公历除夕与农历除夕同样仅上午
  assert.strictEqual(isHKMarketOpen(new Date("2026-12-31T03:00:00Z")), true);
  assert.strictEqual(isHKMarketOpen(new Date("2026-12-31T05:30:00Z")), false);
  assert.strictEqual(isHKMarketOpen(new Date("2026-02-16T03:00:00Z")), true);
  assert.strictEqual(isHKMarketOpen(new Date("2026-02-16T05:30:00Z")), false);

  // 前一交易日（12-23 周三）下午照常开市
  assert.strictEqual(isHKMarketOpen(new Date("2026-12-23T05:30:00Z")), true);
  // 圣诞节（12-25）全日休市，上午也不开
  assert.strictEqual(isHKMarketOpen(new Date("2026-12-25T03:00:00Z")), false);
});

// ── OPT-4：失效抑制/失败计数 Map 按当前自选修剪 ────────────────────

void test("OPT-4 BinanceService.pruneInactiveSymbols - 仅保留当前自选的抑制状态（按标准化键匹配）", () => {
  const svc = new BinanceService();
  svc.markSymbolInvalidForTest("OLDUSDT");
  svc.markSymbolInvalidForTest("BTCUSDT");
  assert.strictEqual(svc.isSymbolSuppressed("OLDUSDT"), true);

  svc.pruneInactiveSymbols(["btcusdt"]);
  assert.strictEqual(svc.isSymbolSuppressed("OLDUSDT"), false, "已移出自选的标的抑制必须被修剪");
  assert.strictEqual(svc.isSymbolSuppressed("BTCUSDT"), true, "仍在自选的标的抑制必须保留（大小写归一匹配）");

  svc.pruneInactiveSymbols([]);
  assert.strictEqual(svc.isSymbolSuppressed("BTCUSDT"), false, "清空自选后抑制状态全部回收");
});

void test("OPT-4 DexScreenerService.pruneInactiveAddresses - 抑制与失败计数同步修剪（小写键匹配）", () => {
  const dex = new DexScreenerService();
  const internals = dex as unknown as {
    invalidAddresses: Map<string, number>;
    addressFailureCounts: Map<string, number>;
  };
  internals.invalidAddresses.set("0xold", Date.now() + 60_000);
  internals.invalidAddresses.set("0xkeep", Date.now() + 60_000);
  internals.addressFailureCounts.set("0xold", 1);

  dex.pruneInactiveAddresses(["0xKEEP"]);
  assert.strictEqual(dex.isAddressSuppressed("0xold"), false);
  assert.strictEqual(dex.isAddressSuppressed("0xkeep"), true);
  assert.strictEqual(internals.addressFailureCounts.has("0xold"), false, "失败计数必须与抑制同步修剪");
});

void test("OPT-4 调度器仅在全量刷新路径按完整自选修剪（源码契约）", () => {
  const src = read("src/scheduler.ts");
  assert.ok(
    src.includes("const fullTargets = extractTargetsFromWatchlist(config.watchlist);"),
    "修剪集必须取自完整自选（默认全启用），不得因板块临时禁用丢失抑制状态"
  );
  assert.ok(
    src.includes("this.marketManager.pruneInvalidCaches(fullTargets.cryptos, fullTargets.bscTokens);"),
    "全量刷新必须委托 MarketManager 修剪两类失效缓存"
  );
});

// ── OPT-5：设置面板 CSP 与全景面板同口径 ───────────────────────────

void test("OPT-5 设置面板 CSP 收紧至 default-src 'none'，与全景面板同一口径（源码契约）", () => {
  const settings = read("src/ui/settingsHtml.ts");
  const panorama = read("src/ui/panoramaHtml.ts");
  const cspLine = (src: string): string => {
    const m = src.match(/Content-Security-Policy" content="([^"]+)"/);
    assert.ok(m, "必须存在 CSP meta 标签");
    return m[1]!;
  };
  const settingsCsp = cspLine(settings);
  assert.strictEqual(settingsCsp, cspLine(panorama), "两个 Webview 的 CSP 必须逐字一致");
  assert.ok(settingsCsp.includes("default-src 'none'"));
  assert.ok(settingsCsp.includes("script-src 'nonce-${nonce}'"));
  assert.ok(!settingsCsp.includes("unsafe-eval"));
});

// ── OPT-7：网关探测在途合并 / 解压失败告警 ─────────────────────────

void test("OPT-7 testGatewayTransparentProxy - 并发首轮探测共享同一在途请求", async () => {
  resetProxyCache();
  let calls = 0;
  setCustomHttpExecutor(async () => {
    calls += 1;
    await delay(20);
    return ok("");
  });
  try {
    const [a, b] = await Promise.all([
      testGatewayTransparentProxy(),
      testGatewayTransparentProxy(),
    ]);
    assert.strictEqual(a, true);
    assert.strictEqual(b, true);
    assert.strictEqual(calls, 1, "并发探测必须合并为一次外网请求");
  } finally {
    setCustomHttpExecutor(undefined);
    resetProxyCache();
  }
});

void test("OPT-7 解压失败降级必须留告警，不得静默吞掉（源码契约）", () => {
  const src = read("src/services/network.ts");
  assert.ok(
    src.includes("解压失败，降级使用原始报文"),
    "Content-Encoding 解压失败的降级路径必须写入 logger.warn"
  );
});

// ── OPT-8：币安计价对币种识别与总账口径 ────────────────────────────

void test("OPT-8 parseTickerItem - BTC/ETH 计价对如实标注，稳定币与未识别后缀维持 U 本位", () => {
  const svc = new BinanceService();
  const mk = (symbol: string) => ({
    symbol,
    priceChange: "0.001",
    priceChangePercent: "2",
    lastPrice: "0.05",
    openPrice: "0.049",
    highPrice: "0.051",
    lowPrice: "0.048",
    prevClosePrice: "0.049",
    volume: "100",
    quoteVolume: "5",
  });
  assert.strictEqual(svc.parseTickerItem(mk("ETHBTC")).currency, "BTC");
  assert.strictEqual(svc.parseTickerItem(mk("ETHBTC")).name, "ETH/BTC");
  assert.strictEqual(svc.parseTickerItem(mk("BTCETH")).currency, "ETH");
  assert.strictEqual(svc.parseTickerItem(mk("BTCUSDT")).currency, "USDT");
  assert.strictEqual(svc.parseTickerItem(mk("BTCUSDC")).currency, "USDT");
  assert.strictEqual(svc.parseTickerItem(mk("FOOBAR")).currency, "USDT", "未识别后缀沿用 U 本位口径");
});

void test("OPT-8 BTC/ETH 计价持仓保留原生桶但不折算进基准总账（无法币汇率依据）", () => {
  const holdings: HoldingItemQuote[] = [
    { name: "浦发银行", symbol: "sh600000", currency: "CNY", cost: 9, shares: 100, price: 10, change: 0.2, changePercent: 2, section: "aShare" },
    { name: "ETH/BTC", symbol: "ETHBTC", currency: "BTC", cost: 0.04, shares: 2, price: 0.05, change: 0.001, changePercent: 2, section: "binance" },
  ];
  const summary = computePortfolioSummary(holdings, "CNY");

  assert.ok(summary.byCurrency["BTC"], "原生 BTC 桶必须保留供对账展示");
  assert.ok(Math.abs(summary.byCurrency["BTC"]!.marketVal - 0.1) < 1e-9);
  assert.strictEqual(summary.total.marketVal, 1000, "基准总账只含可法币折算持仓");
  assert.strictEqual(summary.total.count, 1);
  assert.strictEqual(summary.bySection["binance"]!.marketVal, 0);
  assert.strictEqual(summary.bySection["binance"]!.count, 0);
  assert.strictEqual(summary.holdingsCount, 2, "有效持仓计数仍含 BTC 计价标的");

  assert.strictEqual(toBaseCurrency(100, "BTC", "CNY"), 0);
  assert.strictEqual(toBaseCurrency(100, "ETH", "USD"), 0);
  assert.strictEqual(isFiatConvertibleCurrency("BTC"), false);
  assert.strictEqual(isFiatConvertibleCurrency("ETH"), false);
  assert.strictEqual(isFiatConvertibleCurrency("USDT"), true);
});

void test("OPT-8 currencyPrefix/currencySuffix - BTC/ETH 用后缀记法，法币沿用前缀", () => {
  assert.strictEqual(currencyPrefix("CNY"), "¥");
  assert.strictEqual(currencyPrefix("HKD"), "HK$");
  assert.strictEqual(currencyPrefix("USD"), "$");
  assert.strictEqual(currencyPrefix("USDT"), "$");
  assert.strictEqual(currencyPrefix("BTC"), "");
  assert.strictEqual(currencyPrefix("ETH"), "");
  assert.strictEqual(currencySuffix("BTC"), " BTC");
  assert.strictEqual(currencySuffix("ETH"), " ETH");
  assert.strictEqual(currencySuffix("CNY"), "");
  assert.strictEqual(currencySuffix("USDT"), "");
});

// ── OPT-1/3：全景请求并行化与榜单符号过滤 ──────────────────────────

const makeSector = (id: string, name: string, inflow: number) => ({
  f12: id, f14: name, f2: 10, f3: 2, f6: 1e9, f62: inflow,
});

const ashareExecutor = (sectors: ReturnType<typeof makeSector>[]) => async (opts: { url?: unknown }) => {
  const url = String(opts.url ?? "");
  if (url.includes("ulist.np")) return ok({ data: { diff: [{ f104: 100, f105: 50, f106: 10, f6: 1e12 }] } });
  if (url.includes("clist")) return ok({ data: { diff: sectors } });
  if (url.includes("getTopicZTPool")) return ok({ data: { tc: 5 } });
  if (url.includes("getTopicDTPool")) return ok({ data: { tc: 2 } });
  return ok({});
};

void test("OPT-3 A 股净流入/流出榜按符号过滤 - 全净流入日流出榜宁缺毋滥", async () => {
  const sectors = Array.from({ length: 6 }, (_, i) => makeSector(`BK${i}`, `板块${i}`, (6 - i) * 1e8));
  setCustomHttpExecutor(ashareExecutor(sectors));
  try {
    const data = await fetchASharePanorama();
    assert.strictEqual(data.topInflows.length, 5);
    assert.strictEqual(data.topOutflows.length, 0, "没有真实净流出时不得把最小净流入伪装成流出");
  } finally {
    setCustomHttpExecutor(undefined);
  }
});

void test("OPT-3 混合行情两榜不重叠，流出榜按流出额降序", async () => {
  const sectors = [
    makeSector("BK0", "流入A", 3e8),
    makeSector("BK1", "流入B", 2e8),
    makeSector("BK2", "流出A", -1e8),
    makeSector("BK3", "流出B", -5e8),
    makeSector("BK4", "流出C", -2e8),
  ];
  setCustomHttpExecutor(ashareExecutor(sectors));
  try {
    const data = await fetchASharePanorama();
    assert.deepStrictEqual(data.topInflows.map((s) => s.name), ["流入A", "流入B"]);
    assert.deepStrictEqual(data.topOutflows.map((s) => s.name), ["流出B", "流出C", "流出A"]);
    const overlap = data.topInflows.filter((i) => data.topOutflows.some((o) => o.name === i.name));
    assert.strictEqual(overlap.length, 0);
  } finally {
    setCustomHttpExecutor(undefined);
  }
});

void test("OPT-1 fetchASharePanorama - 四路请求并发发起，不串行叠加首屏耗时", async () => {
  let inFlight = 0;
  let peak = 0;
  const sectors = [makeSector("BK0", "板块A", 1e8)];
  const base = ashareExecutor(sectors);
  setCustomHttpExecutor(async (opts) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      await delay(25);
      return await base(opts);
    } finally {
      inFlight -= 1;
    }
  });
  try {
    await fetchASharePanorama();
    assert.ok(peak >= 4, `ulist/clist/涨停池/跌停池必须并发发起，实测峰值 ${peak}`);
  } finally {
    setCustomHttpExecutor(undefined);
  }
});

void test("OPT-3 加密领涨/领跌榜按符号过滤 - 普涨日领跌榜为空", async () => {
  const tickers = Array.from({ length: 12 }, (_, i) => ({
    symbol: `COIN${i}USDT`,
    lastPrice: "10",
    priceChangePercent: String(12 - i),
    quoteVolume: "1000000",
  }));
  setCustomHttpExecutor(async (opts) => {
    const url = String(opts.url ?? "");
    if (url.includes("alternative.me")) {
      return ok({ data: [{ value: "60", value_classification: "Greed", timestamp: "1700000000" }] });
    }
    if (url.includes("binance")) return ok(tickers);
    return ok({});
  });
  try {
    const data = await fetchCryptoPanorama();
    assert.strictEqual(data.topGainers.length, 5);
    assert.strictEqual(data.topLosers.length, 0, "没有真实下跌时不得把最小涨幅伪装成下跌");
  } finally {
    setCustomHttpExecutor(undefined);
  }
});

// ── OPT-9：搜索配置读取异常优雅降级 ────────────────────────────────

void test("OPT-9 searchSymbols - readConfig 抛错时降级为空结果而非 reject", async () => {
  resetSearchCacheForTesting();
  const original = vscode.workspace.getConfiguration;
  (vscode.workspace as any).getConfiguration = () => {
    throw new Error("config unavailable");
  };
  try {
    assert.deepStrictEqual(await searchSymbols("600519"), []);
  } finally {
    (vscode.workspace as any).getConfiguration = original;
    resetSearchCacheForTesting();
  }
});

// ── OPT-10：状态栏轮播去重按标准化标的身份 ─────────────────────────

void test("OPT-10 extractStatusBarQuotes - hk00700 / 00700 同一标的不得重复轮播", () => {
  const watchlist = {
    "港股": [
      { symbol: "hk00700", name: "腾讯控股", type: "HK_STOCK" },
      { symbol: "00700", name: "腾讯控股", type: "HK_STOCK" },
    ],
  };
  const quoteCache = new Map([
    ["hk700", { symbol: "hk00700", name: "腾讯控股", price: 300, changePercent: 1 }],
  ]);
  const quotes = extractStatusBarQuotes(watchlist, quoteCache);
  assert.strictEqual(quotes.length, 1, "前导零别名与标准码必须按 normalizeSymbolKey 归一去重");
  assert.strictEqual(quotes[0]!.price, 300);
});

// ── OPT-10：全景面板 switchTab 白名单 / resize 有限值 / 隐藏停轮询 ──

void test("OPT-10 全景面板 - 非法 tab 拒绝、resize 非有限值拒绝、隐藏停轮询回前台恢复", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });

  const msgListeners: Array<(msg: any) => any> = [];
  const stateListeners: Array<(e?: any) => any> = [];
  const disposeListeners: Array<() => any> = [];
  const posted: Array<{ type?: string; data?: any }> = [];
  const panel = {
    visible: true,
    webview: {
      html: "",
      cspSource: "vscode-webview://test",
      onDidReceiveMessage(listener: any) {
        msgListeners.push(listener);
        return { dispose() {} };
      },
      async postMessage(msg: any) {
        posted.push(msg);
        return true;
      },
      asWebviewUri(uri: unknown) { return uri; },
    },
    reveal() {},
    onDidChangeViewState(listener: any) {
      stateListeners.push(listener);
      return { dispose() {} };
    },
    onDidDispose(listener: any) {
      disposeListeners.push(listener);
      return { dispose() {} };
    },
    dispose() {
      for (const l of disposeListeners) l();
    },
  };

  const originalPanel = vscode.window.createWebviewPanel;
  (vscode.window as any).createWebviewPanel = () => panel;
  setCustomHttpExecutor(ashareExecutor([makeSector("BK0", "板块A", 1e8)]));

  const { MarketPanoramaWebviewPanel } = await import("../src/ui/panoramaWebview.ts");
  const fire = async (msg: unknown) => {
    for (const l of msgListeners) await l(msg);
    await flush();
  };
  const fireState = async () => {
    for (const l of stateListeners) await l({ webviewPanel: panel });
    await flush();
  };

  try {
    MarketPanoramaWebviewPanel.createOrShow(vscode.Uri.file("/mock/extension"));
    await fire({ command: "ready" });
    assert.ok(posted.some((m) => m.type === "ashare"), "ready 后必须推送 A 股数据");

    // 非法 tab 被白名单拒绝，活动页保持 ashare
    await fire({ command: "switchTab", tab: "__proto__" });
    await fire({ command: "refresh" });
    assert.strictEqual(posted[posted.length - 1]!.type, "ashare", "非法 tab 不得改变活动页");

    // resize 非有限值被拒绝，Treemap 几何保持有限
    await fire({ command: "resize", width: Number.POSITIVE_INFINITY });
    const last = posted[posted.length - 1]!;
    assert.strictEqual(last.type, "ashare");
    for (const rect of last.data.sectors) {
      assert.ok(Number.isFinite(rect.x) && Number.isFinite(rect.w), "Infinity 宽度不得进入布局计算");
    }

    // 隐藏面板：轮询停止
    panel.visible = false;
    await fireState();
    const beforeHidden = posted.length;
    t.mock.timers.tick(40_000);
    await flush();
    assert.strictEqual(posted.length, beforeHidden, "面板隐藏期间不得继续轮询");

    // 回到前台：立即刷新一次并恢复轮询
    panel.visible = true;
    await fireState();
    assert.strictEqual(posted.length, beforeHidden + 1, "回前台必须立即刷新一次");
    t.mock.timers.tick(20_000);
    await flush();
    assert.strictEqual(posted.length, beforeHidden + 2, "回前台后轮询必须恢复");
  } finally {
    MarketPanoramaWebviewPanel.currentPanel?.dispose();
    (vscode.window as any).createWebviewPanel = originalPanel;
    setCustomHttpExecutor(undefined);
  }
});

// ── OPT-10：备份导入规模上限 ───────────────────────────────────────

void test("OPT-10 validateBackupData - 分组/标的/预警超上限拒绝，正常备份不受影响", () => {
  const manyGroups = Object.fromEntries(
    Array.from({ length: MAX_BACKUP_GROUPS + 1 }, (_, i) => [`组${i}`, []])
  );
  const groupRes = validateBackupData({ watchlist: manyGroups });
  assert.strictEqual(groupRes.valid, false);
  assert.ok(groupRes.error?.includes("上限"));

  const manySymbols = {
    "A股": Array.from({ length: MAX_BACKUP_SYMBOLS + 1 }, (_, i) => `sh${600000 + i}`),
  };
  const symRes = validateBackupData({ watchlist: manySymbols });
  assert.strictEqual(symRes.valid, false);
  assert.ok(symRes.error?.includes("上限"));

  const manyAlerts = Object.fromEntries(
    Array.from({ length: MAX_BACKUP_ALERTS + 1 }, (_, i) => [
      `a${i}`,
      { symbol: "sh600519", above: 10, enabled: true },
    ])
  );
  const alertRes = validateBackupData({ alerts: manyAlerts });
  assert.strictEqual(alertRes.valid, false);
  assert.ok(alertRes.error?.includes("上限"));

  const normal = validateBackupData({
    watchlist: { "A股": ["sh600519"] },
    alerts: { sh600519: { symbol: "sh600519", above: 1900, enabled: true } },
  });
  assert.strictEqual(normal.valid, true, "正常规模备份不得被误伤");
});

void test("OPT-10 importSettingsFromFile - 超过文件大小上限直接拒绝，不进入 JSON 解析", async () => {
  const originalOpen = vscode.window.showOpenDialog;
  const originalRead = vscode.workspace.fs.readFile;
  const originalError = vscode.window.showErrorMessage;
  const errors: string[] = [];
  (vscode.window as any).showOpenDialog = async () => [vscode.Uri.file("/mock/huge.json")];
  (vscode.workspace.fs as any).readFile = async () => new Uint8Array(MAX_BACKUP_FILE_BYTES + 1);
  (vscode.window as any).showErrorMessage = (msg: string) => {
    errors.push(msg);
    return Promise.resolve(undefined);
  };
  setMaskSnapshotSource(() => ({ bossKeyActive: false, maskMode: false }));
  try {
    assert.strictEqual(await importSettingsFromFile({}), false);
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0]!.includes("过大"), "必须明确提示文件过大");
  } finally {
    (vscode.window as any).showOpenDialog = originalOpen;
    (vscode.workspace.fs as any).readFile = originalRead;
    (vscode.window as any).showErrorMessage = originalError;
    setMaskSnapshotSource(() => ({ bossKeyActive: false, maskMode: false }));
  }
});

// ── OPT-10：其余健壮性小项源码契约 ─────────────────────────────────

void test("OPT-10 汇率 TTL 时钟回拨不节流 / 落盘失败兜底（源码契约）", () => {
  const scheduler = read("src/scheduler.ts");
  assert.ok(
    scheduler.includes("if (elapsed >= 0 && elapsed < this.FX_REFRESH_TTL_MS) return;"),
    "时钟回拨（elapsed < 0）时不得继续节流，否则汇率停摆直到时钟追回回拨量"
  );

  const commands = read("src/commands/index.ts");
  assert.ok(
    commands.includes("[toggleMask] maskMode 落盘失败，内存侧仍按决议同步"),
    "toggleMask 落盘失败不得阻断内存侧脱敏同步"
  );
  assert.ok(commands.includes("切换颜色脱敏失败"), "toggleColorNeutral 落盘失败必须向用户回显");

  const ops = read("src/watchlistOps.ts");
  assert.ok(ops.includes("清除预警失败"), "setAlert 清除分支持久化失败必须回显");
  assert.ok(ops.includes("切换状态栏轮播失败"), "toggleStatusBarItem 持久化失败必须回显");
  assert.ok(ops.includes("设置别名失败"), "setAlias 持久化失败必须回显");
});