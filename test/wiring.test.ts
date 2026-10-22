// test/wiring.test.ts
import assert from "node:assert";
import test from "node:test";
import * as vscode from "vscode";

import {
  readConfig,
  persistProxyToAllSections,
  persistStatusBarToAllSections,
  persistSectionStatusBarAndRecompute,
  applyStatusBarToAllSections,
  applyProxyToAllSections,
  recomputeStatusBarEnabled,
  affectsNetworkConfig
} from "../src/utils/config.ts";
import { importSettingsFromFile, exportSettingsToFile } from "../src/utils/backupHelper.ts";
import { WatchlistProvider, GroupItem, StockItem } from "../src/ui/watchlistProvider.ts";
import { WatchlistOps } from "../src/watchlistOps.ts";
import { setMaskSnapshotSource } from "../src/utils/feedback.ts";
import { MASKED_TOOLTIP_TEXT } from "../src/utils/maskState.ts";
import { applyAlertRuleDelta, sanitizeAlerts } from "../src/utils/symbolHelper.ts";
import type { MarketItem } from "../src/types/index.ts";

void test("config - readConfig 端到端读取与默认值回退", async () => {
  (vscode as any).__resetMock();

  // 1. 无任何设置时读取默认值
  const cfg1 = readConfig();
  assert.strictEqual(cfg1.autoRefresh, true);
  assert.strictEqual(cfg1.refreshInterval, 5000);
  assert.strictEqual(cfg1.maskMode, false);
  assert.strictEqual(cfg1.colorNeutral, false);
  assert.strictEqual(cfg1.colorScheme, "greenUpRedDown");
  assert.strictEqual(cfg1.fund.networkMode, "direct");
  assert.strictEqual(cfg1.binance.networkMode, "proxy");

  // 2. 写入自定义配置后重新读取
  const vcfg = vscode.workspace.getConfiguration("marketlens");
  await vcfg.update("proxyPort", 7890, vscode.ConfigurationTarget.Global);
  await vcfg.update("proxyUrl", "http://127.0.0.1:7890", vscode.ConfigurationTarget.Global);
  await vcfg.update("maskMode", true, vscode.ConfigurationTarget.Global);
  await vcfg.update("watchlist", { "自选": [{ symbol: "sh600519", type: "A_SHARE" }] }, vscode.ConfigurationTarget.Global);

  const cfg2 = readConfig();
  assert.strictEqual(cfg2.proxyPort, 7890);
  assert.strictEqual(cfg2.proxyUrl, "http://127.0.0.1:7890");
  assert.strictEqual(cfg2.maskMode, true);
  assert.strictEqual(cfg2.watchlist["自选"]?.[0]?.symbol, "sh600519");
});

void test("config - persistProxyToAllSections 与 persistStatusBarToAllSections 批量写盘", async () => {
  (vscode as any).__resetMock();
  const vcfg = vscode.workspace.getConfiguration("marketlens");

  await persistProxyToAllSections(vcfg, "http://127.0.0.1:8888", 8888);
  let cfg = readConfig();
  assert.strictEqual(cfg.proxyPort, 8888);
  assert.strictEqual(cfg.proxyUrl, "http://127.0.0.1:8888");
  assert.strictEqual(cfg.fund.proxyUrl, "http://127.0.0.1:8888");
  assert.strictEqual(cfg.binance.proxyUrl, "http://127.0.0.1:8888");

  await persistStatusBarToAllSections(vcfg, false);
  cfg = readConfig();
  assert.strictEqual(cfg.statusBar.enabled, false);
  assert.strictEqual(cfg.fund.statusBar, false);
  assert.strictEqual(cfg.aShare.statusBar, false);

  await persistSectionStatusBarAndRecompute(vcfg, "fund.statusBar", true);
  cfg = readConfig();
  assert.strictEqual(cfg.fund.statusBar, true);
  assert.strictEqual(cfg.statusBar.enabled, true);

  // 内存配置同步函数覆盖
  applyStatusBarToAllSections(cfg, true);
  assert.strictEqual(cfg.statusBar.enabled, true);
  assert.strictEqual(cfg.fund.statusBar, true);

  applyProxyToAllSections(cfg, "http://127.0.0.1:9090", 9090);
  assert.strictEqual(cfg.proxyPort, 9090);
  assert.strictEqual(cfg.binance.proxyUrl, "http://127.0.0.1:9090");

  const recomputed = recomputeStatusBarEnabled(cfg);
  assert.strictEqual(recomputed, true);

  // 判定网络配置是否影响
  const affects1 = affectsNetworkConfig({ affectsConfiguration: (sec) => sec.includes("proxyPort") });
  assert.strictEqual(affects1, true);
  const affects2 = affectsNetworkConfig({ affectsConfiguration: (sec) => sec.includes("fund.networkMode") });
  assert.strictEqual(affects2, true);
  const affects3 = affectsNetworkConfig({ affectsConfiguration: () => false });
  assert.strictEqual(affects3, false);
});

void test("backupHelper - exportSettingsToFile 与 importSettingsFromFile 全流程", async () => {
  (vscode as any).__resetMock();

  const mockConfig = readConfig();
  mockConfig.proxyPort = 9999;
  mockConfig.proxyUrl = "http://127.0.0.1:9999";
  mockConfig.watchlist = {
    "A股": [{ symbol: "sh600519", type: "A_SHARE", name: "贵州茅台" }]
  };
  mockConfig.alerts = {
    "sh600519": { symbol: "sh600519", above: 2000, enabled: true }
  };

  // 1. 导出测试
  const exportSuccess = await exportSettingsToFile(mockConfig);
  assert.strictEqual(exportSuccess, true);

  // 2. 导入测试（使用导出的备份文件）
  let callbackCalled = false;
  const importSuccess = await importSettingsFromFile({
    onSuccess: async (backupData) => {
      callbackCalled = true;
      assert.strictEqual(backupData.settings.proxyPort, 9999);
      assert.strictEqual(backupData.settings.proxyUrl, "http://127.0.0.1:9999");
    }
  });

  assert.strictEqual(importSuccess, true);
  assert.strictEqual(callbackCalled, true);

  // 3. 验证配置落盘
  const reloadedCfg = readConfig();
  assert.strictEqual(reloadedCfg.proxyPort, 9999);
  assert.strictEqual(reloadedCfg.proxyUrl, "http://127.0.0.1:9999");
  assert.strictEqual(reloadedCfg.watchlist["A股"]?.[0]?.symbol, "sh600519");
  assert.strictEqual(reloadedCfg.alerts["sh600519"]?.above, 2000);
});

void test("WatchlistProvider - 树节点构建、空组过滤与脏数据防御", async () => {
  const provider = new WatchlistProvider(false, false, "greenUpRedDown");
  const quoteMap = new Map<string, MarketItem>();
  quoteMap.set("sh600519", {
    id: "sh600519",
    symbol: "sh600519",
    name: "贵州茅台",
    type: "A_SHARE",
    price: 1800,
    changePercent: 2.5,
  });

  // 注入包含正常与脏数据的 watchlist
  provider.buildTree(
    {
      "A股": [
        null as any,
        { symbol: "sh600519", type: "A_SHARE", name: "贵州茅台" },
      ],
      "空组": [],
    },
    quoteMap,
    { aShare: true, fund: true, hkStock: true, usStock: true, binance: true, alpha: true }
  );

  const groups = await provider.getChildren();
  assert.ok(groups && groups.length >= 1);
  const aGroup = groups!.find((g) => (g as GroupItem).groupName === "A股") as GroupItem;
  assert.ok(aGroup);

  const children = await provider.getChildren(aGroup);
  assert.strictEqual(children!.length, 1);
  const stockNode = children![0] as StockItem;
  assert.strictEqual(stockNode.confSymbol, "sh600519");

  // 验证 Tooltip 包含 marketlens.copyCode 命令链接与白名单授权
  assert.ok(stockNode.tooltip instanceof vscode.MarkdownString);
  const md = stockNode.tooltip as vscode.MarkdownString;
  assert.ok(md.value.includes("command:marketlens.copyCode"));
  assert.deepStrictEqual((md as any).isTrusted?.enabledCommands, ["marketlens.copyCode"]);
});

void test("WatchlistOps - 基础操作与安全防护", async () => {
  (vscode as any).__resetMock();

  // 写入初始数据
  await vscode.workspace.getConfiguration("marketlens").update(
    "watchlist",
    {
      "A股": [
        { symbol: "sh600519", type: "A_SHARE", name: "茅台" },
        { symbol: "sh601398", type: "A_SHARE", name: "工行" }
      ]
    },
    vscode.ConfigurationTarget.Global
  );

  const dummyCache = new Map<string, MarketItem>();
  dummyCache.set("sh600519", {
    id: "sh600519",
    symbol: "sh600519",
    name: "茅台",
    type: "A_SHARE",
    price: 1800,
    changePercent: 1.5,
  });
  dummyCache.set("sh601398", {
    id: "sh601398",
    symbol: "sh601398",
    name: "工行",
    type: "A_SHARE",
    price: 5.5,
    changePercent: 0.5,
  });

  let treeRebuilt = false;
  let rebuiltWatchlist: any = null;
  const ops = new WatchlistOps({
    quoteCache: dummyCache,
    rebuildTree: (customWatchlist) => {
      treeRebuilt = true;
      rebuiltWatchlist = customWatchlist;
    },
  });

  // 测试批量重排接口：将工行拖动到茅台之前
  await ops.handleBatchReorder(
    [{ sourceGroup: "A股", sourceSymbol: "sh601398" }],
    "A股",
    "sh600519"
  );

  assert.strictEqual(treeRebuilt, true);
  assert.ok(rebuiltWatchlist);
  assert.strictEqual(rebuiltWatchlist["A股"][0].symbol, "sh601398");
  assert.strictEqual(rebuiltWatchlist["A股"][1].symbol, "sh600519");

  // 测试 pinToTop 操作
  const stockItem = new StockItem(
    dummyCache.get("sh600519")!,
    "A股",
    "sh600519",
    false,
    false,
    undefined,
    "茅台",
    "greenUpRedDown"
  );
  await ops.pinToTop(stockItem);
  const cfgAfterPin = readConfig();
  assert.strictEqual(cfgAfterPin.watchlist["A股"]?.[0]?.symbol, "sh600519");

  // 测试 removeItem 操作（包含 active-set pruning 同步清理缓存）
  assert.ok(dummyCache.has("sh600519"));
  await ops.removeItem(stockItem);
  assert.strictEqual(dummyCache.has("sh600519"), false, "删除自选标的必须在同一次调用中同步清理 quoteCache");
  const cfgAfterRemove = readConfig();
  assert.strictEqual(cfgAfterRemove.watchlist["A股"]?.some((it) => it.symbol === "sh600519"), false);
});

void test("StatusBar - 正常渲染、轮播、伪装与老板键模式", async () => {
  const { StatusBar } = await import("../src/ui/statusBar.ts");
  const bar = new StatusBar({
    maskMode: false,
    colorNeutral: false,
    colorScheme: "greenUpRedDown",
  });

  const quotes: MarketItem[] = [
    { id: "sh600519", symbol: "sh600519", name: "茅台", type: "A_SHARE", price: 1800, changePercent: 2.1 },
    { id: "BTCUSDT", symbol: "BTCUSDT", name: "BTC", type: "CRYPTO", price: 65000, changePercent: -1.5 },
  ];

  bar.setQuotes(quotes);
  bar.show();
  assert.strictEqual(bar.isBossKeyActive(), false, "初始化后老板键必须为未激活");

  bar.setMaskMode(true);
  bar.setColorNeutral(true);
  bar.setColorScheme("redUpGreenDown");

  // 老板键激活测试：状态栏隐藏且老板键状态变为 true
  bar.toggleBossKey(true);
  assert.strictEqual(bar.isBossKeyActive(), true, "激活老板键后状态必须为 true");

  // 老板键解除测试：状态栏恢复
  bar.toggleBossKey(false);
  assert.strictEqual(bar.isBossKeyActive(), false, "解除老板键后状态必须为 false");

  // 清空行情测试：状态栏清空隐藏
  bar.setQuotes([]);
  assert.strictEqual(bar.isCarouselRunning(), false, "行情为空时轮播定时器必须停止");

  bar.hide();
  bar.dispose();
  assert.strictEqual(bar.isCarouselRunning(), false, "dispose 后轮播定时器必须停止");
});

void test("SettingsWebviewPanel - 白名单校验与面板生命周期", async () => {
  const { SettingsWebviewPanel, ALLOWED_CONFIG_KEYS } = await import("../src/ui/settingsWebview.ts");
  assert.ok(ALLOWED_CONFIG_KEYS.has("autoRefresh"));
  assert.ok(ALLOWED_CONFIG_KEYS.has("maskMode"));
  assert.ok(ALLOWED_CONFIG_KEYS.has("fund.enabled"));
  assert.ok(ALLOWED_CONFIG_KEYS.has("aShare.networkMode"));
  assert.ok(!ALLOWED_CONFIG_KEYS.has("maliciousKey"));

  // 面板创建与同步
  SettingsWebviewPanel.createOrShow(vscode.Uri.file("/mock/extension"));
  assert.ok(SettingsWebviewPanel.currentPanel);

  SettingsWebviewPanel.syncSettings();
  SettingsWebviewPanel.currentPanel.dispose();
  assert.strictEqual(SettingsWebviewPanel.currentPanel, undefined);
});

void test("RefreshScheduler 与 MarketManager 调度集成测试", async () => {
  const { MarketManager } = await import("../src/services/marketManager.ts");
  const { RefreshScheduler } = await import("../src/scheduler.ts");
  const { StatusBar } = await import("../src/ui/statusBar.ts");

  const marketManager = new MarketManager();
  marketManager.clearInvalidCache();

  const provider = new WatchlistProvider(false, false, "greenUpRedDown");
  const statusBar = new StatusBar({
    maskMode: false,
    colorNeutral: false,
  });

  const mockTreeView: any = {
    onDidChangeVisibility: () => ({ dispose: () => {} }),
    dispose: () => {},
  };

  const scheduler = new RefreshScheduler({
    marketManager,
    treeProvider: provider,
    statusBar,
    treeView: mockTreeView,
  });

  const targets = scheduler.extractTargets(readConfig());

  assert.ok(targets.aShares !== undefined);
  assert.ok(targets.cryptos !== undefined);

  scheduler.stop();
  scheduler.dispose();
  statusBar.dispose();
});

void test("extension 与 commands - 扩展完整生命周期与命令分发集成", async () => {
  (vscode as any).__resetMock();

  const { activate, deactivate } = await import("../src/extension.ts");

  const subscriptions: any[] = [];
  const mockContext: any = {
    subscriptions,
    extensionUri: vscode.Uri.file("/mock/extension"),
    globalState: {
      get: () => undefined,
      update: async () => {},
    },
  };

  // 1. 测试扩展激活
  await activate(mockContext);
  assert.ok(subscriptions.length > 0, "扩展激活必须注册命令与事件侦听器");

  // 2. 测试已注册核心命令派发与防窥守卫
  await vscode.commands.executeCommand("marketlens.toggleMask");
  assert.strictEqual(
    vscode.workspace.getConfiguration("marketlens").get("maskMode"),
    true,
    "toggleMask 执行后 maskMode 必须切换为 true"
  );
  await vscode.commands.executeCommand("marketlens.toggleColorNeutral");
  await vscode.commands.executeCommand("marketlens.openSettings");
  await vscode.commands.executeCommand("marketlens.refresh");
  await vscode.commands.executeCommand("marketlens.refreshGroup");
  await vscode.commands.executeCommand("marketlens.toggleBossKey");
  await vscode.commands.executeCommand("marketlens.toggleBossKey");

  // 3. 测试命令守卫（maskMode 下从命令面板无 node 唤起 addItem / sortGroup 应被拦截）
  await vscode.commands.executeCommand("marketlens.addItem");
  await vscode.commands.executeCommand("marketlens.sortGroup");

  // 4. 测试复制标的代码 / 合约地址命令
  await vscode.commands.executeCommand("marketlens.copyCode", "600519");
  await vscode.commands.executeCommand("marketlens.copyCode", "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c");

  // 5. 测试生命周期注销
  deactivate();
});

// ── AGENTS.md §6.5 / §6.3 / §6.11 / §6.2 回归 ─────────────────────────

/** 构造一个带完整上下文的树节点（confSymbol 与 item.symbol 可分列，用于验证符号身份匹配） */
function makeStockNode(symbol: string, groupName: string, name: string): StockItem {
  const item: MarketItem = {
    id: symbol,
    symbol,
    name,
    type: groupName === "港股" ? "HK_STOCK" : "A_SHARE",
    price: 100,
    changePercent: 1.2,
  };
  return new StockItem(item, groupName, symbol, false, false, undefined, name, "greenUpRedDown");
}

async function seedWatchlist(watchlist: Record<string, unknown>): Promise<void> {
  await vscode.workspace
    .getConfiguration("marketlens")
    .update("watchlist", watchlist, vscode.ConfigurationTarget.Global);
}

void test("P1-6 回归 - 板块开关与条目过滤同源：基金分组不得被 aShare 开关误过滤", async () => {
  const provider = new WatchlistProvider(false, false, "greenUpRedDown");
  const quoteMap = new Map<string, MarketItem>();
  for (const q of [
    { id: "sh510300", symbol: "sh510300", name: "沪深300ETF", type: "A_SHARE", price: 4.1, changePercent: 0.5 },
    { id: "sh600519", symbol: "sh600519", name: "贵州茅台", type: "A_SHARE", price: 1800, changePercent: 1.2 },
  ]) {
    quoteMap.set(q.symbol, q as MarketItem);
  }

  // 关闭 A股板块、保持基金板块启用
  provider.buildTree(
    {
      "基金": [{ symbol: "sh510300", type: "A_SHARE", name: "沪深300ETF" }],
      "A股": [{ symbol: "sh600519", type: "A_SHARE", name: "贵州茅台" }],
    },
    quoteMap,
    { fund: true, aShare: false, hkStock: true, usStock: true, binance: true, alpha: true }
  );

  const groups = await provider.getChildren();
  assert.strictEqual(groups?.length, 1, "A股分组关闭、基金分组启用时只应剩基金分组");
  const fundGroup = groups![0] as GroupItem;
  assert.strictEqual(fundGroup.groupName, "基金");

  const children = await provider.getChildren(fundGroup);
  assert.strictEqual(children?.length, 1, "基金条目被 aShare 开关过滤 = §6.8 两套判定源漂移");

  // 反向：关闭基金板块时分组与条目一起收起，不得出现「组在、条目空」
  provider.buildTree(
    { "基金": [{ symbol: "sh510300", type: "A_SHARE", name: "沪深300ETF" }] },
    quoteMap,
    { fund: false, aShare: true, hkStock: true, usStock: true, binance: true, alpha: true }
  );
  assert.strictEqual((await provider.getChildren())?.length, 0, "关闭基金板块后分组不得残留");
});

void test("P1-7 回归 - 今日盈亏公式单一出口，Tooltip 关闭 HTML 渲染并转义外部报文名称", async () => {
  const { deriveTodayProfit } = await import("../src/utils/symbolHelper.ts");

  // 1. 反推优先级：真实涨跌额 > 今开 > 昨收 > 涨跌幅反推
  assert.strictEqual(deriveTodayProfit({ price: 12, change: 1.5, open: 11, prevClose: 10, changePercent: 20 }, 100), 150);
  assert.strictEqual(deriveTodayProfit({ price: 12, change: NaN, open: 11, prevClose: 10 }, 100), 100);
  assert.strictEqual(deriveTodayProfit({ price: 12, open: 0, prevClose: 10 }, 100), 200);
  assert.strictEqual(deriveTodayProfit({ price: 12, changePercent: 20 }, 100), 200, "由涨跌幅反推昨收：12 / 1.2 = 10");
  assert.strictEqual(deriveTodayProfit({ price: 12 }, 100), 0, "无任何基准字段时不得凭空生成盈亏");

  // 2. 单一实现：侧边栏卡片与状态栏持仓条必须给出同一个今日盈亏数字
  const hostile = "<img src=x onerror=alert(1)>茅台";
  const provider = new WatchlistProvider(false, false, "greenUpRedDown");
  const quoteMap = new Map<string, MarketItem>();
  const quote: MarketItem = {
    id: "sh600519", symbol: "sh600519", name: hostile, type: "A_SHARE",
    price: 12, change: 1.5, changePercent: 14.29,
  };
  quoteMap.set("sh600519", quote);
  provider.buildTree(
    { "A股": [{ symbol: "sh600519", type: "A_SHARE", name: hostile, cost: 10, shares: 100 }] },
    quoteMap,
    { fund: true, aShare: true, hkStock: true, usStock: true, binance: true, alpha: true }
  );
  const groups = await provider.getChildren();
  const stockNode = (await provider.getChildren(groups![0]))![0] as StockItem;
  const tip = stockNode.tooltip as vscode.MarkdownString;
  assert.strictEqual(tip.supportHtml, false, "§6.15：树节点 Tooltip 必须关闭 HTML 渲染");
  assert.strictEqual(tip.value.includes("<img src=x"), false, "外部报文的标的名不得原样进入富文本");
  assert.ok(tip.value.includes("&lt;img"), "特殊 HTML 字符必须转义");
  assert.deepStrictEqual((tip as any).isTrusted?.enabledCommands, ["marketlens.copyCode"], "命令授权仍须收敛到白名单");
  // 今日盈亏 = change × shares = 1.5 × 100
  assert.ok(tip.value.includes("+¥150.00"), "卡片今日盈亏必须出自 deriveTodayProfit");

  const { StatusBar } = await import("../src/ui/statusBar.ts");
  const bar = new StatusBar({ maskMode: false, colorNeutral: false });
  try {
    bar.setHoldings([
      { name: "贵州茅台", symbol: "sh600519", currency: "CNY", cost: 10, shares: 100, price: 12, changePercent: 14.29, change: 1.5 },
    ]);
    const holdingTip = (bar as any).holdingBarItem.tooltip as vscode.MarkdownString;
    assert.ok(holdingTip.value.includes("150"), "状态栏持仓条与侧边栏卡片必须同一套今日盈亏口径");
  } finally {
    bar.dispose();
  }
});

void test("P0-1 回归 - 删除自选只按符号身份匹配，同名跨市场标的不得被连带误删", async () => {
  (vscode as any).__resetMock();
  setMaskSnapshotSource(() => ({ bossKeyActive: false, maskMode: false }));

  await seedWatchlist({
    "A股": [
      { symbol: "sh600519", type: "A_SHARE", name: "同名标的" },
      { symbol: "sh601398", type: "A_SHARE", name: "工商银行" },
    ],
    "港股": [{ symbol: "hk00700", type: "HK_STOCK", name: "同名标的" }],
  });

  const ops = new WatchlistOps({ quoteCache: new Map<string, MarketItem>(), rebuildTree: () => {} });

  // 删除港股「同名标的」：A股里同名但代码不同的无辜标的必须原地保留
  await ops.removeItem(makeStockNode("hk00700", "港股", "同名标的"));

  const cfg = readConfig();
  assert.strictEqual(cfg.watchlist["港股"]?.length, 0, "目标分组内的标的应被删除");
  assert.strictEqual(cfg.watchlist["A股"]?.length, 2, "同名不同代码的标的被连带删除 = §6.5 P0 红线破坏");
  assert.ok(cfg.watchlist["A股"]?.some((it) => it.symbol === "sh600519"));
  assert.ok(cfg.watchlist["A股"]?.some((it) => it.symbol === "sh601398"));
});

void test("P0-1 回归 - 删除操作限定目标分组，找不到目标只提示不扩大匹配范围", async () => {
  (vscode as any).__resetMock();
  setMaskSnapshotSource(() => ({ bossKeyActive: false, maskMode: false }));

  await seedWatchlist({
    "A股": [{ symbol: "sh600519", type: "A_SHARE", name: "贵州茅台" }],
    "港股": [{ symbol: "hk00700", type: "HK_STOCK", name: "腾讯控股" }],
  });

  const ops = new WatchlistOps({ quoteCache: new Map<string, MarketItem>(), rebuildTree: () => {} });

  // 节点声明分组为「港股」但代码实际只存在于「A股」：不得越过分组兜底清扫
  const bogus = makeStockNode("sh600519", "港股", "贵州茅台");
  await ops.removeItem(bogus);

  const cfg = readConfig();
  assert.strictEqual(cfg.watchlist["A股"]?.length, 1, "分组不匹配时不得跨组删除");
  assert.strictEqual(cfg.watchlist["港股"]?.length, 1);
});

void test("P0-2 回归 - 守卫下沉：老板键与简洁展示态下自选操作一律拒绝", async () => {
  (vscode as any).__resetMock();

  await seedWatchlist({
    "A股": [{ symbol: "sh600519", type: "A_SHARE", name: "贵州茅台" }],
  });

  const ops = new WatchlistOps({ quoteCache: new Map<string, MarketItem>(), rebuildTree: () => {} });
  const node = makeStockNode("sh600519", "A股", "贵州茅台");

  try {
    // 分支一：命令面板（无 node）+ 简洁展示 —— QuickPick 会铺满真实名称，必须拦截
    setMaskSnapshotSource(() => ({ bossKeyActive: false, maskMode: true }));
    await ops.removeItem();
    await ops.pinToTop();
    assert.strictEqual(readConfig().watchlist["A股"]?.length, 1, "简洁展示态无 node 分支必须被拦截");

    // 分支二：右键菜单（带 node）+ 老板键 —— 一票否决
    setMaskSnapshotSource(() => ({ bossKeyActive: true, maskMode: false }));
    await ops.removeItem(node);
    await ops.pinToTop(node);
    assert.strictEqual(readConfig().watchlist["A股"]?.length, 1, "老板键态带 node 分支必须被拦截");

    // 解除脱敏后同一操作必须正常生效（证明拦截来自守卫而非逻辑失效）
    setMaskSnapshotSource(() => ({ bossKeyActive: false, maskMode: false }));
    await ops.removeItem(node);
    assert.strictEqual(readConfig().watchlist["A股"]?.length, 0, "解除脱敏后删除操作应正常执行");
  } finally {
    setMaskSnapshotSource(() => ({ bossKeyActive: false, maskMode: false }));
  }
});

void test("P0-3 回归 - 伪装态状态栏 tooltip 不得自曝插件名与模式名", async () => {
  (vscode as any).__resetMock();
  setMaskSnapshotSource(() => ({ bossKeyActive: false, maskMode: false }));

  const created: any[] = [];
  const original = vscode.window.createStatusBarItem;
  (vscode.window as any).createStatusBarItem = (...args: any[]) => {
    const item = (original as any).apply(vscode.window, args);
    created.push(item);
    return item;
  };

  const { StatusBar } = await import("../src/ui/statusBar.ts");
  let bar: any;
  try {
    bar = new StatusBar({ maskMode: true, colorNeutral: false, colorScheme: "greenUpRedDown" });
    bar.setQuotes([
      { id: "sh600519", symbol: "sh600519", name: "贵州茅台", type: "A_SHARE", price: 1800, changePercent: 2.1 },
    ]);
    bar.show();

    assert.ok(created.length > 0, "状态栏必须通过 createStatusBarItem 创建条目");
    const item = created[0];
    assert.strictEqual(item.tooltip, undefined, "伪装态 tooltip 必须收敛，悬停即自曝");
    assert.ok(!String(item.text).includes("MarketLens"), "伪装文本不得含插件名");
    assert.ok(!String(item.text).includes("贵州茅台"), "伪装文本不得含真实标的名");
    assert.ok(!String(item.text).includes("1800"), "伪装文本不得含真实价格");
  } finally {
    (vscode.window as any).createStatusBarItem = original;
    bar?.dispose();
  }

  // 共享遮罩文案本身也不得含插件名/模式名（§6.3 规则七）
  assert.ok(!/MarketLens|简洁展示|专注|老板键|Alt\+/i.test(MASKED_TOOLTIP_TEXT));
});

void test("P1 回归 - 预警冷却以绝对到期时刻计量，到期自动回收", async () => {
  (vscode as any).__resetMock();
  const { AlertManager } = await import("../src/services/alertManager.ts");

  const manager = new AlertManager();
  const quote: MarketItem = {
    id: "sh600519", symbol: "sh600519", name: "贵州茅台",
    type: "A_SHARE", price: 200, changePercent: 3,
  };
  const config = {
    alerts: { "sh600519": { symbol: "sh600519", above: 100, enabled: true } },
    alertCooldownMinutes: 15,
    maskMode: false,
  } as any;

  try {
    const realNow = Date.now;
    const events1 = manager.checkQuotes([quote], config);
    assert.strictEqual(events1.length, 1, "首次突破阈值必须触发");
    assert.strictEqual(manager.isMuted("sh600519", "above"), true, "触发后进入冷却");

    // 冷却期内重复评估：不得二次触发（旧实现把绝对到期时刻当触发时刻用，实际时长会变成 2 倍）
    const events2 = manager.checkQuotes([quote], config);
    assert.strictEqual(events2.length, 0, "冷却期内不得轰炸");

    // 前进到超过冷却窗口：冷却键应被到期回收，并可重新触发
    Date.now = () => realNow() + 16 * 60 * 1000;
    try {
      assert.strictEqual(manager.isMuted("sh600519", "above"), false, "超期后静音状态必须自动失效");
      const events3 = manager.checkQuotes([quote], config);
      assert.strictEqual(events3.length, 1, "冷却到期后应重新允许触发");
    } finally {
      Date.now = realNow;
    }

    // 手动静音同样按配置时长写入绝对到期时刻
    manager.resetCooldown();
    manager.mute("SH600519", 15);
    assert.strictEqual(manager.isMuted("sh600519", "above"), true, "静音键必须经 normalizeSymbolKey 归一");
    assert.strictEqual(manager.isMuted("sh600519", "below"), true, "静音覆盖该标的全部三类阈值键");
  } finally {
    manager.resetCooldown();
  }
});

void test("P2-8 回归 - 预警规则消毒与增量回写（拒绝原型污染键、别名键回收）", () => {
  // 1. 消毒：危险键名与非法阈值一律丢弃（JSON.parse 才会产出真正拥有 __proto__ 自有键的对象）
  const dirty = JSON.parse(`{
    "__proto__": { "symbol": "x", "above": 1 },
    "constructor": { "symbol": "x", "above": 1 },
    "prototype": { "symbol": "x", "above": 1 },
    "sh600519": { "symbol": "sh600519", "above": -5, "enabled": true },
    "hk00700": { "symbol": "hk00700", "above": 300, "enabled": true },
    "btcusdt": { "symbol": "btcusdt" }
  }`);
  const cleaned = sanitizeAlerts(dirty);
  assert.deepStrictEqual(Object.keys(cleaned), ["hk00700"], "只保留合法标的与合法阈值");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(cleaned, "__proto__"), false);
  assert.strictEqual(({} as any).above, undefined, "消毒结果不得污染 Object.prototype");

  // 2. 增量回写：以磁盘现值为基准，只改目标标的，并回收同一标的的历史别名键
  const disk = {
    "SH600519": { symbol: "SH600519", above: 100, enabled: true },
    "600519": { symbol: "600519", below: 50, enabled: true },
    "hk00700": { symbol: "hk00700", above: 300, enabled: true },
  };
  const next = applyAlertRuleDelta(disk as any, "sh600519", { symbol: "sh600519", above: 999, enabled: true });
  assert.ok(next, "合法增量必须被接受");
  assert.deepStrictEqual(
    Object.keys(next!).sort(),
    ["hk00700", "sh600519"],
    "同一标的的历史别名键必须被规范键取代，不得永久并存"
  );
  assert.strictEqual((next! as any)["sh600519"].above, 999);
  assert.strictEqual((next! as any)["hk00700"].above, 300, "未触碰的标的必须原样保留");

  // 3. 删除语义：rule 传 null 时剔除该标的全部键
  const removed = applyAlertRuleDelta(next as any, "sh600519", null);
  assert.deepStrictEqual(Object.keys(removed!), ["hk00700"]);

  // 4. 非法输入拒绝：非字符串键 / 危险键 / 空键
  assert.strictEqual(applyAlertRuleDelta(disk as any, "__proto__", { symbol: "x", above: 1 }), null);
  assert.strictEqual(applyAlertRuleDelta(disk as any, "   ", { symbol: "x", above: 1 }), null);
  assert.strictEqual(applyAlertRuleDelta(disk as any, 123 as any, { symbol: "x", above: 1 }), null);
});

void test("P2-8 回归 - 设置面板消息分发全量分支：alerts 只接受按标的增量回写", async () => {
  (vscode as any).__resetMock();
  setMaskSnapshotSource(() => ({ bossKeyActive: false, maskMode: false }));

  const { SettingsWebviewPanel, ALLOWED_CONFIG_KEYS, SECTION_STATUS_BAR_KEYS } = await import("../src/ui/settingsWebview.ts");

  // alerts 必须留在 updateSetting 白名单之外（整幅镜像覆写会覆盖用户未落盘编辑）
  assert.strictEqual(ALLOWED_CONFIG_KEYS.has("alerts"), false, "alerts 不得回到 updateSetting 白名单");
  assert.strictEqual(SECTION_STATUS_BAR_KEYS.size, 6, "板块级状态栏键集合必须由 MARKET_SECTIONS 派生");

  const listeners: Array<(msg: any) => any> = [];
  const originalPanel = vscode.window.createWebviewPanel;
  (vscode.window as any).createWebviewPanel = (...args: any[]) => {
    const panel = (originalPanel as any).apply(vscode.window, args);
    const origOn = panel.webview.onDidReceiveMessage.bind(panel.webview);
    panel.webview.onDidReceiveMessage = (listener: any) => {
      listeners.push(listener);
      return origOn(listener);
    };
    return panel;
  };

  const notified: Array<{ key: string; value: unknown }> = [];
  SettingsWebviewPanel.onDidUpdateSetting = (key: string, value: unknown) => {
    notified.push({ key, value });
  };

  const fire = async (msg: any) => {
    for (const listener of listeners) {
      await listener(msg);
    }
  };

  try {
    SettingsWebviewPanel.createOrShow(vscode.Uri.file("/mock/extension"));
    assert.ok(listeners.length > 0, "面板必须注册消息接收器");

    // 1. 整幅镜像回写：被白名单拒绝，磁盘不得出现任何 alerts
    await fire({ command: "updateSetting", key: "alerts", value: { "sh600519": { symbol: "sh600519", above: 1 } } });
    assert.strictEqual(readConfig().alerts["sh600519"], undefined, "updateSetting 不得写入 alerts");

    // 2. 按标的增量：写入规范键（大小写形态被归一）
    await fire({ command: "updateAlertRule", key: "SH600519", rule: { symbol: "SH600519", above: 1900, enabled: true } });
    assert.deepStrictEqual(Object.keys(readConfig().alerts), ["sh600519"]);
    assert.strictEqual(readConfig().alerts["sh600519"]?.above, 1900);

    // 3. 第二个标的增量不得覆盖第一个（这正是整幅镜像回写的失效模式）
    await fire({ command: "updateAlertRule", key: "hk00700", rule: { symbol: "hk00700", below: 280, enabled: true } });
    const both = readConfig().alerts;
    assert.strictEqual(both["sh600519"]?.above, 1900, "增量回写不得丢失其他标的的既有规则");
    // 港股键经 normalizeSymbolKey 归一（hk00700 → hk700），与轮询端取数键同源
    assert.strictEqual(both["hk700"]?.below, 280);
    assert.strictEqual(both["hk00700"], undefined, "同一标的不得留下前导零别名键");

    // 4. rule 传 null = 只删该标的，其余保留
    await fire({ command: "updateAlertRule", key: "hk00700", rule: null });
    const afterDelete = readConfig().alerts;
    assert.strictEqual(afterDelete["hk700"], undefined);
    assert.strictEqual(afterDelete["sh600519"]?.above, 1900);

    // 5. 危险键名被拒绝，不产生任何写入
    await fire({ command: "updateAlertRule", key: "__proto__", rule: { symbol: "__proto__", above: 1 } });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(readConfig().alerts, "__proto__"), false);
    assert.strictEqual(({} as any).above, undefined);

    // 6. 内存先行：每次增量都会向后端广播同一份合并结果
    assert.ok(notified.some((n) => n.key === "alerts"));
  } finally {
    (vscode.window as any).createWebviewPanel = originalPanel;
    SettingsWebviewPanel.onDidUpdateSetting = undefined;
    SettingsWebviewPanel.currentPanel?.dispose();
  }
});

void test("P0-4 回归 - 老板键激活时导出/导入/恢复默认/清空自选一律静默拒绝", async () => {
  const { SettingsWebviewPanel } = await import("../src/ui/settingsWebview.ts");
  (vscode as any).__resetMock();

  await vscode.workspace.getConfiguration("marketlens").update(
    "watchlist",
    { "自选": [{ symbol: "sh600519", type: "A_SHARE", name: "贵州茅台" }] },
    vscode.ConfigurationTarget.Global
  );
  const config = readConfig();

  // 记录宿主交互面：老板键态下必须一次都不发生
  const calls: string[] = [];
  const originalSave = vscode.window.showSaveDialog;
  const originalOpen = vscode.window.showOpenDialog;
  const originalInfo = vscode.window.showInformationMessage;
  const originalWarning = vscode.window.showWarningMessage;
  (vscode.window as any).showSaveDialog = async () => {
    calls.push("saveDialog");
    return vscode.Uri.file("/mock/backup.json");
  };
  (vscode.window as any).showOpenDialog = async () => {
    calls.push("openDialog");
    return [vscode.Uri.file("/mock/backup.json")];
  };
  (vscode.window as any).showInformationMessage = async (message: string) => {
    calls.push(`info:${message}`);
    return undefined;
  };
  (vscode.window as any).showWarningMessage = async (message: string) => {
    calls.push(`warning:${message}`);
    return undefined;
  };

  try {
    setMaskSnapshotSource(() => ({ bossKeyActive: true, maskMode: false }));
    assert.strictEqual(await exportSettingsToFile(config), false);
    assert.strictEqual(await importSettingsFromFile({}), false);
    // 破坏性命令同样必须静默：命令面板可直达这两个静态方法，此前无任何前置守卫
    assert.strictEqual(await SettingsWebviewPanel.restoreDefaults(), false);
    assert.strictEqual(await SettingsWebviewPanel.clearWatchlist(), false);
    // 注意：不要用 `assert.deepStrictEqual(calls, [])` 断言空数组——Node 的 assert 类型把
    // deepStrictEqual 声明成 `asserts actual is T`，空字面量推导为 `never[]` 会让后续
    // 对同一变量的元素访问全部塌成 never。用 length 断言即可。
    assert.strictEqual(calls.length, 0, "老板键激活期间不得弹出任何系统对话框，也不得有任何回显");
    assert.strictEqual(
      readConfig().watchlist["自选"]?.[0]?.symbol,
      "sh600519",
      "被拒绝的破坏性命令不得改动自选配置"
    );

    // 解除老板键后必须恢复原流程——守卫不能把功能整个封死
    setMaskSnapshotSource(() => ({ bossKeyActive: false, maskMode: false }));
    assert.strictEqual(await exportSettingsToFile(config), true);
    assert.strictEqual(calls.filter((c) => c === "saveDialog").length, 1);
    assert.ok(
      calls.some((c) => c.startsWith("info:✅")),
      "导出成功回执必须经 feedback.ts 的统一出口到达用户"
    );
  } finally {
    (vscode.window as any).showSaveDialog = originalSave;
    (vscode.window as any).showOpenDialog = originalOpen;
    (vscode.window as any).showInformationMessage = originalInfo;
    (vscode.window as any).showWarningMessage = originalWarning;
    setMaskSnapshotSource(() => ({ bossKeyActive: false, maskMode: false }));
  }
});
