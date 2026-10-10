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
import type { MarketItem } from "../src/types/index.ts";

test("config - readConfig 端到端读取与默认值回退", async () => {
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

test("config - persistProxyToAllSections 与 persistStatusBarToAllSections 批量写盘", async () => {
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

test("backupHelper - exportSettingsToFile 与 importSettingsFromFile 全流程", async () => {
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

test("WatchlistProvider - 树节点构建、空组过滤与脏数据防御", async () => {
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

test("WatchlistOps - 基础操作与安全防护", async () => {
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

test("StatusBar - 正常渲染、轮播、伪装与老板键模式", async () => {
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

test("SettingsWebviewPanel - 白名单校验与面板生命周期", async () => {
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

test("RefreshScheduler 与 MarketManager 调度集成测试", async () => {
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

test("extension 与 commands - 扩展完整生命周期与命令分发集成", async () => {
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
