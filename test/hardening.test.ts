// test/hardening.test.ts
// 2026-11-13 第二轮全仓深度排查（P1×4 + P2×9）的回归闸门。
// 每条测试对应一个已修复的确凿缺陷，禁止只做「源码里有没有某字符串」的空心断言：
// 能直接跑纯函数 / 行为的一律跑真实路径，只有跨模块接线才退化为源码契约。
import assert from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as vscode from "vscode";

import {
  coerceConfigValue,
  NUMERIC_CONFIG_RANGES,
  ENUM_CONFIG_VALUES,
  BOOLEAN_CONFIG_KEYS,
  ALLOWED_CONFIG_KEYS,
} from "../src/ui/settingsWebview.ts";
import { readConfig } from "../src/utils/config.ts";
import { exportSettingsToFile, importSettingsFromFile, validateBackupData } from "../src/utils/backupHelper.ts";
import { setMaskSnapshotSource } from "../src/utils/feedback.ts";
import {
  shouldSkipMarketPolling,
  isHolidayCalendarReliable,
  MAX_COVERED_HOLIDAY_YEAR,
} from "../src/utils/marketHours.ts";
import { extractHoldingQuotes } from "../src/utils/symbolHelper.ts";
import { computePortfolioSummary } from "../src/utils/portfolio.ts";
import { scrubUrlsForLog, logger } from "../src/utils/logger.ts";
import { StatusBar } from "../src/ui/statusBar.ts";
import {
  showPortfolioHud,
  closePortfolioHud,
  isPortfolioHudVisible,
  setPortfolioHudContentProvider,
  refreshPortfolioHudIfVisible,
} from "../src/ui/portfolioHud.ts";
import type { MarketItem, WatchlistConfig } from "../src/types/index.ts";
import type { HoldingItemQuote } from "../src/utils/symbolHelper.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const readJson = (rel: string): Record<string, any> =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8").replace(/^\uFEFF/, ""));

const holding = (overrides: Partial<HoldingItemQuote> = {}): HoldingItemQuote => ({
  name: "贵州茅台",
  symbol: "sh600519",
  currency: "CNY",
  cost: 1600,
  shares: 10,
  price: 1650,
  changePercent: 1.5,
  ...overrides,
});

// ── P1-3：Webview 配置写入消毒 ──────────────────────────────────────

void test("P1-3 coerceConfigValue - 数值/枚举/布尔/代理地址四类消毒与白名单拦截", () => {
  assert.deepStrictEqual(coerceConfigValue("refreshInterval", 5000), { ok: true, value: 5000 });
  assert.deepStrictEqual(coerceConfigValue("refreshInterval", 1), { ok: true, value: 1000 }, "下界收敛");
  assert.deepStrictEqual(coerceConfigValue("refreshInterval", 1e9), { ok: true, value: 300000 }, "上界收敛");
  assert.deepStrictEqual(coerceConfigValue("refreshInterval", "abc"), { ok: false }, "字符串不得写入数值键");
  assert.deepStrictEqual(coerceConfigValue("refreshInterval", Number.NaN), { ok: false });
  assert.deepStrictEqual(coerceConfigValue("refreshInterval", Infinity), { ok: false });

  assert.deepStrictEqual(coerceConfigValue("colorScheme", "redUpGreenDown"), { ok: true, value: "redUpGreenDown" });
  assert.deepStrictEqual(coerceConfigValue("colorScheme", "__proto__"), { ok: false });
  assert.deepStrictEqual(coerceConfigValue("aShare.networkMode", "proxy"), { ok: true, value: "proxy" });
  assert.deepStrictEqual(coerceConfigValue("aShare.networkMode", "socks5"), { ok: false });

  assert.deepStrictEqual(coerceConfigValue("autoRefresh", false), { ok: true, value: false });
  assert.deepStrictEqual(coerceConfigValue("autoRefresh", "false"), { ok: false }, "字符串 false 会 truthy 关不掉自动刷新");
  assert.deepStrictEqual(coerceConfigValue("proxyUrl", "http://127.0.0.1:7890"), { ok: true, value: "http://127.0.0.1:7890" });
  assert.deepStrictEqual(coerceConfigValue("proxyUrl", 7890), { ok: false });
  assert.deepStrictEqual(coerceConfigValue("alerts", {}), { ok: false }, "alerts 不在白名单，只能走增量回写");
  assert.deepStrictEqual(coerceConfigValue("__proto__.polluted", true), { ok: false });
});

void test("P1-3 消毒范围表与 package.json 元数据一致，且白名单每个键都有分类", () => {
  const props = readJson("package.json").contributes.configuration.properties as Record<string, any>;
  for (const [key, [min, max]] of Object.entries(NUMERIC_CONFIG_RANGES)) {
    const meta = props[`marketlens.${key}`];
    assert.ok(meta, `清单缺少 marketlens.${key}`);
    assert.strictEqual(min, meta.minimum, `${key} 下界与清单漂移`);
    assert.strictEqual(max, meta.maximum, `${key} 上界与清单漂移`);
  }
  for (const [key, values] of Object.entries(ENUM_CONFIG_VALUES)) {
    const meta = props[`marketlens.${key}`];
    assert.ok(meta, `清单缺少 marketlens.${key}`);
    assert.deepStrictEqual([...values], meta.enum, `${key} 枚举与清单漂移`);
  }
  // 分类完备性：新增白名单键若忘记归类，coerceConfigValue 会保守拒绝 → 前端控件静默失效。
  for (const key of ALLOWED_CONFIG_KEYS) {
    let sample: unknown = true;
    if (NUMERIC_CONFIG_RANGES[key]) sample = NUMERIC_CONFIG_RANGES[key][0];
    else if (ENUM_CONFIG_VALUES[key]) sample = ENUM_CONFIG_VALUES[key][0];
    else if (key.endsWith(".networkMode")) sample = "direct";
    else if (key === "proxyUrl" || key.endsWith(".proxyUrl")) sample = "http://127.0.0.1:7890";
    else assert.ok(BOOLEAN_CONFIG_KEYS.has(key), `布尔键分类表漏了 ${key}`);
    assert.strictEqual(coerceConfigValue(key, sample).ok, true, `白名单键 ${key} 缺少消毒分类`);
  }
});

void test("P1-3 updateSetting - 内存镜像与磁盘写入消费同一份已消毒值（源码契约）", () => {
  const src = read("src/ui/settingsWebview.ts");
  assert.ok(src.includes("const coerced = coerceConfigValue(message.key, message.value)"));
  assert.ok(src.includes("onDidUpdateSetting?.(message.key, value)"), "内存侧不得再用未消毒的 message.value");
  assert.ok(!/cfg\.update\(message\.key, message\.value/.test(src), "磁盘侧不得再直写原始 message.value");
});

// ── P1-1：备份导出的脱敏守卫 ────────────────────────────────────────

void test("P1-1 简洁展示模式（maskMode 而非老板键）下导出/导入备份均静默拒绝", async () => {
  const originalSave = vscode.window.showSaveDialog;
  const originalOpen = vscode.window.showOpenDialog;
  const calls: string[] = [];
  (vscode.window as any).showSaveDialog = async () => {
    calls.push("save");
    return vscode.Uri.file("/mock/backup.json");
  };
  (vscode.window as any).showOpenDialog = async () => {
    calls.push("open");
    return [vscode.Uri.file("/mock/backup.json")];
  };
  try {
    setMaskSnapshotSource(() => ({ bossKeyActive: false, maskMode: true }));
    assert.strictEqual(await exportSettingsToFile(readConfig()), false);
    assert.strictEqual(await importSettingsFromFile({}), false);
    assert.strictEqual(calls.length, 0, "简洁展示模式下不得弹出系统对话框或回显明文备份内容");
  } finally {
    setMaskSnapshotSource(() => ({ bossKeyActive: false, maskMode: false }));
    (vscode.window as any).showSaveDialog = originalSave;
    (vscode.window as any).showOpenDialog = originalOpen;
  }
});

void test("P1-1 备份守卫与 showLogs / 总账浮窗共用 isMasked() 谓词（源码契约）", () => {
  const src = read("src/utils/backupHelper.ts");
  assert.ok(!src.includes("isBossKeyActive"), "不得退回只判老板键的旧谓词");
  assert.strictEqual((src.match(/if \(isMasked\(\)\)/g) || []).length, 2, "导出与导入两处都要有守卫");
});

// ── P2-6：备份预警归一化 ───────────────────────────────────────────

void test("P2-6 validateBackupData - 非有限、非正阈值与危险键统一由 sanitizeAlerts 剔除", () => {
  const result = validateBackupData({
    watchlist: { "A股": ["sh600519"] },
    alerts: {
      good: { symbol: "sh600519", above: 1900, enabled: true },
      // 真实导入路径里 JSON 文本 "1e999" 会被 JSON.parse 解析成 Infinity
      infinity: { symbol: "sh600519", above: Number.POSITIVE_INFINITY },
      negative: { symbol: "sh600519", below: -10 },
      zero: { symbol: "sh600519", above: 0 },
      noThreshold: { symbol: "sh600519" },
      "__proto__": { symbol: "sh600519", above: 100 },
      constructor: { symbol: "sh600519", above: 100 },
    },
  });
  assert.strictEqual(result.valid, true);
  const alerts = result.data?.settings.alerts ?? {};
  assert.ok(alerts.good, "合法规则必须保留");
  assert.strictEqual(alerts.good?.above, 1900);
  assert.strictEqual(alerts.infinity, undefined, "1e999 经 JSON 变 Infinity，必须剔除");
  assert.strictEqual(alerts.negative, undefined);
  assert.strictEqual(alerts.zero, undefined);
  assert.strictEqual(alerts.noThreshold, undefined, "无有效阈值的规则不得写回");
  // 不能直接取 alerts["__proto__"]：普通对象沿原型链会读到 Object.prototype，
  // 必须判自有属性，才能真正验证「危险键没被写进备份数据」。
  assert.strictEqual(Object.prototype.hasOwnProperty.call(alerts, "__proto__"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(alerts, "constructor"), false);
  assert.strictEqual(result.summary?.alertCount, 1);
});

// ── P1-4：发布排除 ─────────────────────────────────────────────────

void test("P1-4 .vscodeignore - 内部设计稿、截图与记忆目录不得进入 VSIX", () => {
  const ignore = read(".vscodeignore");
  for (const pattern of [".trae/**", ".screenshots/**", ".workbuddy/**", ".workbuddy-ai/**", "docs/**", "test/**"]) {
    assert.ok(ignore.includes(pattern), `缺少排除规则 ${pattern}`);
  }
  // 没有 files 白名单时，.vscodeignore 是唯一防线；契约测试保护这个前提。
  assert.strictEqual(readJson("package.json").files, undefined);
});

// ── P2-5：节假日日历护栏 ───────────────────────────────────────────

void test("P2-5 日历越界时保守禁用「闭市停止轮询」，不得把法定假日误判为交易日", () => {
  const base = {
    stopOnMarketClosed: true,
    isMarketOpen: false,
    hasLoadedInitialQuotes: true,
    forceAll: false,
  };
  assert.strictEqual(shouldSkipMarketPolling({ ...base, holidayCalendarReliable: false }), false);
  assert.strictEqual(shouldSkipMarketPolling({ ...base, holidayCalendarReliable: true }), true);
  assert.strictEqual(shouldSkipMarketPolling(base), true, "当前日期在覆盖范围内，默认自算应放行");
  assert.strictEqual(
    shouldSkipMarketPolling({ ...base, holidayCalendarReliable: false, forceAll: true }),
    false
  );

  const beyond = new Date(Date.UTC(MAX_COVERED_HOLIDAY_YEAR + 1, 5, 15, 4, 0, 0));
  assert.strictEqual(isHolidayCalendarReliable(beyond), false, "超出日历上限必须判不可靠");
  assert.strictEqual(
    shouldSkipMarketPolling({ ...base, holidayCalendarReliable: isHolidayCalendarReliable(beyond) }),
    false
  );
});

void test("P2-5 extractTargets - 每轮只算一次日历可靠性并透传四个板块（源码契约）", () => {
  const src = read("src/scheduler.ts");
  assert.ok(src.includes("isHolidayCalendarReliable"));
  assert.strictEqual(
    (src.match(/holidayCalendarReliable,/g) || []).length,
    4,
    "港股/美股/基金/A股四处调用都必须显式透传"
  );
});

// ── P2-1：行情报价消毒 ─────────────────────────────────────────────

void test("P2-1 extractHoldingQuotes - NaN/Infinity/负报价不得进入总账计算", () => {
  const watchlist: WatchlistConfig = {
    "A股": [
      { symbol: "sh600000", type: "A_SHARE", cost: 9, shares: 100 },
      { symbol: "sh600519", type: "A_SHARE", cost: 1600, shares: 10 },
      { symbol: "sz000001", type: "A_SHARE", cost: 10, shares: 100 },
      { symbol: "sz000002", type: "A_SHARE", cost: 10, shares: 100 },
      { symbol: "sh601318", type: "A_SHARE", cost: 40, shares: 100 },
    ],
  };
  const quoteCache = new Map<string, MarketItem>();
  const put = (symbol: string, price: number) =>
    quoteCache.set(symbol, {
      id: symbol, name: symbol, symbol, type: "A_SHARE",
      price, changePercent: 0, change: 0, prevClose: price,
    });
  put("sh600000", 10);
  put("sh600519", NaN);
  put("sz000001", Infinity);
  put("sz000002", -1);
  put("sh601318", -Infinity);

  const quotes = extractHoldingQuotes(watchlist, quoteCache, {
    statusBarEnabled: true,
    now: new Date("2026-11-11T10:00:00+08:00"),
    aShare: { enabled: true, statusBar: true },
  });
  assert.strictEqual(quotes.length, 1, "只保留唯一有效报价");
  assert.strictEqual(quotes[0].symbol, "sh600000");
  const summary = computePortfolioSummary(quotes, "CNY");
  assert.ok(Number.isFinite(summary.total.marketVal));
  assert.ok(Number.isFinite(summary.total.totalProfit));
});

// ── P1-2 / P2-3 / P2-9：状态栏持仓条 ───────────────────────────────

void test("P1-2 状态栏轮播子集为空但全量总账非空时，第 0 帧仍必须展示总账", () => {
  const bar = new StatusBar({ maskMode: false, colorNeutral: false, colorScheme: "greenUpRedDown" });
  try {
    bar.setHoldings([], true, 3);
    const item = (bar as any).holdingBarItem;
    assert.strictEqual(item.text, "", "尚未推送总账时应保持隐藏（不回归既有行为）");

    bar.setPortfolioSummary(computePortfolioSummary([holding()], "CNY"));
    assert.ok(item.text.includes("总资产"), `第 0 帧不得被 holdings.length===0 早退吞掉: ${item.text}`);
    assert.ok(item.text.includes("今日"), "第 0 帧仍应带今日盈亏金额");
    assert.strictEqual(bar.isHoldingCarouselRunning(), false, "只有一帧时不启动轮播定时器");
  } finally {
    bar.dispose();
  }
});

void test("P2-3 同间隔重复 setHoldings 不重建轮播定时器，间隔变化才重建", () => {
  const bar = new StatusBar({ maskMode: false, colorNeutral: false, colorScheme: "greenUpRedDown" });
  try {
    bar.setHoldings([holding()], true, 3);
    const first = (bar as any).holdingTimer;
    assert.ok(first !== undefined);
    bar.setHoldings([holding()], true, 3);
    assert.strictEqual((bar as any).holdingTimer, first, "每轮刷新都重建会让计时基准永远归零");
    bar.setHoldings([holding()], true, 5);
    assert.notStrictEqual((bar as any).holdingTimer, first, "用户调整间隔必须重建生效");
    assert.strictEqual((bar as any).holdingTimerInterval, 5);
  } finally {
    bar.dispose();
  }
});

void test("P2-9 Tooltip 明确标注总账全量口径与轮播子集口径可能不一致（源码契约）", () => {
  const src = read("src/ui/statusBar.ts");
  assert.ok(src.includes("口径说明：上方总账为**全量持仓**"));
  assert.ok(src.includes("状态栏轮播口径"));
});

// ── P2-7：日志 message 通道 ────────────────────────────────────────

void test("P2-7 logger.emit - message 通道清洗 URL，且保留方法名可读性", () => {
  const url = "https://hq.sinajs.cn/list=fx_susdcny?q=sh600519,sz000001";
  const scrubbed = scrubUrlsForLog(`请求失败 ${url}`);
  assert.ok(!scrubbed.includes("sh600519"), "URL 查询串里的整批自选代码不得明文进日志");
  assert.ok(!scrubbed.includes("hq.sinajs.cn"));
  assert.ok(scrubUrlsForLog("showPortfolioSummary failed").includes("showPortfolioSummary"),
    "只清 URL 不做长词哈希，避免毁掉日志可读性");

  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    logger.warn(`[probe] 网关失败 ${url}`);
  } finally {
    console.log = original;
  }
  assert.ok(lines.length > 0);
  assert.ok(!lines[0].includes("sh600519"), "dev console 通道同样不得出现明文 URL");

  const src = read("src/utils/logger.ts");
  assert.ok(src.includes("const safeMessage = scrubUrlsForLog(message)"));
  assert.ok(src.includes("`[MarketLens] ${safeMessage}`"), "OutputChannel 与 console 必须共用同一份已清洗文本");
});

void test("P2-7 外部错误文本不得裸插 message 模板（源码契约）", () => {
  const network = read("src/services/network.ts");
  assert.strictEqual(
    (network.match(/scrubForLog\(String\(\(err as Error\)\?\.message \|\| err\)\)/g) || []).length,
    1
  );
  assert.ok(network.includes("scrubForLog(String((gatewayErr as Error)?.message || gatewayErr))"));
  const search = read("src/services/symbolSearchService.ts");
  assert.ok(!search.includes('query "${trimmed}"'), "用户搜索词不得原样进 OutputChannel");
  assert.ok(search.includes("describeForLog(trimmed)"));
});

// ── P2-8：HUD 汇率到位后原地刷新 ───────────────────────────────────

void test("P2-8 已打开的 HUD 在在线汇率到位后原地刷新，未打开时不得反向取数", () => {
  const originalFactory = vscode.window.createQuickPick;
  let captured: any;
  (vscode.window as any).createQuickPick = () => {
    captured = (originalFactory as any)();
    return captured;
  };
  let providerCalls = 0;
  try {
    refreshPortfolioHudIfVisible();
    assert.strictEqual(providerCalls, 0, "HUD 未打开时不得触发任何取数");

    showPortfolioHud([{ label: "静态兜底牌价" }]);
    assert.strictEqual(isPortfolioHudVisible(), true);
    setPortfolioHudContentProvider(() => {
      providerCalls += 1;
      return [{ label: "在线牌价 v2" }];
    });

    refreshPortfolioHudIfVisible();
    assert.strictEqual(providerCalls, 1);
    assert.strictEqual(captured.items[0].label, "在线牌价 v2", "应原地写 items 而非重建窗口");
    assert.strictEqual(isPortfolioHudVisible(), true, "原地刷新不得触发 onDidHide 回收");

    closePortfolioHud();
    refreshPortfolioHudIfVisible();
    assert.strictEqual(providerCalls, 1, "HUD 关闭后不得再取数（脱敏路径尤其重要）");
  } finally {
    setPortfolioHudContentProvider(undefined);
    closePortfolioHud();
    (vscode.window as any).createQuickPick = originalFactory;
  }
});

void test("P2-8 汇率成功回调与命令打开共用同一 HUD 内容构造器（源码契约）", () => {
  const scheduler = read("src/scheduler.ts");
  assert.ok(scheduler.includes("refreshPortfolioHudIfVisible()"), "汇率到位后必须刷新 HUD");
  assert.ok(
    scheduler.indexOf("setLiveFxRates(rates)") < scheduler.indexOf("refreshPortfolioHudIfVisible()"),
    "必须先让新汇率生效再重建内容"
  );
  const commands = read("src/commands/index.ts");
  assert.strictEqual(
    (commands.match(/const buildPortfolioHudItems/g) || []).length,
    1,
    "HUD 内容构造器只能有一份，禁止两处各自拼装"
  );
  assert.ok(commands.includes("setPortfolioHudContentProvider("));
  assert.ok(commands.includes("showPortfolioHud(buildPortfolioHudItems("));
});

// ── P2-4：打新手动入口 ─────────────────────────────────────────────

void test("P2-4 手动「今日打新」使用独立在途锁，且判定早于自动锁（源码契约）", () => {
  const src = read("src/services/ipoService.ts");
  assert.ok(src.includes("_manualInFlightCheck"));
  assert.ok(
    src.indexOf("if (manual) {") < src.indexOf("if (_inFlightCheck) {"),
    "手动分支必须先于自动检查的单例锁，否则用户点击会被在途自动任务吞掉"
  );
  assert.ok(src.includes("finally {\n      _manualInFlightCheck = null;"), "手动锁必须在 finally 释放");
});

// ── P2-11：CI 版本一致性 ───────────────────────────────────────────

void test("P2-11 CI 在打包前执行 sync-version:check，拦截版本/文档漂移", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.ok(ci.includes("npm run sync-version:check"));
  assert.ok(
    ci.indexOf("npm run sync-version:check") < ci.indexOf("npm run package"),
    "必须在 prepackage 静默改写 CHANGELOG 之前拦截"
  );
});

// ── 设置面板与调度器恢复契约 ───────────────────────────────────────

void test("autoRefresh 开关单一启动入口：禁用即时 stop，启用由 flushConfigChange 统一 start（源码契约）", () => {
  const ext = read("src/extension.ts");
  assert.ok(
    ext.includes("if (!config.autoRefresh) {\n        scheduler.stop();\n      }"),
    "autoRefresh 关闭时 Webview 即时路径必须立刻 stop()"
  );
  assert.ok(
    !ext.includes("} else {\n        scheduler.start();\n      }"),
    "启用时不得在 Webview 即时路径再 start()：落盘后的 flushConfigChange 会统一 start，两处都 start 会连发两次全量强制刷新"
  );
  assert.ok(
    ext.includes("if (hadNetworkChange || watchlistContentChanged) {"),
    "flushConfigChange 必须保留网络相关变更的统一重启分支"
  );
  const cfg = read("src/utils/config.ts");
  assert.ok(
    cfg.includes('e.affectsConfiguration("marketlens.autoRefresh")'),
    "autoRefresh 必须属于 affectsNetworkConfig，否则启用后 flushConfigChange 不会重启调度器"
  );
});

void test("SettingsWebview 与 HTML 模版包含 statusBarCompact 紧凑模式开关（源码契约）", () => {
  const webview = read("src/ui/settingsWebview.ts");
  assert.ok(webview.includes("statusBarCompact:         config.statusBar.compact ?? false,"), "Webview 数据包必须下发 statusBarCompact");

  const html = read("src/ui/settingsHtml.ts");
  assert.ok(html.includes('id="statusBarCompact"'), "HTML 模版必须包含 statusBarCompact 复选框");
  assert.ok(html.includes("sendUpdate('statusBar.compact', this.checked)"), "必须监听并分发 statusBar.compact");
});
