// test/config.test.ts
import assert from "node:assert";
import test from "node:test";
import {
  MARKET_SECTIONS,
  applyProxyToAllSections,
  applyStatusBarToAllSections,
  recomputeStatusBarEnabled,
  affectsNetworkConfig,
} from "../src/utils/config.ts";

void test("config - MARKET_SECTIONS 覆盖全量子市场", () => {
  assert.deepStrictEqual(MARKET_SECTIONS, ["fund", "aShare", "hkStock", "usStock", "binance", "alpha"]);
});

void test("config - applyProxyToAllSections 全量覆盖所有板块（含 fund 修复回归）", () => {
  const dummyConfig: any = {
    proxyPort: 10808,
    proxyUrl: "http://127.0.0.1:10808",
    fund: {},
    aShare: {},
    hkStock: {},
    usStock: {},
    binance: {},
    alpha: {},
  };

  applyProxyToAllSections(dummyConfig, "http://127.0.0.1:7890", 7890);
  assert.strictEqual(dummyConfig.proxyPort, 7890);
  assert.strictEqual(dummyConfig.proxyUrl, "http://127.0.0.1:7890");
  assert.strictEqual(dummyConfig.fund.proxyUrl, "http://127.0.0.1:7890");
  assert.strictEqual(dummyConfig.aShare.proxyUrl, "http://127.0.0.1:7890");
  assert.strictEqual(dummyConfig.hkStock.proxyUrl, "http://127.0.0.1:7890");
  assert.strictEqual(dummyConfig.usStock.proxyUrl, "http://127.0.0.1:7890");
  assert.strictEqual(dummyConfig.binance.proxyUrl, "http://127.0.0.1:7890");
  assert.strictEqual(dummyConfig.alpha.proxyUrl, "http://127.0.0.1:7890");
});

void test("config - applyStatusBarToAllSections 全量覆盖所有板块（含 fund 修复回归）", () => {
  const dummyConfig: any = {
    statusBar: { enabled: true },
    fund: { statusBar: true },
    aShare: { statusBar: true },
    hkStock: { statusBar: true },
    usStock: { statusBar: true },
    binance: { statusBar: true },
    alpha: { statusBar: true },
  };

  applyStatusBarToAllSections(dummyConfig, false);
  assert.strictEqual(dummyConfig.statusBar.enabled, false);
  assert.strictEqual(dummyConfig.fund.statusBar, false);
  assert.strictEqual(dummyConfig.aShare.statusBar, false);
  assert.strictEqual(dummyConfig.hkStock.statusBar, false);
  assert.strictEqual(dummyConfig.usStock.statusBar, false);
  assert.strictEqual(dummyConfig.binance.statusBar, false);
  assert.strictEqual(dummyConfig.alpha.statusBar, false);
});

void test("config - recomputeStatusBarEnabled 聚合判定（含 fund 修复回归）", () => {
  const dummyConfig: any = {
    statusBar: { enabled: false },
    fund: { statusBar: false },
    aShare: { statusBar: false },
    hkStock: { statusBar: false },
    usStock: { statusBar: false },
    binance: { statusBar: false },
    alpha: { statusBar: false },
  };

  assert.strictEqual(recomputeStatusBarEnabled(dummyConfig), false);
  assert.strictEqual(dummyConfig.statusBar.enabled, false);

  // 仅激活 fund 时，状态栏应自动聚合判定为 true
  dummyConfig.fund.statusBar = true;
  assert.strictEqual(recomputeStatusBarEnabled(dummyConfig), true);
  assert.strictEqual(dummyConfig.statusBar.enabled, true);
});

void test("config - affectsNetworkConfig 判定敏感配置变动（含 fund 修复回归）", () => {
  function makeMockEvent(changedKeys: string[]) {
    return {
      affectsConfiguration: (key: string) => changedKeys.some((k) => k === key || k.startsWith(key + ".")),
    };
  }

  // 全局网络配置
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.proxyPort"])), true);
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.proxyUrl"])), true);
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.autoRefresh"])), true);
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.refreshInterval"])), true);

  // 基金板块敏感配置（关键 Bug 守卫）
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.fund.enabled"])), true);
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.fund.networkMode"])), true);
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.fund.proxyUrl"])), true);
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.fund.stopOnMarketClosed"])), true);

  // 其他板块
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.aShare.enabled"])), true);
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.binance.networkMode"])), true);
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.alpha.proxyUrl"])), true);

  // 纯 UI 配置不应触发 affectsNetwork
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.maskMode"])), false);
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.colorNeutral"])), false);
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.colorScheme"])), false);
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["marketlens.statusBar.enabled"])), false);
  assert.strictEqual(affectsNetworkConfig(makeMockEvent(["otherExtension.someSetting"])), false);
});
