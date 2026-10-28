// test/unit.test.ts
import assert from "node:assert";
import test from "node:test";
import { createRequire } from "node:module";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isSameSymbol, normalizeSymbolKey, stripMarketPrefix, normalizeUSCode, inferAShareExchange, normalizeAShareCode, resolveItemAssetType, resolveItemDisplayName, getWatchlistFingerprint, reorderWatchlist, batchReorderWatchlist, pruneQuoteCache, extractTargetsFromWatchlist, extractStatusBarQuotes, computeStatusBarEnabled, resolveTrendColors, chunkArray, decodeGbk, escapeHtml, escapeMarkdownInline, toMarkdownCodeSpan, ASSET_TYPE_TO_SECTION_MAP, NORMALIZE_SYMBOL_KEY_CLIENT_SCRIPT, isItemMarketClosed, isGroupMarketClosed, buildGroupNodeId, sanitizeWatchlist } from "../src/utils/symbolHelper.ts";
import type { MarketItem, WatchlistConfig, WatchConfigItem, PriceAlertItem } from "../src/types/index.ts";
import { describeForLog, describeListForLog, scrubForLog, describeErrorForLog, describeErrorNameForLog, formatDetailForLog, logger } from "../src/utils/logger.ts";
import { validateAndParseInput, isContractAddress, extractContractAddressFromUrl } from "../src/utils/inputValidator.ts";
import { isAShareMarketOpen, isHKMarketOpen, isUSMarketOpen, isAShareHoliday, isHKHoliday, isUSHoliday, evaluateAdaptiveThrottle, getZonedTimeParts, beijingFormatter, newYorkFormatter, beijingDateFormatter, newYorkDateFormatter, shouldSkipMarketPolling, MAX_COVERED_HOLIDAY_YEAR, FORECAST_HOLIDAY_YEARS, checkHolidayCoverage, US_HOLIDAYS, HK_HOLIDAYS, A_SHARE_HOLIDAYS } from "../src/utils/marketHours.ts";
import { validateAndNormalizeProxyUrl, parseProxy, resetProxyCache, getSystemProxyUrl, smartNetworkGet, getCachedWorkingPort, testLocalPort, DEFAULT_PROXY_PORT, DEFAULT_PROXY_URL, COMMON_PROXY_PORTS, DEFAULT_REQUEST_TIMEOUT_MS, SYSTEM_PROXY_FALLBACK_TIMEOUT_MS, QUICK_PROXY_PROBE_TIMEOUT_MS, PORT_PROBE_TIMEOUT_MS } from "../src/services/network.ts";
import axios from "axios";
import { isDisplayMasked, shouldAutoExitBossKey, canEmitUserFeedback, resolveMaskToggle, shouldBlockNodeCommand, MASKED_TOOLTIP_TEXT, resolveStockTooltip } from "../src/utils/maskState.ts";
import { AlertManager, DEFAULT_ALERT_COOLDOWN_MINUTES } from "../src/services/alertManager.ts";
import { DexScreenerService } from "../src/services/dexScreenerService.ts";
import { BinanceService } from "../src/services/binanceService.ts";
import { AShareService } from "../src/services/aShareService.ts";
import { HKStockService } from "../src/services/hkStockService.ts";
import { USStockService } from "../src/services/usStockService.ts";
import { generateBackupData, validateBackupData } from "../src/utils/backupHelper.ts";
import "./config.test.ts";

void test("nls - package.json 占位符与语言包契约一致性", () => {
  // 防回归闸门：任何新增配置项 / 命令若忘记补 NLS 翻译，或误删既有翻译键，
  // 都会在此处立即红灯，杜绝「非中文环境下设置页与扩展描述全中文」的问题悄悄回归。
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const readJson = (rel: string) =>
    JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8").replace(/^\uFEFF/, ""));

  const pkg = readJson("package.json");
  const en = readJson("package.nls.json");
  const zh = readJson("package.nls.zh-cn.json");

  // 1. 两个语言包的键集合必须完全一致，否则某一语言会出现「缺翻译」的裸键名
  assert.deepStrictEqual(
    Object.keys(zh).sort(),
    Object.keys(en).sort(),
    "package.nls.json 与 package.nls.zh-cn.json 的键集合必须完全一致"
  );

  // 2. 递归收集 package.json 中所有 %key% 占位符
  const placeholders = new Set<string>();
  const walk = (val: unknown): void => {
    if (typeof val === "string") {
      const matched = val.match(/^%([^%]+)%$/);
      if (matched) placeholders.add(matched[1]);
    } else if (Array.isArray(val)) {
      val.forEach(walk);
    } else if (val && typeof val === "object") {
      Object.values(val as Record<string, unknown>).forEach(walk);
    }
  };
  walk(pkg);

  // 3. 每个占位符都必须能在两个语言包中解析出文案
  for (const key of placeholders) {
    assert.ok(key in en, `占位符 %${key}% 在 package.nls.json 中缺失`);
    assert.ok(key in zh, `占位符 %${key}% 在 package.nls.zh-cn.json 中缺失`);
  }

  // 4. 反向检查：语言包中不得残留从未被引用的死键（如已移除命令的幽灵翻译）
  const orphans = Object.keys(en).filter((k) => !placeholders.has(k));
  assert.deepStrictEqual(orphans, [], `语言包中存在未被 package.json 引用的死键：${orphans.join(", ")}`);

  // 5. 全部配置描述必须走占位符，不得残留中文字面量
  const configProps = pkg.contributes.configuration.properties as Record<string, { description: string }>;
  for (const key of Object.keys(configProps)) {
    assert.match(
      String(configProps[key].description),
      /^%[^%]+%$/,
      `配置项 ${key} 的 description 必须使用 %key% 占位符，以便多语言环境正确显示`
    );
  }

  // 6. 命令标题与顶层元信息同样必须接线到 NLS
  const commands = pkg.contributes.commands as Array<{ command: string; title: string }>;
  for (const cmd of commands) {
    assert.match(String(cmd.title), /^%[^%]+%$/, `命令 ${cmd.command} 的 title 必须使用 %key% 占位符`);
  }
  assert.strictEqual(pkg.displayName, "%displayName%", "顶层 displayName 必须使用 %displayName% 占位符");
  assert.strictEqual(pkg.description, "%description%", "顶层 description 必须使用 %description% 占位符");
});

void test("symbolHelper - 真实源码逻辑校验", () => {
  // A股
  assert.strictEqual(isSameSymbol("sh600030", "600030"), true);
  assert.strictEqual(isSameSymbol("sh000001", "sz000001"), false);
  assert.strictEqual(normalizeSymbolKey("sh600030"), "sh600030");

  // 港股（前缀与前导0归一化）
  assert.strictEqual(isSameSymbol("hk00700", "00700"), true);
  assert.strictEqual(isSameSymbol("hk700", "00700"), true);
  assert.strictEqual(normalizeSymbolKey("hk00700"), "hk700");
  assert.strictEqual(normalizeSymbolKey("00700"), "hk700");

  // 美股（点号与下划线，及真实 US 开头代码 USB/USM/USFD/USA 与 B/M/A 防冲突）
  assert.strictEqual(isSameSymbol("us.AAPL", "AAPL"), true);
  assert.strictEqual(isSameSymbol("us_TSLA", "tsla"), true);
  assert.strictEqual(normalizeSymbolKey("us.AAPL"), "aapl");
  assert.strictEqual(normalizeSymbolKey("AAPL"), "aapl");
  assert.strictEqual(normalizeSymbolKey("USB"), "usb");
  assert.strictEqual(normalizeSymbolKey("B"), "b");
  assert.strictEqual(normalizeSymbolKey("us.USB"), "usb");
  assert.strictEqual(isSameSymbol("USB", "B"), false);
  assert.strictEqual(isSameSymbol("USB", "us.USB"), true);
  assert.strictEqual(isSameSymbol("B", "us.B"), true);
  assert.strictEqual(isSameSymbol("USA", "A"), false);
  assert.strictEqual(isSameSymbol("USM", "M"), false);

  // 3字母美股腾讯格式 (usAMD, usNET, usTSM, usARM) 与裸代码互认及规范化
  assert.strictEqual(isSameSymbol("usAMD", "AMD"), true);
  assert.strictEqual(isSameSymbol("usNET", "NET"), true);
  assert.strictEqual(isSameSymbol("usTSM", "TSM"), true);
  assert.strictEqual(isSameSymbol("usARM", "ARM"), true);
  assert.strictEqual(normalizeSymbolKey("usAMD"), "amd");
  assert.strictEqual(normalizeSymbolKey("usNET"), "net");
  assert.strictEqual(normalizeSymbolKey("usTSM"), "tsm");

  // 美股类股（BRK.B, BF.B, BRK-B）与腾讯 us 前缀互通
  assert.strictEqual(isSameSymbol("BRK.B", "usBRK.B"), true);
  assert.strictEqual(isSameSymbol("BRK.B", "BRK-B"), true);
  assert.strictEqual(isSameSymbol("BF.B", "usBF.B"), true);
  assert.strictEqual(normalizeSymbolKey("BRK.B"), "brkb");
  assert.strictEqual(normalizeSymbolKey("usBRK.B"), "brkb");
  assert.strictEqual(normalizeSymbolKey("BRK-B"), "brkb");
  assert.strictEqual(normalizeSymbolKey("BF.B"), "bfb");
  assert.strictEqual(normalizeSymbolKey("usARM"), "arm");

  // 加密货币
  assert.strictEqual(isSameSymbol("BTCUSDT", "btcusdt"), true);
  assert.strictEqual(normalizeSymbolKey("BTCUSDT"), "btcusdt");
  assert.strictEqual(isSameSymbol("SOL/USDT", "SOLUSDT"), true);
  assert.strictEqual(normalizeSymbolKey("SOL/USDT"), "solusdt");
});

void test("inputValidator - 真实源码输入识别与非法拦截", () => {
  // A股
  const a1 = validateAndParseInput("600519");
  assert.strictEqual(a1.parsed?.symbol, "sh600519");
  assert.strictEqual(a1.parsed?.type, "A_SHARE");

  const a2 = validateAndParseInput("000001");
  assert.strictEqual(a2.parsed?.symbol, "sz000001");

  // 港股
  const hk1 = validateAndParseInput("00700");
  assert.strictEqual(hk1.parsed?.symbol, "hk00700");
  assert.strictEqual(hk1.parsed?.type, "HK_STOCK");

  const hk2 = validateAndParseInput("hk700");
  assert.strictEqual(hk2.parsed?.symbol, "hk00700");
  assert.strictEqual(hk2.parsed?.type, "HK_STOCK");

  // 美股与加密货币
  const us1 = validateAndParseInput("AAPL");
  assert.strictEqual(us1.parsed?.symbol, "AAPL");
  assert.strictEqual(us1.parsed?.type, "US_STOCK");

  const c1 = validateAndParseInput("BTCUSDT");
  assert.strictEqual(c1.parsed?.symbol, "BTCUSDT");
  assert.strictEqual(c1.parsed?.type, "CRYPTO");

  // EVM 合约地址
  const evm = validateAndParseInput("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c");
  assert.strictEqual(evm.parsed?.type, "ALPHA_TOKEN");
  assert.strictEqual(isContractAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"), true);

  // Solana 合约地址（测试以 sh 或 6位纯数字开头的边缘场景）
  const solWithSh = "shW7kF3Yc3pA9nL5xK8vQ2mR4tZ6jE1uB7hN9sC3wP2";
  const solWithNum = "688888F3Yc3pA9nL5xK8vQ2mR4tZ6jE1uB7hN9sC3wP2";
  assert.strictEqual(isContractAddress(solWithSh), true);
  assert.strictEqual(isContractAddress(solWithNum), true);
  assert.strictEqual(validateAndParseInput(solWithSh).parsed?.type, "ALPHA_TOKEN");
  assert.strictEqual(validateAndParseInput(solWithNum).parsed?.type, "ALPHA_TOKEN");

  // 腾讯前缀美股（如 usAMD, usNET）保留小写 us
  const usAmd = validateAndParseInput("usAMD");
  assert.strictEqual(usAmd.parsed?.symbol, "usAMD");
  assert.strictEqual(usAmd.parsed?.type, "US_STOCK");

  const usNet = validateAndParseInput("usNET");
  assert.strictEqual(usNet.parsed?.symbol, "usNET");

  // 美股类股（BRK.B, BRK-B, BF.B, us.BRK.B）测试
  const brkb = validateAndParseInput("BRK.B");
  assert.strictEqual(brkb.parsed?.symbol, "BRK.B");
  assert.strictEqual(brkb.parsed?.type, "US_STOCK");
  assert.strictEqual(brkb.parsed?.defaultGroup, "美股");

  const brkbDash = validateAndParseInput("BRK-B");
  assert.strictEqual(brkbDash.parsed?.symbol, "BRK.B");
  assert.strictEqual(brkbDash.parsed?.type, "US_STOCK");

  const bfb = validateAndParseInput("BF.B");
  assert.strictEqual(bfb.parsed?.symbol, "BF.B");
  assert.strictEqual(bfb.parsed?.type, "US_STOCK");

  const usBrkb = validateAndParseInput("us.BRK.B");
  assert.strictEqual(usBrkb.parsed?.symbol, "usBRK.B");
  assert.strictEqual(usBrkb.parsed?.type, "US_STOCK");

  // 加密货币 US 开头币对测试（防止被误判为美股）
  const usdcUsdt = validateAndParseInput("USDCUSDT");
  assert.strictEqual(usdcUsdt.parsed?.symbol, "USDCUSDT");
  assert.strictEqual(usdcUsdt.parsed?.type, "CRYPTO");

  const usdtTry = validateAndParseInput("USDTTRY");
  assert.strictEqual(usdtTry.parsed?.symbol, "USDTTRY");
  assert.strictEqual(usdtTry.parsed?.type, "CRYPTO");

  const usd1Usdt = validateAndParseInput("USD1USDT");
  assert.strictEqual(usd1Usdt.parsed?.symbol, "USD1USDT");
  assert.strictEqual(usd1Usdt.parsed?.type, "CRYPTO");

  // 异常拦截（如 4 位纯数字非法输入）
  const errNum = validateAndParseInput("1234");
  assert.ok(errNum.error);
});

void test("marketHours - 真实源码时区与交易时段计算", () => {
  // 1. 测试北京时间 UTC 转换
  const mondayUtc = new Date("2026-09-07T02:00:00Z"); // UTC 02:00 -> 北京时间周一 10:00 (开市)
  const beijingParts = getZonedTimeParts(beijingFormatter, mondayUtc);
  assert.strictEqual(beijingParts.day, 1); // Mon
  assert.strictEqual(beijingParts.totalMinutes, 10 * 60);
  assert.strictEqual(isAShareMarketOpen(mondayUtc), true);
  assert.strictEqual(isHKMarketOpen(mondayUtc), true);

  // 2. 测试周末闭市
  const sundayUtc = new Date("2026-09-06T04:00:00Z"); // 周日
  assert.strictEqual(isAShareMarketOpen(sundayUtc), false);
  assert.strictEqual(isHKMarketOpen(sundayUtc), false);
  assert.strictEqual(isUSMarketOpen(sundayUtc), false);

  // 3. 测试美股交易时段（美东时间周一 10:30，UTC 14:30 处于夏令时常规时段）
  const usTradingUtc = new Date("2026-09-14T14:30:00Z");
  const nyParts = getZonedTimeParts(newYorkFormatter, usTradingUtc);
  assert.strictEqual(nyParts.day, 1); // Mon
  assert.strictEqual(nyParts.totalMinutes, 10 * 60 + 30);
  assert.strictEqual(isUSMarketOpen(usTradingUtc), true);
});

void test("normalizeUSCode - 美股代码规范化与防双重前缀", () => {
  // 3字母带腾讯前缀：绝对不可变成 usUSAMD / usUSNET / usUSTSM / usUSARM
  assert.strictEqual(normalizeUSCode("usAMD"), "usAMD");
  assert.strictEqual(normalizeUSCode("usNET"), "usNET");
  assert.strictEqual(normalizeUSCode("usTSM"), "usTSM");
  assert.strictEqual(normalizeUSCode("usARM"), "usARM");

  // 4字母及长代码
  assert.strictEqual(normalizeUSCode("usAAPL"), "usAAPL");
  assert.strictEqual(normalizeUSCode("usNVDA"), "usNVDA");
  assert.strictEqual(normalizeUSCode("usIXIC"), "usIXIC");

  // 裸 ticker 补齐 us 前缀
  assert.strictEqual(normalizeUSCode("AMD"), "usAMD");
  assert.strictEqual(normalizeUSCode("AAPL"), "usAAPL");
  assert.strictEqual(normalizeUSCode("B"), "usB");
  assert.strictEqual(normalizeUSCode("USB"), "usUSB");
  assert.strictEqual(normalizeUSCode("USM"), "usUSM");
  assert.strictEqual(normalizeUSCode("USFD"), "usUSFD");

  // 带点号
  assert.strictEqual(normalizeUSCode(".IXIC"), "usIXIC");
  assert.strictEqual(normalizeUSCode("us.AMD"), "usAMD");
  assert.strictEqual(normalizeUSCode("us.USB"), "usUSB");

  // 美股类股（BRK.B, BRK-B, BF.B, usBRK.B, us.BRK.B）
  assert.strictEqual(normalizeUSCode("BRK.B"), "usBRK.B");
  assert.strictEqual(normalizeUSCode("BRK-B"), "usBRK.B");
  assert.strictEqual(normalizeUSCode("BF.B"), "usBF.B");
  assert.strictEqual(normalizeUSCode("usBRK.B"), "usBRK.B");
  assert.strictEqual(normalizeUSCode("us.BRK.B"), "usBRK.B");
});

void test("bossKeyActive - 老板键状态与脱敏逻辑守卫校验（真实生产函数）", () => {
  // 1. 常规模式：取决于用户配置 maskMode
  assert.strictEqual(isDisplayMasked(false, false), false);
  assert.strictEqual(isDisplayMasked(false, true), true);

  // 2. 老板键激活中：无论用户配置中的 maskMode 为 true 还是 false，始终强制脱敏为 true
  assert.strictEqual(isDisplayMasked(true, false), true);
  assert.strictEqual(isDisplayMasked(true, true), true);
});

void test("bossKeyActive - 重新打开看板自动解除专注模式（杜绝 Alt+K 静默失效回归）", () => {
  // 1. 仅在「视图可见 + 老板键激活」双前提同时成立时才允许自动解除
  assert.strictEqual(shouldAutoExitBossKey(true, true), true);

  // 2. 视图不可见时严禁解除，防止行情在隐身期意外暴露
  assert.strictEqual(shouldAutoExitBossKey(false, true), false);

  // 3. 老板键未激活时无需解除（保持幂等，杜绝重复复位引发状态抖动）
  assert.strictEqual(shouldAutoExitBossKey(true, false), false);
  assert.strictEqual(shouldAutoExitBossKey(false, false), false);

  // 4. 交叉时序回归：解除老板键后，maskMode 必须重新成为唯一决定因素
  const userMaskMode = true;
  assert.strictEqual(isDisplayMasked(true, userMaskMode), true, "老板键未解除时一票否决，界面必须保持脱敏");
  assert.strictEqual(isDisplayMasked(false, userMaskMode), true, "解除老板键后应遵循用户 maskMode 配置（仍为脱敏）");
  assert.strictEqual(isDisplayMasked(false, false), false, "解除老板键且关闭简洁模式后，必须恢复真实行情展示");
});

void test("bossKeyActive - 专注模式静默守卫（状态栏消息 / 信息提示 / 设置面板统一收口）", () => {
  // 1. 专注模式激活期间必须完全静默：任何 UI 回显（含「已隐蔽」这句本身）都是暴露源
  assert.strictEqual(canEmitUserFeedback(true), false);

  // 2. 非专注态放行，保证常规操作的状态栏提示不受影响
  assert.strictEqual(canEmitUserFeedback(false), true);

  // 3. 回归锚定：老板键一票否决脱敏 + 静默守卫必须同时成立（二者是一对协同约束）
  assert.strictEqual(isDisplayMasked(true, false), true);
  assert.strictEqual(canEmitUserFeedback(true), false);
});

void test("bossKeyActive - Alt+K 语义决议（杜绝专注态下显示开关静默失效）", () => {
  // 1. 常规态：保持纯粹的取反语义，与历史行为完全一致
  assert.deepStrictEqual(resolveMaskToggle(false, false), {
    exitBossKey: false,
    nextMaskMode: true,
    requiresConfigWrite: true,
  });
  assert.deepStrictEqual(resolveMaskToggle(false, true), {
    exitBossKey: false,
    nextMaskMode: false,
    requiresConfigWrite: true,
  });

  // 2. 专注态：语义归属为「退出专注模式 + 关闭打码」，而非单纯翻转配置
  assert.deepStrictEqual(resolveMaskToggle(true, false), {
    exitBossKey: true,
    nextMaskMode: false,
    requiresConfigWrite: false, // maskMode 本就为 false，无需落盘，避免无谓的配置变更事件
  });
  assert.deepStrictEqual(resolveMaskToggle(true, true), {
    exitBossKey: true,
    nextMaskMode: false,
    requiresConfigWrite: true, // maskMode 原为 true，需落盘归零
  });

  // 3. 交叉验证：执行决议后界面必须恢复真实行情（专注态下不再静默失效）
  for (const currentMaskMode of [false, true]) {
    const plan = resolveMaskToggle(true, currentMaskMode);
    assert.strictEqual(plan.exitBossKey, true, "专注态下的任何 Alt+K 都必须先解除隐身");
    assert.strictEqual(
      isDisplayMasked(!plan.exitBossKey, plan.nextMaskMode),
      false,
      "决议执行后必须恢复真实行情展示"
    );
  }
});

void test("resolveStockTooltip - 自选列表脱敏态 Tooltip 安全收敛与惰性求值", () => {
  let builderCalled = false;
  const mockCardBuilder = () => {
    builderCalled = true;
    return { value: "### 贵州茅台 (sh600519)\n| 最新价格 | ¥1850.00 |" };
  };

  // 1. 脱敏态 (masked: true)：强制收敛为无害静态文本，且绝对不触发卡片构建函数
  builderCalled = false;
  const maskedTooltip = resolveStockTooltip(true, mockCardBuilder);
  assert.strictEqual(maskedTooltip, MASKED_TOOLTIP_TEXT);
  assert.strictEqual(builderCalled, false, "脱敏态下不得调用卡片构建回调，杜绝性能损耗与内存分配");
  assert.ok(!String(maskedTooltip).includes("贵州茅台"), "脱敏 Tooltip 严禁泄露标的真实名称");
  assert.ok(!String(maskedTooltip).includes("sh600519"), "脱敏 Tooltip 严禁泄露标的代码");
  assert.ok(!String(maskedTooltip).includes("1850"), "脱敏 Tooltip 严禁泄露财务价格指标");

  // 2. 常规态 (masked: false)：正常调用卡片构建回调并返回卡片对象
  builderCalled = false;
  const normalTooltip = resolveStockTooltip(false, mockCardBuilder);
  assert.strictEqual(builderCalled, true, "常规态下必须执行卡片构建回调");
  assert.deepStrictEqual(normalTooltip, { value: "### 贵州茅台 (sh600519)\n| 最新价格 | ¥1850.00 |" });

  // 3. 与 isDisplayMasked 联动真值表交叉验证（老板键与 maskMode 协同）
  const scenarios = [
    { bossKeyActive: true,  userMaskMode: false, expectMasked: true },
    { bossKeyActive: true,  userMaskMode: true,  expectMasked: true },
    { bossKeyActive: false, userMaskMode: true,  expectMasked: true },
    { bossKeyActive: false, userMaskMode: false, expectMasked: false },
  ];

  for (const s of scenarios) {
    const masked = isDisplayMasked(s.bossKeyActive, s.userMaskMode);
    assert.strictEqual(masked, s.expectMasked);
    let called = false;
    const res = resolveStockTooltip(masked, () => {
      called = true;
      return "CARD_CONTENT";
    });
    if (s.expectMasked) {
      assert.strictEqual(res, MASKED_TOOLTIP_TEXT);
      assert.strictEqual(called, false);
    } else {
      assert.strictEqual(res, "CARD_CONTENT");
      assert.strictEqual(called, true);
    }
  }
});

void test("shouldBlockNodeCommand - 命令面板入口（pinToTop / removeItem / setAlert）脱敏态拦截守卫", () => {
  // 命令面板触发的这三个入口在无 node 分支时会展示含真实名称/代码/现价的 QuickPick。
  // 防御策略：只要老板键激活，或在无 node 时 maskMode 开启，即静默拒绝防自曝；有 node 传入（右键菜单）在 maskMode 下正常放行。
  const scenarios = [
    { bossKeyActive: true,  maskMode: false, hasNode: false, shouldBlock: true,  desc: "老板键激活（无 node）" },
    { bossKeyActive: true,  maskMode: false, hasNode: true,  shouldBlock: true,  desc: "老板键激活（有 node）" },
    { bossKeyActive: false, maskMode: true,  hasNode: false, shouldBlock: true,  desc: "简洁展示模式开启（无 node，命令面板入口）" },
    { bossKeyActive: false, maskMode: true,  hasNode: true,  shouldBlock: false, desc: "简洁展示模式开启（有 node，自选树右键入口）" },
    { bossKeyActive: true,  maskMode: true,  hasNode: false, shouldBlock: true,  desc: "老板键 + 简洁模式同时激活（无 node）" },
    { bossKeyActive: true,  maskMode: true,  hasNode: true,  shouldBlock: true,  desc: "老板键 + 简洁模式同时激活（有 node）" },
    { bossKeyActive: false, maskMode: false, hasNode: false, shouldBlock: false, desc: "常规未脱敏态（无 node）" },
    { bossKeyActive: false, maskMode: false, hasNode: true,  shouldBlock: false, desc: "常规未脱敏态（有 node）" },
  ];

  for (const s of scenarios) {
    const blocked = shouldBlockNodeCommand(s.bossKeyActive, s.maskMode, s.hasNode);
    assert.strictEqual(blocked, s.shouldBlock, `${s.desc} 时入口应${s.shouldBlock ? "被拦截" : "放行"}`);
  }
});

void test("proxyUrl - 代理地址规范化与协议纠偏", () => {
  // 1. https 纠偏为 http（杜绝 EPROTO）
  assert.strictEqual(validateAndNormalizeProxyUrl("https://127.0.0.1:7890"), "http://127.0.0.1:7890");
  assert.strictEqual(validateAndNormalizeProxyUrl("https://localhost:10808"), "http://localhost:10808");

  // 2. socks5 / socks 剥离协议并规整为可用 http 代理形式（杜绝静默降级为 10808）
  assert.strictEqual(validateAndNormalizeProxyUrl("socks5://127.0.0.1:7890"), "http://127.0.0.1:7890");
  assert.strictEqual(validateAndNormalizeProxyUrl("socks://127.0.0.1:2080"), "http://127.0.0.1:2080");

  // 3. 无协议裸 host:port
  assert.strictEqual(validateAndNormalizeProxyUrl("127.0.0.1:7890"), "http://127.0.0.1:7890");
  assert.strictEqual(validateAndNormalizeProxyUrl("http://127.0.0.1:7890"), "http://127.0.0.1:7890");

  // 4. 企业/隧道代理账密认证信息保留（杜绝 407）
  assert.strictEqual(validateAndNormalizeProxyUrl("http://user:pass@proxy.corp.com:8080"), "http://user:pass@proxy.corp.com:8080");

  // 5. 远程代理不带端口时采用工业标准 8080
  assert.strictEqual(validateAndNormalizeProxyUrl("http://proxy.corp.com"), "http://proxy.corp.com:8080");

  // 6. 用户显式指定的各类代理端口必须严格忠实保留（杜绝历史 10808 哨兵篡改）
  const parsed10808 = parseProxy("http://127.0.0.1:10808");
  assert.strictEqual(parsed10808.port, 10808);
  assert.strictEqual(parsed10808.host, "127.0.0.1");

  const parsed7890 = parseProxy("http://127.0.0.1:7890");
  assert.strictEqual(parsed7890.port, 7890);

  const parsed2080 = parseProxy("http://127.0.0.1:2080");
  assert.strictEqual(parsed2080.port, 2080);

  // 7. 测试 resetProxyCache 能正确重置，在无系统代理环境变量时空值默认回退到 10808
  resetProxyCache();
  const originalHttpProxy = process.env.HTTP_PROXY;
  const originalHttpsProxy = process.env.HTTPS_PROXY;
  const originalAllProxy = process.env.ALL_PROXY;
  delete process.env.HTTP_PROXY;
  delete process.env.http_proxy;
  delete process.env.HTTPS_PROXY;
  delete process.env.https_proxy;
  delete process.env.ALL_PROXY;
  delete process.env.all_proxy;

  try {
    assert.strictEqual(validateAndNormalizeProxyUrl(""), "http://127.0.0.1:10808");

    // 8. 测试纯数字端口号解析
    assert.strictEqual(validateAndNormalizeProxyUrl("10808"), "http://127.0.0.1:10808");
    assert.strictEqual(validateAndNormalizeProxyUrl("7890"), "http://127.0.0.1:7890");
  } finally {
    if (originalHttpProxy !== undefined) process.env.HTTP_PROXY = originalHttpProxy;
    if (originalHttpsProxy !== undefined) process.env.HTTPS_PROXY = originalHttpsProxy;
    if (originalAllProxy !== undefined) process.env.ALL_PROXY = originalAllProxy;
  }
});

void test("getSystemProxyUrl - 操作系统环境变量代理自适应回退", () => {
  const savedEnv: Record<string, string | undefined> = {
    HTTP_PROXY: process.env.HTTP_PROXY,
    http_proxy: process.env.http_proxy,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    https_proxy: process.env.https_proxy,
    ALL_PROXY: process.env.ALL_PROXY,
    all_proxy: process.env.all_proxy,
  };

  const clearProxyEnv = () => {
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;
    resetProxyCache();
  };

  try {
    // 1. 无环境变量时返回 undefined
    clearProxyEnv();
    assert.strictEqual(getSystemProxyUrl(), undefined);
    assert.strictEqual(validateAndNormalizeProxyUrl(""), "http://127.0.0.1:10808");

    // 2. 支持 HTTPS_PROXY 标准环境变量
    clearProxyEnv();
    process.env.HTTPS_PROXY = "http://127.0.0.1:7890";
    assert.strictEqual(getSystemProxyUrl(), "http://127.0.0.1:7890");
    assert.strictEqual(validateAndNormalizeProxyUrl(""), "http://127.0.0.1:7890");

    // 3. 支持小写 http_proxy 与局域网/软路由 IP 代理
    clearProxyEnv();
    process.env.http_proxy = "http://192.168.1.100:7890";
    assert.strictEqual(getSystemProxyUrl(), "http://192.168.1.100:7890");
    assert.strictEqual(validateAndNormalizeProxyUrl(""), "http://192.168.1.100:7890");

    // 4. 支持 ALL_PROXY 及其 socks5 协议规整化
    clearProxyEnv();
    process.env.ALL_PROXY = "socks5://127.0.0.1:1080";
    assert.strictEqual(getSystemProxyUrl(), "http://127.0.0.1:1080");
    assert.strictEqual(validateAndNormalizeProxyUrl(""), "http://127.0.0.1:1080");

    // 5. 用户显式配置具有最高优先级（即使配置了系统环境变量，用户自定义端口仍获优先）
    assert.strictEqual(validateAndNormalizeProxyUrl("7897"), "http://127.0.0.1:7897");
    assert.strictEqual(validateAndNormalizeProxyUrl("http://127.0.0.1:2080"), "http://127.0.0.1:2080");
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v !== undefined) {
        process.env[k] = v;
      } else {
        delete process.env[k];
      }
    }
    resetProxyCache();
  }
});

void test("resolveItemAssetType & 分组板块判定策略（先看 item.type，彻底杜绝组名子串误伤）", () => {
  // 1. 显式 type 拥有最高裁决权（First-Class Citizen）
  assert.strictEqual(resolveItemAssetType({ symbol: "BTCUSDT", type: "CRYPTO" }, "crypto-us"), "CRYPTO");
  assert.strictEqual(resolveItemAssetType({ symbol: "ETHUSDT", type: "CRYPTO" }, "USDT仓位"), "CRYPTO");
  assert.strictEqual(resolveItemAssetType({ symbol: "SOLUSDT", type: "CRYPTO" }, "我的HK账户"), "CRYPTO");
  assert.strictEqual(resolveItemAssetType({ symbol: "AAPL", type: "US_STOCK" }, "USDT仓位"), "US_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "00700", type: "HK_STOCK" }, "美股自选"), "HK_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "600519", type: "A_SHARE" }, "我的港股"), "A_SHARE");

  // 2. 无显式 type 时，特征与上下文启发兜底
  assert.strictEqual(resolveItemAssetType({ symbol: "BTCUSDT" }, "临时组"), "CRYPTO");
  assert.strictEqual(resolveItemAssetType({ symbol: "00700" }, "临时组"), "HK_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "600519" }, "临时组"), "A_SHARE");
  assert.strictEqual(resolveItemAssetType({ symbol: "AAPL" }, "临时组"), "US_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "BRK.B" }, "临时组"), "US_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "BF.B" }, "临时组"), "US_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "BRK-B" }, "临时组"), "US_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "0x28cd1fc7b6eebf46b59001ff49c9d14f8bb97777" }, "临时组"), "ALPHA_TOKEN");

  // 3. 空组名场景启发（组内无 item 时）
  assert.strictEqual(resolveItemAssetType({ symbol: "" }, "USDT仓位"), "CRYPTO");
  assert.strictEqual(resolveItemAssetType({ symbol: "" }, "crypto-us"), "CRYPTO");
  assert.strictEqual(resolveItemAssetType({ symbol: "" }, "我的HK账户"), "HK_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "" }, "美股精选"), "US_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "" }, "A股主板"), "A_SHARE");

  // 4. 中立空组（无 item，组名无特定市场关键词）返回 undefined，不被误绑至 CRYPTO，权重归 100
  assert.strictEqual(resolveItemAssetType({ symbol: "" }, "自选"), undefined);
  assert.strictEqual(resolveItemAssetType({ symbol: "" }, "默认分组"), undefined);
  assert.strictEqual(resolveItemAssetType({ symbol: "" }, "我的关注"), undefined);

  // 5. 无 type 时，代码绝对强特征必须超越组名（物理属性优先，杜绝组名反客为主）
  assert.strictEqual(resolveItemAssetType({ symbol: "sh600519" }, "Binance长线"), "A_SHARE");
  assert.strictEqual(resolveItemAssetType({ symbol: "hk00700" }, "crypto-us"), "HK_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "usAAPL" }, "Binance长线"), "US_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "sh600519" }, "我的HK账户"), "A_SHARE");
  assert.strictEqual(resolveItemAssetType({ symbol: "600519" }, "美股精选"), "A_SHARE");
  assert.strictEqual(resolveItemAssetType({ symbol: "00700" }, "币安现货"), "HK_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: ".DJI" }, "A股主板"), "US_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "BTCUSDT" }, "A股主板"), "CRYPTO");
  assert.strictEqual(resolveItemAssetType({ symbol: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" }, "美股精选"), "ALPHA_TOKEN");

  // 6. 特别校验：以 US 开头的真实币对（如 USTCUSDT, USDPUSDT, USUALUSDT）必须判定为 CRYPTO，彻底免疫美股 us 前缀截胡
  assert.strictEqual(resolveItemAssetType({ symbol: "USTCUSDT" }, "美股精选"), "CRYPTO");
  assert.strictEqual(resolveItemAssetType({ symbol: "USTCUSDT" }, "临时组"), "CRYPTO");
  assert.strictEqual(resolveItemAssetType({ symbol: "USDPUSDT" }, "美股精选"), "CRYPTO");
  assert.strictEqual(resolveItemAssetType({ symbol: "USDPUSDT" }, "临时组"), "CRYPTO");
  assert.strictEqual(resolveItemAssetType({ symbol: "USUALUSDT" }, "美股精选"), "CRYPTO");
  assert.strictEqual(resolveItemAssetType({ symbol: "USDCUSDT" }, "美股精选"), "CRYPTO");
  assert.strictEqual(resolveItemAssetType({ symbol: "usAAPL" }, "临时组"), "US_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "usAMD" }, "临时组"), "US_STOCK");
  assert.strictEqual(resolveItemAssetType({ symbol: "us.NVDA" }, "临时组"), "US_STOCK");

  // 7. 非法 item 入口防御（null / undefined / 非字符串 symbol 不抛错）
  assert.strictEqual(resolveItemAssetType(null, "A股主板"), undefined);
  assert.strictEqual(resolveItemAssetType(undefined, "A股主板"), undefined);
  assert.strictEqual(resolveItemAssetType({ symbol: 123 as any }, "临时组"), undefined);
});

void test("getWatchlistFingerprint - 自选指纹与防重复全量网络请求校验", () => {
  // 1. 基准配置
  const baseWatchlist = {
    "A股": [
      { symbol: "sh600030", name: "中信证券", type: "A_SHARE" },
      { symbol: "sz000001", name: "平安银行", type: "A_SHARE" },
    ],
    "Binance": [
      { symbol: "BTCUSDT", name: "BTC", type: "CRYPTO" },
      { symbol: "ETHUSDT", name: "ETH", type: "CRYPTO" },
    ],
  };

  const baseFingerprint = getWatchlistFingerprint(baseWatchlist);
  assert.strictEqual(baseFingerprint, "btcusdt,ethusdt,sh600030,sz000001");

  // 2. 同组拖拽重排测试：[sh600030, sz000001] -> [sz000001, sh600030]，指纹必须严格不变（阻止无意义打网）
  const reorderedWatchlist = {
    "A股": [
      { symbol: "sz000001", name: "平安银行", type: "A_SHARE" },
      { symbol: "sh600030", name: "中信证券", type: "A_SHARE" },
    ],
    "Binance": [
      { symbol: "ETHUSDT", name: "ETH", type: "CRYPTO" },
      { symbol: "BTCUSDT", name: "BTC", type: "CRYPTO" },
    ],
  };
  assert.strictEqual(getWatchlistFingerprint(reorderedWatchlist), baseFingerprint);

  // 3. 跨组移动测试：将 sh600030 挪到新分组 "自选1"，总监控集合不变，指纹必须严格不变
  const crossGroupWatchlist = {
    "A股": [
      { symbol: "sz000001", name: "平安银行", type: "A_SHARE" },
    ],
    "自选1": [
      { symbol: "sh600030", name: "中信证券", type: "A_SHARE" },
    ],
    "Binance": [
      { symbol: "BTCUSDT", name: "BTC", type: "CRYPTO" },
      { symbol: "ETHUSDT", name: "ETH", type: "CRYPTO" },
    ],
  };
  assert.strictEqual(getWatchlistFingerprint(crossGroupWatchlist), baseFingerprint);

  // 4. 大小写与首尾多余空白脱敏
  const messyWatchlist = {
    "A股": [
      { symbol: " SH600030  " },
      { symbol: "sz000001" },
    ],
    "Binance": [
      { symbol: "btcusdt" },
      { symbol: " ethusdt " },
    ],
  };
  assert.strictEqual(getWatchlistFingerprint(messyWatchlist), baseFingerprint);

  // 5. 组内重复标的去重
  const duplicateWatchlist = {
    "A股": [
      { symbol: "sh600030" },
      { symbol: "sh600030" },
      { symbol: "sz000001" },
    ],
    "Binance": [
      { symbol: "BTCUSDT" },
      { symbol: "ETHUSDT" },
    ],
  };
  assert.strictEqual(getWatchlistFingerprint(duplicateWatchlist), baseFingerprint);

  // 6. 新增标的：加入 SOLUSDT，指纹必须改变（正确触发重新打网）
  const addedWatchlist = {
    ...baseWatchlist,
    "Binance": [
      ...baseWatchlist["Binance"],
      { symbol: "SOLUSDT", name: "SOL", type: "CRYPTO" },
    ],
  };
  assert.notStrictEqual(getWatchlistFingerprint(addedWatchlist), baseFingerprint);
  assert.strictEqual(getWatchlistFingerprint(addedWatchlist), "btcusdt,ethusdt,sh600030,solusdt,sz000001");

  // 7. 删除标的：移除 sz000001，指纹必须改变
  const removedWatchlist = {
    "A股": [
      { symbol: "sh600030", name: "中信证券", type: "A_SHARE" },
    ],
    "Binance": baseWatchlist["Binance"],
  };
  assert.notStrictEqual(getWatchlistFingerprint(removedWatchlist), baseFingerprint);
  assert.strictEqual(getWatchlistFingerprint(removedWatchlist), "btcusdt,ethusdt,sh600030");

  // 8. 边界条件容错：空对象、空分组、空 symbol
  assert.strictEqual(getWatchlistFingerprint({}), "");
  assert.strictEqual(getWatchlistFingerprint({ "空组": [], "另一组": [{ symbol: "" }] }), "");

  // 9. 脏数据防御：null 元素、非字符串 symbol 不抛错，仍能提取合法标的
  assert.strictEqual(
    getWatchlistFingerprint({ "A股": [null, { symbol: 123 }, { symbol: "sh600030" }] }),
    "sh600030"
  );

  // 10. 纯字符串标的兼容：纯字符串数组与对象混合配置均可提取指纹
  assert.strictEqual(
    getWatchlistFingerprint({ "A股": ["sh600030", { symbol: "sz000001" }], "美股": ["AAPL"] }),
    "aapl,sh600030,sz000001"
  );
});

void test("reorderWatchlist - 自选标的同组重排与跨组位移测试", () => {
  const initList = () => ({
    "A股": [
      { symbol: "sh600030", name: "中信证券" },
      { symbol: "sz000839", name: "国安股份" },
      { symbol: "sz002385", name: "大北农" },
    ],
    "Binance": [
      { symbol: "BTCUSDT", name: "BTC" },
      { symbol: "ETHUSDT", name: "ETH" },
    ],
  });

  // 1. 同组向下拖拽：把 sh600030 拖到 sz000839 后面
  const downRes = reorderWatchlist(initList(), "A股", "sh600030", "A股", "sz000839");
  assert.ok(downRes);
  assert.deepStrictEqual(downRes["A股"].map((x) => x.symbol), ["sz000839", "sh600030", "sz002385"]);

  // 2. 同组向上拖拽：把 sz002385 拖到 sh600030 前面
  const upRes = reorderWatchlist(initList(), "A股", "sz002385", "A股", "sh600030");
  assert.ok(upRes);
  assert.deepStrictEqual(upRes["A股"].map((x) => x.symbol), ["sz002385", "sh600030", "sz000839"]);

  // 3. 拖到组名（targetSymbol 未传）：将 sz002385 拖到组名置顶
  const pinRes = reorderWatchlist(initList(), "A股", "sz002385", "A股");
  assert.ok(pinRes);
  assert.deepStrictEqual(pinRes["A股"].map((x) => x.symbol), ["sz002385", "sh600030", "sz000839"]);

  // 4. 跨组拖拽拦截：禁止跨组移动到其它组，必须返回 null
  const crossRes = reorderWatchlist(initList(), "A股", "sh600030", "Binance", "ETHUSDT");
  assert.strictEqual(crossRes, null);

  // 5. 跨组拖拽到其他组名拦截：必须返回 null
  const crossAppend = reorderWatchlist(initList(), "A股", "sh600030", "Binance");
  assert.strictEqual(crossAppend, null);

  // 6. 异常与无效保护：源标的不存在、组不存在、拖到自己上面
  assert.strictEqual(reorderWatchlist(initList(), "不存在的组", "sh600030", "A股"), null);
  assert.strictEqual(reorderWatchlist(initList(), "A股", "non_existent", "A股", "sz000839"), null);
  assert.strictEqual(reorderWatchlist(initList(), "A股", "sh600030", "A股", "sh600030"), null);
});

void test("batchReorderWatchlist - 多选批量拖拽原子重排测试", () => {
  const initList = () => ({
    "A股": [
      { symbol: "sh600030", name: "中信证券" },
      { symbol: "sz000839", name: "国安股份" },
      { symbol: "sz002385", name: "大北农" },
      { symbol: "sh601398", name: "工商银行" },
    ],
    "Binance": [
      { symbol: "BTCUSDT", name: "BTC" },
      { symbol: "ETHUSDT", name: "ETH" },
      { symbol: "SOLUSDT", name: "SOL" },
    ],
  });

  // 1. 同组向下批量拖拽：将 [sh600030, sz000839] 拖到 sz002385 后面
  const downRes = batchReorderWatchlist(
    initList(),
    [
      { sourceGroup: "A股", sourceSymbol: "sh600030" },
      { sourceGroup: "A股", sourceSymbol: "sz000839" },
    ],
    "A股",
    "sz002385"
  );
  assert.ok(downRes);
  assert.deepStrictEqual(
    downRes["A股"].map((x) => x.symbol),
    ["sz002385", "sh600030", "sz000839", "sh601398"]
  );

  // 2. 同组向上批量拖拽：将 [sz002385, sh601398] 拖到 sh600030 前面
  const upRes = batchReorderWatchlist(
    initList(),
    [
      { sourceGroup: "A股", sourceSymbol: "sz002385" },
      { sourceGroup: "A股", sourceSymbol: "sh601398" },
    ],
    "A股",
    "sh600030"
  );
  assert.ok(upRes);
  assert.deepStrictEqual(
    upRes["A股"].map((x) => x.symbol),
    ["sz002385", "sh601398", "sh600030", "sz000839"]
  );

  // 3. 同组拖到组名（targetSymbol 未传）：整批置顶
  const pinRes = batchReorderWatchlist(
    initList(),
    [
      { sourceGroup: "A股", sourceSymbol: "sz000839" },
      { sourceGroup: "A股", sourceSymbol: "sh601398" },
    ],
    "A股"
  );
  assert.ok(pinRes);
  assert.deepStrictEqual(
    pinRes["A股"].map((x) => x.symbol),
    ["sz000839", "sh601398", "sh600030", "sz002385"]
  );

  // 4. 跨组批量拖拽拦截：禁止跨组移入其它组，必须返回 null
  const crossTargetRes = batchReorderWatchlist(
    initList(),
    [
      { sourceGroup: "A股", sourceSymbol: "sh600030" },
      { sourceGroup: "A股", sourceSymbol: "sz000839" },
    ],
    "Binance",
    "ETHUSDT"
  );
  assert.strictEqual(crossTargetRes, null);

  // 5. 跨组批量移动到其他组名拦截：必须返回 null
  const crossAppendRes = batchReorderWatchlist(
    initList(),
    [
      { sourceGroup: "A股", sourceSymbol: "sh600030" },
      { sourceGroup: "A股", sourceSymbol: "sz000839" },
    ],
    "Binance"
  );
  assert.strictEqual(crossAppendRes, null);

  // 6. 自拖拽保护（Self-drop guard）：目标标的本身在移动项中，必须返回 null 防止产生脏数据
  const selfDropRes = batchReorderWatchlist(
    initList(),
    [
      { sourceGroup: "A股", sourceSymbol: "sh600030" },
      { sourceGroup: "A股", sourceSymbol: "sz000839" },
    ],
    "A股",
    "sh600030"
  );
  assert.strictEqual(selfDropRes, null);

  // 7. 空项保护与非法目标组保护
  assert.strictEqual(batchReorderWatchlist(initList(), [], "A股"), null);
  assert.strictEqual(
    batchReorderWatchlist(initList(), [{ sourceGroup: "A股", sourceSymbol: "sh600030" }], "不存在的分组"),
    null
  );
  assert.strictEqual(
    batchReorderWatchlist(initList(), [{ sourceGroup: "不存在的组", sourceSymbol: "sh600030" }], "A股"),
    null
  );
});

void test("pruneQuoteCache - 活跃集对齐与死缓存回收测试 (Active-Set Prune)", () => {
  const activeWatchlist = {
    "A股": [
      { symbol: "sh600030", name: "中信证券" },
      { symbol: "sh600519", name: "贵州茅台" }, // 闭市标的，必须保留收盘价
    ],
    "Binance": [
      { symbol: "BTCUSDT", name: "BTC" },
    ],
    "Alpha": [
      { symbol: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", name: "WBNB", id: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" },
    ],
  };

  const quoteCache = new Map<string, any>();

  // 1. 灌入当前在自选中的标的缓存（含多别名注册）
  quoteCache.set("sh600030", { symbol: "sh600030", name: "中信证券", price: 28.5 });
  quoteCache.set("sh600519", { symbol: "sh600519", name: "贵州茅台", price: 1780.0 });
  quoteCache.set("btcusdt", { symbol: "BTCUSDT", name: "BTC", price: 65000 });
  quoteCache.set("BTCUSDT", { symbol: "BTCUSDT", name: "BTC", price: 65000 });
  // Alpha 代币合约与代币名
  quoteCache.set("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", {
    symbol: "WBNB",
    id: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    price: 580,
  });
  quoteCache.set("WBNB", {
    symbol: "WBNB",
    id: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    price: 580,
  });

  // 2. 灌入历史死标的缓存（用户之前添加过、现已删除或替换的垃圾 Meme 币 / 旧股票）
  quoteCache.set("0x1111111111111111111111111111111111111111", {
    symbol: "DEADCOIN",
    id: "0x1111111111111111111111111111111111111111",
    price: 0.000001,
  });
  quoteCache.set("DEADCOIN", {
    symbol: "DEADCOIN",
    id: "0x1111111111111111111111111111111111111111",
    price: 0.000001,
  });
  quoteCache.set("sz000002", { symbol: "sz000002", name: "万科A", price: 9.2 });

  assert.strictEqual(quoteCache.size, 9);

  // 3. 执行活跃集对齐修剪
  const prunedCount = pruneQuoteCache(activeWatchlist, quoteCache);

  // 验证死缓存被彻底清理：0x1111..., DEADCOIN, sz000002 共 3 条
  assert.strictEqual(prunedCount, 3);
  assert.strictEqual(quoteCache.size, 6);

  // 验证死缓存完全不存在
  assert.strictEqual(quoteCache.has("0x1111111111111111111111111111111111111111"), false);
  assert.strictEqual(quoteCache.has("DEADCOIN"), false);
  assert.strictEqual(quoteCache.has("sz000002"), false);

  // 验证当前自选中的所有标的（包括闭市的贵州茅台、Alpha 合约与名称）均完整保留
  assert.strictEqual(quoteCache.get("sh600030")?.price, 28.5);
  assert.strictEqual(quoteCache.get("sh600519")?.price, 1780.0);
  assert.strictEqual(quoteCache.get("btcusdt")?.price, 65000);
  assert.strictEqual(quoteCache.get("BTCUSDT")?.price, 65000);
  assert.strictEqual(quoteCache.get("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c")?.price, 580);
  assert.strictEqual(quoteCache.get("WBNB")?.price, 580);

  // 4. 测试一键清空自选场景：所有缓存必须被安全回收
  const prunedAllCount = pruneQuoteCache({}, quoteCache);
  assert.strictEqual(prunedAllCount, 6);
  assert.strictEqual(quoteCache.size, 0);

  // 5. 空 Map 容错保护
  assert.strictEqual(pruneQuoteCache(activeWatchlist, new Map()), 0);
});

void test("extractTargetsFromWatchlist - 标的分桶过滤与闭市跳过测试", () => {
  const mockWatchlist = {
    "混合自选": [
      { symbol: "sh600519", type: "A_SHARE" },
      { symbol: "00700", type: "HK_STOCK" },
      { symbol: "AAPL", type: "US_STOCK" },
      { symbol: "BTCUSDT", type: "CRYPTO" },
      { symbol: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", type: "ALPHA_TOKEN" },
    ],
    "美股专属": [
      { symbol: "TSLA", type: "US_STOCK" },
      { symbol: "NVDA", type: "US_STOCK" },
    ],
  };

  // 1. 全开状态分桶提取
  const allTargets = extractTargetsFromWatchlist(mockWatchlist);
  assert.deepStrictEqual(allTargets.funds, []);
  assert.deepStrictEqual(allTargets.aShares, ["sh600519"]);
  assert.deepStrictEqual(allTargets.hkStocks, ["00700"]);
  assert.deepStrictEqual(allTargets.usStocks, ["AAPL", "TSLA", "NVDA"]);
  assert.deepStrictEqual(allTargets.cryptos, ["BTCUSDT"]);
  assert.deepStrictEqual(allTargets.bscTokens, ["0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"]);

  // 2. 板块关闭测试：禁用 A 股与加密货币
  const disabledTargets = extractTargetsFromWatchlist(mockWatchlist, {
    aShareEnabled: false,
    binanceEnabled: false,
  });
  assert.deepStrictEqual(disabledTargets.funds, []);
  assert.deepStrictEqual(disabledTargets.aShares, []);
  assert.deepStrictEqual(disabledTargets.cryptos, []);
  assert.strictEqual(disabledTargets.usStocks.length, 3);
  assert.strictEqual(disabledTargets.hkStocks.length, 1);

  // 3. 闭市跳过测试：A 股闭市跳过，美股不跳过
  const marketClosedTargets = extractTargetsFromWatchlist(mockWatchlist, {
    skipAShare: true,
    skipUSStock: false,
  });
  assert.deepStrictEqual(marketClosedTargets.aShares, []);
  assert.deepStrictEqual(marketClosedTargets.usStocks, ["AAPL", "TSLA", "NVDA"]);

  // 4. 特定分组提取：仅提取 "美股专属" 分组
  const groupSpecificTargets = extractTargetsFromWatchlist(mockWatchlist, {
    specificGroupName: "美股专属",
  });
  assert.deepStrictEqual(groupSpecificTargets.usStocks, ["TSLA", "NVDA"]);
  assert.deepStrictEqual(groupSpecificTargets.aShares, []);
  assert.deepStrictEqual(groupSpecificTargets.cryptos, []);

  // 5. 代理离线挂起跳过测试：skipBinance / skipAlpha
  const proxySuspendedTargets = extractTargetsFromWatchlist(mockWatchlist, {
    skipBinance: true,
    skipAlpha: true,
  });
  assert.deepStrictEqual(proxySuspendedTargets.cryptos, []);
  assert.deepStrictEqual(proxySuspendedTargets.bscTokens, []);
  assert.deepStrictEqual(proxySuspendedTargets.aShares, ["sh600519"]);
  assert.deepStrictEqual(proxySuspendedTargets.hkStocks, ["00700"]);
  assert.deepStrictEqual(proxySuspendedTargets.usStocks, ["AAPL", "TSLA", "NVDA"]);
});

void test("extractStatusBarQuotes - 底部状态栏49标的全量轮播与分板块开关即时过滤测试", () => {
  // 构建符合真实生产配置的 49 个预设标的 Watchlist
  // A股: 10, 港股: 6, 美股: 9, Binance: 12, Alpha: 12 = 49
  const defaultWatchlist = {
    "A股": [
      { symbol: "sh600030", name: "中信证券", type: "A_SHARE" },
      { symbol: "sz000839", name: "国安股份", type: "A_SHARE" },
      { symbol: "sz002385", name: "大北农", type: "A_SHARE" },
      { symbol: "sh603686", name: "福龙马", type: "A_SHARE" },
      { symbol: "sz002867", name: "周大生", type: "A_SHARE" },
      { symbol: "sh603031", name: "安孚科技", type: "A_SHARE" },
      { symbol: "sz000977", name: "浪潮信息", type: "A_SHARE" },
      { symbol: "sh688545", name: "兴福电子", type: "A_SHARE" },
      { symbol: "sh688584", name: "上海合晶", type: "A_SHARE" },
      { symbol: "sz301293", name: "三博脑科", type: "A_SHARE" },
    ],
    "港股": [
      { symbol: "hk06030", name: "中信证券", type: "HK_STOCK" },
      { symbol: "hk00700", name: "腾讯控股", type: "HK_STOCK" },
      { symbol: "hk03690", name: "美团-W", type: "HK_STOCK" },
      { symbol: "hk09988", name: "阿里巴巴-SW", type: "HK_STOCK" },
      { symbol: "hk00981", name: "中芯国际", type: "HK_STOCK" },
      { symbol: "hk01810", name: "小米集团-W", type: "HK_STOCK" },
    ],
    "美股": [
      { symbol: "usAAPL", name: "苹果", type: "US_STOCK" },
      { symbol: "usNVDA", name: "英伟达", type: "US_STOCK" },
      { symbol: "usTSLA", name: "特斯拉", type: "US_STOCK" },
      { symbol: "usNET", name: "Cloudflare", type: "US_STOCK" },
      { symbol: "usTSM", name: "台积电", type: "US_STOCK" },
      { symbol: "usAMD", name: "超威半导体", type: "US_STOCK" },
      { symbol: "usAVGO", name: "博通", type: "US_STOCK" },
      { symbol: "usARM", name: "安谋", type: "US_STOCK" },
      { symbol: "usIXIC", name: "纳斯达克综合指数", type: "US_STOCK" },
    ],
    "Binance": [
      { symbol: "BTCUSDT", name: "BTC/USDT", type: "CRYPTO" },
      { symbol: "ETHUSDT", name: "ETH/USDT", type: "CRYPTO" },
      { symbol: "ETCUSDT", name: "ETC/USDT", type: "CRYPTO" },
      { symbol: "SOLUSDT", name: "SOL/USDT", type: "CRYPTO" },
      { symbol: "BNBUSDT", name: "BNB/USDT", type: "CRYPTO" },
      { symbol: "ARBUSDT", name: "ARB/USDT", type: "CRYPTO" },
      { symbol: "OPUSDT", name: "OP/USDT", type: "CRYPTO" },
      { symbol: "APTUSDT", name: "APT/USDT", type: "CRYPTO" },
      { symbol: "DOGEUSDT", name: "DOGE/USDT", type: "CRYPTO" },
      { symbol: "ORDIUSDT", name: "ORDI/USDT", type: "CRYPTO" },
      { symbol: "ASTERUSDT", name: "ASTER/USDT", type: "CRYPTO" },
      { symbol: "LUNAUSDT", name: "LUNA/USDT", type: "CRYPTO" },
    ],
    "Alpha": [
      { symbol: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", name: "WBNB", type: "ALPHA_TOKEN" },
      { symbol: "0x55d398326f99059fF775485246999027B3197955", name: "USDT", type: "ALPHA_TOKEN" },
      { symbol: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", name: "USDC", type: "ALPHA_TOKEN" },
      { symbol: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", name: "ETH", type: "ALPHA_TOKEN" },
      { symbol: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", name: "BTCB", type: "ALPHA_TOKEN" },
      { symbol: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", name: "CAKE", type: "ALPHA_TOKEN" },
      { symbol: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", name: "BUSD", type: "ALPHA_TOKEN" },
      { symbol: "0x14016E85a25a55715135CE47bB891e4a1E4B9245", name: "XVS", type: "ALPHA_TOKEN" },
      { symbol: "0x570A5D26f7708833242CE6daC7601804157d3710", name: "BAKE", type: "ALPHA_TOKEN" },
      { symbol: "0x8f0528cE5eF7B51152A59745bEfDD91D97091d2F", name: "ALPACA", type: "ALPHA_TOKEN" },
      { symbol: "0x0D8Ce2A99Bb6e3B7Db580eD848240e4a0F9aE153", name: "FIL", type: "ALPHA_TOKEN" },
      { symbol: "0x1CE0c482752f2571085744e793707090449174fb", name: "DOT", type: "ALPHA_TOKEN" },
    ],
  };

  // 模拟从 initial load 填充的 quoteCache
  const mockCache = new Map<string, any>();
  for (const [_, items] of Object.entries(defaultWatchlist)) {
    for (const it of items) {
      mockCache.set(it.symbol, {
        id: it.symbol,
        name: it.name,
        symbol: it.symbol,
        type: it.type,
        price: 100,
        changePercent: 1.5,
      });
    }
  }

  // 1. 默认情况下（全开状态），应完整返回全部 49 个标的参与轮播（即使此时市场闭市跳过了周期打网）
  const fullQuotes = extractStatusBarQuotes(defaultWatchlist, mockCache);
  assert.strictEqual(fullQuotes.length, 49, "默认应有 49 个标的参与底部轮播");

  // 2. 关闭 A 股底部轮播（aShare.statusBar = false）
  const noAshareQuotes = extractStatusBarQuotes(defaultWatchlist, mockCache, {
    aShare: { enabled: true, statusBar: false },
  });
  assert.strictEqual(noAshareQuotes.length, 39, "关闭 A 股轮播后应有 39 个标的 (49 - 10)");
  assert.ok(!noAshareQuotes.some((q) => q.type === "A_SHARE"), "结果中不应包含任何 A 股标的");

  // 3. 关闭 Binance 底部轮播（binance.statusBar = false）
  const noBinanceQuotes = extractStatusBarQuotes(defaultWatchlist, mockCache, {
    binance: { enabled: true, statusBar: false },
  });
  assert.strictEqual(noBinanceQuotes.length, 37, "关闭 Binance 轮播后应有 37 个标的 (49 - 12)");
  assert.ok(!noBinanceQuotes.some((q) => q.type === "CRYPTO"), "结果中不应包含任何加密货币标的");

  // 4. 关闭整个板块（aShare.enabled = false）
  const aShareDisabled = extractStatusBarQuotes(defaultWatchlist, mockCache, {
    aShare: { enabled: false, statusBar: true },
  });
  assert.strictEqual(aShareDisabled.length, 39, "A股板块禁用后不应参与轮播");

  // 5. 5个板块轮播全部关闭时，应返回空数组并隐藏状态栏
  const allDisabled = extractStatusBarQuotes(defaultWatchlist, mockCache, {
    aShare: { enabled: true, statusBar: false },
    hkStock: { enabled: true, statusBar: false },
    usStock: { enabled: true, statusBar: false },
    binance: { enabled: true, statusBar: false },
    alpha: { enabled: true, statusBar: false },
  });
  assert.strictEqual(allDisabled.length, 0, "全部板块轮播关闭后应返回空数组");

  // 6. 一键清空自选列表后（watchlist 为空对象）
  const emptyQuotes = extractStatusBarQuotes({}, mockCache);
  assert.strictEqual(emptyQuotes.length, 0, "清空自选列表后应返回空数组并隐藏状态栏");

  // 7. 重复标的去重保护
  const dupWatchlist = {
    "组1": [{ symbol: "BTCUSDT", type: "CRYPTO" }],
    "组2": [{ symbol: "BTCUSDT", type: "CRYPTO" }],
  };
  const dupQuotes = extractStatusBarQuotes(dupWatchlist, mockCache);
  assert.strictEqual(dupQuotes.length, 1, "跨组同标的代码应自动去重");

  // 8. 状态栏总开关测试（statusBarEnabled = false 必须直接返回空数组，令状态栏即时隐藏）
  const disabledTotalQuotes = extractStatusBarQuotes(defaultWatchlist, mockCache, {
    statusBarEnabled: false,
  });
  assert.strictEqual(disabledTotalQuotes.length, 0, "状态栏轮播总开关关闭时，应直接返回空数组令状态栏立即隐藏");

  // 9. 联动逻辑判定测试：5个全开 -> 全局总开关为 true；任意一个关闭 -> 全局总开关为 false，但其余正常轮播
  const calcMaster = (a: boolean, h: boolean, u: boolean, b: boolean, al: boolean) => a && h && u && b && al;
  assert.strictEqual(calcMaster(true, true, true, true, true), true, "5个板块全部开启轮播时，全部标的参与轮播总开关为 true");
  assert.strictEqual(calcMaster(false, true, true, true, true), false, "A股关闭轮播时，全部标的参与轮播总开关为 false");
  assert.strictEqual(calcMaster(true, false, true, true, true), false, "港股关闭轮播时，全部标的参与轮播总开关为 false");
  assert.strictEqual(calcMaster(true, true, false, true, true), false, "美股关闭轮播时，全部标的参与轮播总开关为 false");
  assert.strictEqual(calcMaster(true, true, true, false, true), false, "Binance关闭轮播时，全部标的参与轮播总开关为 false");
  assert.strictEqual(calcMaster(true, true, true, true, false), false, "Alpha关闭轮播时，全部标的参与轮播总开关为 false");
});

void test("proxyPort - 端口校验与提取规则", () => {
  function validatePort(val: any): number | null {
    let raw = String(val || "").trim();
    const match = raw.match(/:(\d{1,5})/);
    if (match) {
      raw = match[1];
    }
    const port = parseInt(raw, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return null;
    }
    return port;
  }

  // 合法端口数字
  assert.strictEqual(validatePort(10808), 10808);
  assert.strictEqual(validatePort(7890), 7890);
  assert.strictEqual(validatePort("10808"), 10808);
  assert.strictEqual(validatePort(1), 1);
  assert.strictEqual(validatePort(65535), 65535);

  // 粘贴完整地址时智能提取端口
  assert.strictEqual(validatePort("http://127.0.0.1:10808"), 10808);
  assert.strictEqual(validatePort("127.0.0.1:7890"), 7890);
  assert.strictEqual(validatePort("localhost:10809"), 10809);

  // 非法端口校验拦截
  assert.strictEqual(validatePort(""), null);
  assert.strictEqual(validatePort("0"), null);
  assert.strictEqual(validatePort(-1), null);
  assert.strictEqual(validatePort(65536), null);
  assert.strictEqual(validatePort("abc"), null);
  assert.strictEqual(validatePort("99999"), null);
});

void test("extractContractAddressFromUrl - 网页URL合约提取与校验", () => {
  // DexScreener Solana URL
  const dexSolUrl = "https://dexscreener.com/solana/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R";
  assert.strictEqual(extractContractAddressFromUrl(dexSolUrl), "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R");

  // DexScreener BSC EVM URL
  const dexBscUrl = "https://dexscreener.com/bsc/0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
  assert.strictEqual(extractContractAddressFromUrl(dexBscUrl), "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c");

  // Pump.fun URL
  const pumpUrl = "https://pump.fun/coin/7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
  assert.strictEqual(extractContractAddressFromUrl(pumpUrl), "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr");

  // GeckoTerminal URL
  const geckoUrl = "https://www.geckoterminal.com/solana/pools/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R";
  assert.strictEqual(extractContractAddressFromUrl(geckoUrl), "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R");

  // BscScan / Etherscan Token URL
  const bscScanUrl = "https://bscscan.com/token/0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
  assert.strictEqual(extractContractAddressFromUrl(bscScanUrl), "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c");
  const ethTokenUrl = "https://etherscan.io/token/0x55d398326f99059ff775485246999027b3197955";
  assert.strictEqual(extractContractAddressFromUrl(ethTokenUrl), "0x55d398326f99059ff775485246999027b3197955");

  // 交易哈希链接（Etherscan/BscScan tx 等 64位 hex）：绝不能被截断提取成假代币
  const ethTxUrl = "https://etherscan.io/tx/0x90f8bf944c659c253d8e107d6b50b076b92316bc3b42d80ceea30b93b5819d33";
  assert.strictEqual(extractContractAddressFromUrl(ethTxUrl), null, "Etherscan 交易链接不能被提取为代币合约");
  const bscTxUrl = "https://bscscan.com/tx/0x90f8bf944c659c253d8e107d6b50b076b92316bc3b42d80ceea30b93b5819d33";
  assert.strictEqual(extractContractAddressFromUrl(bscTxUrl), null, "BscScan 交易链接不能被提取为代币合约");

  // validateAndParseInput 直接支持粘贴 URL
  const parsed = validateAndParseInput(dexSolUrl);
  assert.strictEqual(parsed.error, undefined);
  assert.strictEqual(parsed.parsed?.type, "ALPHA_TOKEN");
  assert.strictEqual(parsed.parsed?.symbol, "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R");
  assert.strictEqual(parsed.parsed?.defaultGroup, "Alpha");

  // validateAndParseInput 对 Tx Hash 给出友好精准拦截提示
  const txParsed = validateAndParseInput(ethTxUrl);
  assert.ok(txParsed.error && txParsed.error.includes("Tx Hash"), "交易链接应明确提示为 Tx Hash");
  const rawTxHash = "0x90f8bf944c659c253d8e107d6b50b076b92316bc3b42d80ceea30b93b5819d33";
  const rawTxParsed = validateAndParseInput(rawTxHash);
  assert.ok(rawTxParsed.error && rawTxParsed.error.includes("Tx Hash"), "裸交易哈希应明确提示为 Tx Hash");
});

void test("extractStatusBarQuotes - 状态栏总控与分板块开关精准过滤", () => {
  const sampleWatchlist = {
    "A股": [
      { symbol: "sh600519", name: "贵州茅台", type: "A_SHARE" },
      { symbol: "sz000001", name: "平安银行", type: "A_SHARE" },
    ],
    "港股": [
      { symbol: "hk00700", name: "腾讯控股", type: "HK_STOCK" },
    ],
    "美股": [
      { symbol: "AAPL", name: "Apple", type: "US_STOCK" },
    ],
    "Binance": [
      { symbol: "BTCUSDT", name: "Bitcoin", type: "CRYPTO" },
    ],
    "Alpha": [
      { symbol: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", name: "WBNB", type: "ALPHA_TOKEN" },
    ],
  };

  const cache = new Map<string, any>();
  cache.set("sh600519", { symbol: "sh600519", name: "贵州茅台", price: 1800, changePercent: 1.2 });
  cache.set("sz000001", { symbol: "sz000001", name: "平安银行", price: 12, changePercent: -0.5 });
  cache.set("hk700", { symbol: "hk00700", name: "腾讯控股", price: 380, changePercent: 2.1 });
  cache.set("aapl", { symbol: "AAPL", name: "Apple", price: 230, changePercent: 0.8 });
  cache.set("btcusdt", { symbol: "BTCUSDT", name: "Bitcoin", price: 65000, changePercent: 3.5 });
  cache.set("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", { symbol: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", name: "WBNB", price: 580, changePercent: 4.0 });

  // 1. 全开启状态：返回所有 6 个标的
  const allOpen = extractStatusBarQuotes(sampleWatchlist, cache, {
    statusBarEnabled: true,
    aShare:  { enabled: true, statusBar: true },
    hkStock: { enabled: true, statusBar: true },
    usStock: { enabled: true, statusBar: true },
    binance: { enabled: true, statusBar: true },
    alpha:   { enabled: true, statusBar: true },
  });
  assert.strictEqual(allOpen.length, 6);

  // 2. 总控关闭：立即返回空数组
  const masterDisabled = extractStatusBarQuotes(sampleWatchlist, cache, {
    statusBarEnabled: false,
    aShare:  { enabled: true, statusBar: true },
    hkStock: { enabled: true, statusBar: true },
    usStock: { enabled: true, statusBar: true },
    binance: { enabled: true, statusBar: true },
    alpha:   { enabled: true, statusBar: true },
  });
  assert.strictEqual(masterDisabled.length, 0);

  // 3. 仅关闭 A 股轮播（用户报告的场景）：总控依然开启，A股标的退出，其余4个板块标的正常参与轮播
  const aShareOff = extractStatusBarQuotes(sampleWatchlist, cache, {
    statusBarEnabled: true,
    aShare:  { enabled: true, statusBar: false },
    hkStock: { enabled: true, statusBar: true },
    usStock: { enabled: true, statusBar: true },
    binance: { enabled: true, statusBar: true },
    alpha:   { enabled: true, statusBar: true },
  });
  assert.strictEqual(aShareOff.length, 4);
  assert.ok(!aShareOff.some(q => q.symbol === "sh600519" || q.symbol === "sz000001"));
  assert.ok(aShareOff.some(q => q.symbol === "hk00700"));
  assert.ok(aShareOff.some(q => q.symbol === "AAPL"));
  assert.ok(aShareOff.some(q => q.symbol === "BTCUSDT"));
  assert.ok(aShareOff.some(q => q.symbol === "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"));

  // 4. 所有分板块均关闭轮播：返回 0 条
  const allSubOff = extractStatusBarQuotes(sampleWatchlist, cache, {
    statusBarEnabled: true,
    aShare:  { enabled: true, statusBar: false },
    hkStock: { enabled: true, statusBar: false },
    usStock: { enabled: true, statusBar: false },
    binance: { enabled: true, statusBar: false },
    alpha:   { enabled: true, statusBar: false },
  });
  assert.strictEqual(allSubOff.length, 0);
});

void test("computeStatusBarEnabled - 状态栏总控与分板块开关聚合判定", () => {
  // 1. 用户显式设置 statusBar.enabled: false，无论分板块如何开启，状态栏必须彻底关闭
  assert.strictEqual(computeStatusBarEnabled(false, true), false, "显式关闭总控时，即使有活跃板块也必须关闭");
  assert.strictEqual(computeStatusBarEnabled(false, false), false, "显式关闭总控时，无活跃板块也必须关闭");

  // 2. 用户显式设置 statusBar.enabled: true
  assert.strictEqual(computeStatusBarEnabled(true, true), true, "显式开启总控且有活跃板块时，状态栏开启");
  assert.strictEqual(computeStatusBarEnabled(true, false), false, "显式开启总控但无活跃板块时，状态栏关闭");

  // 3. 用户未显式配置（undefined，默认开启状态）
  assert.strictEqual(computeStatusBarEnabled(undefined, true), true, "未显式配置且有活跃板块时，状态栏默认开启");
  assert.strictEqual(computeStatusBarEnabled(undefined, false), false, "未显式配置但无活跃板块时，状态栏默认关闭");
});

void test("AlertManager - 价格上限突破预警 (above > threshold)", () => {
  const manager = new AlertManager();
  const config: any = {
    alerts: {
      sh600519: { symbol: "sh600519", name: "贵州茅台", above: 1800, enabled: true },
    },
    alertNotificationMode: "notification",
    alertCooldownMinutes: 15,
  };

  const quotes: any[] = [
    { id: "sh600519", symbol: "sh600519", name: "贵州茅台", price: 1850, changePercent: 2.5 },
    { id: "sz000001", symbol: "sz000001", name: "平安银行", price: 12, changePercent: 0.5 },
  ];

  const events = manager.checkQuotes(quotes, config);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].symbolKey, "sh600519");
  assert.strictEqual(events[0].type, "above");
  assert.strictEqual(events[0].currentValue, 1850);
  assert.strictEqual(events[0].thresholdValue, 1800);

  // 未突破上限不触发
  manager.resetCooldown();
  const belowThresholdQuotes: any[] = [
    { id: "sh600519", symbol: "sh600519", name: "贵州茅台", price: 1799, changePercent: -0.5 },
  ];
  const noEvents = manager.checkQuotes(belowThresholdQuotes, config);
  assert.strictEqual(noEvents.length, 0);
});

void test("AlertManager - 价格下限跌破预警 (below < threshold)", () => {
  const manager = new AlertManager();
  const config: any = {
    alerts: {
      btcusdt: { symbol: "BTCUSDT", name: "比特币", below: 60000, enabled: true },
    },
    alertNotificationMode: "notification",
    alertCooldownMinutes: 15,
  };

  const breachedQuotes: any[] = [
    { id: "BTCUSDT", symbol: "BTCUSDT", name: "比特币", price: 59500, changePercent: -3.2 },
  ];
  const events = manager.checkQuotes(breachedQuotes, config);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, "below");
  assert.strictEqual(events[0].currentValue, 59500);
  assert.strictEqual(events[0].thresholdValue, 60000);

  // 未跌破下限不触发
  manager.resetCooldown();
  const safeQuotes: any[] = [
    { id: "BTCUSDT", symbol: "BTCUSDT", name: "比特币", price: 60001, changePercent: 0.1 },
  ];
  const noEvents = manager.checkQuotes(safeQuotes, config);
  assert.strictEqual(noEvents.length, 0);
});

void test("AlertManager - 单日剧烈涨跌幅绝对值预警 (|%| >= threshold)", () => {
  const manager = new AlertManager();
  const config: any = {
    alerts: {
      aapl: { symbol: "AAPL", name: "Apple", changePercent: 5.0, enabled: true },
    },
    alertNotificationMode: "notification",
    alertCooldownMinutes: 15,
  };

  // 剧烈上涨
  const rallyQuotes: any[] = [
    { id: "AAPL", symbol: "AAPL", name: "Apple", price: 200, changePercent: 6.2 },
  ];
  const rallyEvents = manager.checkQuotes(rallyQuotes, config);
  assert.strictEqual(rallyEvents.length, 1);
  assert.strictEqual(rallyEvents[0].type, "changePercent");
  assert.strictEqual(rallyEvents[0].currentValue, 6.2);

  // 剧烈暴跌 (| -7.5% | >= 5.0%)
  manager.resetCooldown();
  const crashQuotes: any[] = [
    { id: "AAPL", symbol: "AAPL", name: "Apple", price: 170, changePercent: -7.5 },
  ];
  const crashEvents = manager.checkQuotes(crashQuotes, config);
  assert.strictEqual(crashEvents.length, 1);
  assert.strictEqual(crashEvents[0].type, "changePercent");
  assert.strictEqual(crashEvents[0].currentValue, -7.5);

  // 正常波动不触发
  manager.resetCooldown();
  const normalQuotes: any[] = [
    { id: "AAPL", symbol: "AAPL", name: "Apple", price: 185, changePercent: 3.1 },
  ];
  const normalEvents = manager.checkQuotes(normalQuotes, config);
  assert.strictEqual(normalEvents.length, 0);
});

void test("AlertManager - 冷却防轰炸机制与静音拦截", () => {
  const manager = new AlertManager();
  const config: any = {
    alerts: {
      sh600519: { symbol: "sh600519", name: "贵州茅台", above: 1800, enabled: true },
    },
    alertNotificationMode: "notification",
    alertCooldownMinutes: 15,
  };

  const quotes: any[] = [
    { id: "sh600519", symbol: "sh600519", name: "贵州茅台", price: 1850, changePercent: 2.5 },
  ];

  // 第一次触发
  const first = manager.checkQuotes(quotes, config);
  assert.strictEqual(first.length, 1);

  // 15分钟冷静期内再次检测同一标的：被内存冷却拦截，返回 0 条
  const second = manager.checkQuotes(quotes, config);
  assert.strictEqual(second.length, 0, "冷却期内应彻底静音拦截");

  // 手动重置冷却后，恢复触发
  manager.resetCooldown();
  const third = manager.checkQuotes(quotes, config);
  assert.strictEqual(third.length, 1, "重置冷却后恢复触发");

  // 手动设置静音
  manager.mute("sh600519", 15);
  const muted = manager.checkQuotes(quotes, config);
  assert.strictEqual(muted.length, 0, "手动静音后不触发");
});

void test("AlertManager - 老板键激活状态一票否决与静音守卫", () => {
  let isBossActive = true;
  const mockStatusBar: any = {
    isBossKeyActive: () => isBossActive,
    flashAlert: () => {},
  };
  const manager = new AlertManager(mockStatusBar);
  const config: any = {
    alerts: {
      sh600519: { symbol: "sh600519", name: "贵州茅台", above: 1800, enabled: true },
    },
    alertNotificationMode: "both",
    alertCooldownMinutes: 15,
  };

  const quotes: any[] = [
    { id: "sh600519", symbol: "sh600519", name: "贵州茅台", price: 1900, changePercent: 5.0 },
  ];

  // 老板键激活时：一票否决，绝对静音
  const suppressed = manager.checkQuotes(quotes, config);
  assert.strictEqual(suppressed.length, 0, "老板键状态下必须完全禁止触发预警");

  // 老板键退出后：恢复正常监测
  isBossActive = false;
  const resumed = manager.checkQuotes(quotes, config);
  assert.strictEqual(resumed.length, 1, "老板键退出后正常响应");
});

void test("AlertManager - 状态栏与通知通道联动分发", () => {
  let flashedText = "";
  const mockStatusBar: any = {
    isBossKeyActive: () => false,
    flashAlert: (text: string) => { flashedText = text; },
  };
  const manager = new AlertManager(mockStatusBar);

  // 1. 仅通知通道 (notification)：不闪烁状态栏
  const configNotification: any = {
    alerts: {
      sh600519: { symbol: "sh600519", name: "贵州茅台", above: 1800, enabled: true },
    },
    alertNotificationMode: "notification",
    alertCooldownMinutes: 15,
  };
  manager.checkQuotes([{ id: "sh600519", symbol: "sh600519", name: "贵州茅台", type: "A_SHARE", price: 1850, changePercent: 1.0 }], configNotification);
  assert.strictEqual(flashedText, "", "notification 模式下不应触发状态栏闪烁");

  // 2. 状态栏通道 (statusBarOnly)：触发状态栏闪烁
  manager.resetCooldown();
  const configStatusBarOnly: any = {
    ...configNotification,
    alertNotificationMode: "statusBarOnly",
  };
  manager.checkQuotes([{ id: "sh600519", symbol: "sh600519", name: "贵州茅台", type: "A_SHARE", price: 1850, changePercent: 1.0 }], configStatusBarOnly);
  assert.ok(flashedText.includes("突破预警") && flashedText.includes("贵州茅台"), "statusBarOnly 模式下必须调用 flashAlert");

  // 3. 简洁展示模式 (maskMode)：状态栏闪光必须被静默拦截，避免顶掉伪装文本
  manager.resetCooldown();
  flashedText = "";
  const configMasked: any = {
    ...configNotification,
    alertNotificationMode: "both",
    maskMode: true,
  };
  manager.checkQuotes([{ id: "sh600519", symbol: "sh600519", name: "贵州茅台", type: "A_SHARE", price: 1850, changePercent: 1.0 }], configMasked);
  assert.strictEqual(flashedText, "", "简洁展示模式下状态栏闪光必须完全静默，避免顶掉伪装文本");
});

void test("AlertManager - 禁用开关与空配置容错保护", () => {
  const manager = new AlertManager();

  // 规则被禁用 enabled: false
  const configDisabled: any = {
    alerts: {
      sh600519: { symbol: "sh600519", name: "贵州茅台", above: 1800, enabled: false },
    },
    alertNotificationMode: "notification",
    alertCooldownMinutes: 15,
  };
  const disabledEvents = manager.checkQuotes([{ id: "sh600519", symbol: "sh600519", name: "贵州茅台", type: "A_SHARE", price: 1900, changePercent: 2.0 }], configDisabled);
  assert.strictEqual(disabledEvents.length, 0, "enabled: false 规则不应被触发");

  // 空预警字典或空行情
  assert.strictEqual(manager.checkQuotes([], configDisabled).length, 0);
  assert.strictEqual(manager.checkQuotes([{ symbol: "sh600519" } as any], { alerts: {} } as any).length, 0);
});

void test("AlertManager - 币对斜杠 (SOL/USDT vs SOLUSDT) 跨格式匹配预警", () => {
  const manager = new AlertManager();
  const config: any = {
    alerts: {
      solusdt: { symbol: "SOL/USDT", name: "SOL", below: 110, enabled: true },
    },
    alertNotificationMode: "notification",
    alertCooldownMinutes: 15,
  };

  const quotes: any[] = [
    { id: "SOLUSDT", symbol: "SOLUSDT", name: "SOL", price: 100, changePercent: -3.63 },
  ];

  const events = manager.checkQuotes(quotes, config);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, "below");
  assert.strictEqual(events[0].currentValue, 100);
});

void test("resolveItemDisplayName - 侧边栏与设置面板标的名称一致性与优先级解析", () => {
  // 1. 用户显式配置自定义名称（如 usNET 配置为 Cloudflare），即便腾讯接口返回机器译名“科赋锐”，仍应锁定展示 Cloudflare
  const cfName = resolveItemDisplayName("Cloudflare", "usNET", { name: "科赋锐", symbol: "NET" });
  assert.strictEqual(cfName, "Cloudflare", "应优先使用用户配置的 Cloudflare");

  // 2. 指数全称（usIXIC 配置为 纳斯达克综合指数），即便接口缩写为“纳斯达克”，应保留全称
  const ixicName = resolveItemDisplayName("纳斯达克综合指数", "usIXIC", { name: "纳斯达克", symbol: "IXIC" });
  assert.strictEqual(ixicName, "纳斯达克综合指数", "应保留纳斯达克综合指数全称");

  // 3. 用户添加标的时未填名称或名称与代码相同（如 600030），行情到达后应智能使用接口标准名称（中信证券）
  const stockName = resolveItemDisplayName("600030", "600030", { name: "中信证券", symbol: "600030" });
  assert.strictEqual(stockName, "中信证券", "未自定义名称时应回退到实时行情标准名称");

  // 4. 用户给加密货币自定义昵称（BTCUSDT 备注为 大饼），应显示自定义昵称
  const btcCustom = resolveItemDisplayName("大饼", "BTCUSDT", { name: "BTC/USDT", symbol: "BTCUSDT" });
  assert.strictEqual(btcCustom, "大饼", "自定义币种昵称应生效");

  // 5. 标的名称为币对斜杠格式（BTC/USDT 与 BTCUSDT 属于同一标的），非自定义昵称，行情到达后使用 BTC/USDT
  const btcNormal = resolveItemDisplayName("BTC/USDT", "BTCUSDT", { name: "BTC/USDT", symbol: "BTCUSDT" });
  assert.strictEqual(btcNormal, "BTC/USDT", "标准币对格式正常使用");

  // 6. 行情未到达且无自定义名称时，兜底展示代码
  const fallbackSym = resolveItemDisplayName("000001", "000001", undefined);
  assert.strictEqual(fallbackSym, "000001", "行情未到达时兜底展示代码");
});

void test("resolveTrendColors - 涨跌配色习惯切换 (greenUpRedDown vs redUpGreenDown) 与颜色脱敏", () => {
  // 1. 默认国际/加密/美股习惯：greenUpRedDown (绿涨红跌)
  const intlUp = resolveTrendColors(2.5, false, "greenUpRedDown");
  assert.strictEqual(intlUp.colorHint, "🟢", "国际惯例上涨应为绿色圆点");
  assert.strictEqual(intlUp.themeColor, "charts.green", "国际惯例上涨主题色应为 charts.green");
  assert.strictEqual(intlUp.isUp, true);

  const intlDown = resolveTrendColors(-1.8, false, "greenUpRedDown");
  assert.strictEqual(intlDown.colorHint, "🔴", "国际惯例下跌应为红色圆点");
  assert.strictEqual(intlDown.themeColor, "charts.red", "国际惯例下跌主题色应为 charts.red");
  assert.strictEqual(intlDown.isUp, false);

  const intlZero = resolveTrendColors(0, false, "greenUpRedDown");
  assert.strictEqual(intlZero.colorHint, "🟢", "平盘视为非负绿色");
  assert.strictEqual(intlZero.themeColor, "charts.green");

  // 2. 国内 A 股传统金融盘面习惯：redUpGreenDown (红涨绿跌)
  const cnUp = resolveTrendColors(5.0, false, "redUpGreenDown");
  assert.strictEqual(cnUp.colorHint, "🔴", "国内传统上涨应为红色圆点");
  assert.strictEqual(cnUp.themeColor, "charts.red", "国内传统上涨主题色应为 charts.red");
  assert.strictEqual(cnUp.isUp, true);

  const cnDown = resolveTrendColors(-3.2, false, "redUpGreenDown");
  assert.strictEqual(cnDown.colorHint, "🟢", "国内传统下跌应为绿色圆点");
  assert.strictEqual(cnDown.themeColor, "charts.green", "国内传统下跌主题色应为 charts.green");
  assert.strictEqual(cnDown.isUp, false);

  const cnZero = resolveTrendColors(0, false, "redUpGreenDown");
  assert.strictEqual(cnZero.colorHint, "🔴", "平盘视为非负红色");
  assert.strictEqual(cnZero.themeColor, "charts.red");

  // 3. 颜色脱敏模式：colorNeutral 为 true 时，不暴露红绿
  const neutralUp = resolveTrendColors(4.0, true, "redUpGreenDown");
  assert.strictEqual(neutralUp.colorHint, "•", "脱敏模式应返回中性点号");
  assert.strictEqual(neutralUp.themeColor, undefined, "脱敏模式无主题色，使用编辑器默认前景文本色");

  const neutralDown = resolveTrendColors(-4.0, true, "greenUpRedDown");
  assert.strictEqual(neutralDown.colorHint, "•", "脱敏模式应返回中性点号");
  assert.strictEqual(neutralDown.themeColor, undefined, "脱敏模式无主题色");
});

void test("marketHours - 节假日离线日历与休市精准判定", () => {
  // 1. A股法定休市日拦截（2026国庆节周四 10:00，非周末，通常为交易时段）
  const aNationalDayUtc = new Date("2026-10-01T02:00:00Z"); // 北京时间 2026-10-01 10:00
  assert.strictEqual(isAShareHoliday(aNationalDayUtc), true, "2026-10-01 应被识别为 A 股国庆休市日");
  assert.strictEqual(isAShareMarketOpen(aNationalDayUtc), false, "A股国庆法定休市日应一票否决判定为闭市");

  // A股春节（2026-02-18 周三 10:00）
  const aSpringFestivalUtc = new Date("2026-02-18T02:00:00Z"); // 北京时间 2026-02-18 10:00
  assert.strictEqual(isAShareHoliday(aSpringFestivalUtc), true, "2026-02-18 应为 A 股春节休市日");
  assert.strictEqual(isAShareMarketOpen(aSpringFestivalUtc), false, "春节休市日应判定为闭市");

  // 普通交易日（2026-09-07 周一 10:00）
  const aNormalDayUtc = new Date("2026-09-07T02:00:00Z");
  assert.strictEqual(isAShareHoliday(aNormalDayUtc), false, "普通工作日不应误判为休市");
  assert.strictEqual(isAShareMarketOpen(aNormalDayUtc), true);

  // 2. 港股休市日与正常开市日判定（含清明复活节顺延、圣诞不顺延及总数守卫）
  const hkGoodFridayUtc = new Date("2026-04-03T02:00:00Z");
  assert.strictEqual(isHKHoliday(hkGoodFridayUtc), true, "2026-04-03 应为港股受难节休市日");
  assert.strictEqual(isHKMarketOpen(hkGoodFridayUtc), false, "港股节假日应判定为闭市");

  // 2026复活节翌日增补假期（清明顺延补休）2026-04-07 周二 10:00
  const hkEasterTueUtc = new Date("2026-04-07T02:00:00Z");
  assert.strictEqual(isHKHoliday(hkEasterTueUtc), true, "2026-04-07 应为港股清明复活节顺延补休日");
  assert.strictEqual(isHKMarketOpen(hkEasterTueUtc), false, "2026-04-07 港股顺延休市日应判定为闭市");

  // 2026-12-28 周一 10:00（节后首个工作日落在周六，周一不补休，港交所正常开市）
  const hkDec28TradingUtc = new Date("2026-12-28T02:00:00Z");
  assert.strictEqual(isHKHoliday(hkDec28TradingUtc), false, "2026-12-28 港交所正常开市，严禁误判为休市");
  assert.strictEqual(isHKMarketOpen(hkDec28TradingUtc), true, "2026-12-28 港股盘中应判定为开市");

  // 港股平日休市日数量守卫（2024: 15天, 2025: 15天, 2026: 14天）
  const hk2024Count = Array.from(HK_HOLIDAYS).filter((d) => d.startsWith("2024-")).length;
  const hk2025Count = Array.from(HK_HOLIDAYS).filter((d) => d.startsWith("2025-")).length;
  const hk2026Count = Array.from(HK_HOLIDAYS).filter((d) => d.startsWith("2026-")).length;
  assert.strictEqual(hk2024Count, 15, "2024 年港股休市日应严格为 15 天");
  assert.strictEqual(hk2025Count, 15, "2025 年港股休市日应严格为 15 天");
  assert.strictEqual(hk2026Count, 14, "2026 年港股平日休市日应严格为 14 天");

  // 港股日历不得包含周末日期（杜绝照抄公众假期混入周六周日）
  for (const dateStr of HK_HOLIDAYS) {
    if (dateStr.startsWith("2024-") || dateStr.startsWith("2025-") || dateStr.startsWith("2026-")) {
      const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
      assert.ok(day >= 1 && day <= 5, `港股休市日 ${dateStr} 不得包含周末（星期 ${day}）`);
    }
  }

  // 3. 美股休市日拦截（2026圣诞节 2026-12-25 周五美东 10:30）
  const usChristmasUtc = new Date("2026-12-25T15:30:00Z"); // 冬令时 UTC 15:30 -> NY 10:30
  assert.strictEqual(isUSHoliday(usChristmasUtc), true, "2026-12-25 应为美股圣诞休市日");
  assert.strictEqual(isUSMarketOpen(usChristmasUtc), false, "美股圣诞节应一票否决判定为闭市");

  // 美股马丁路德金日（2026-01-19 周一美东 10:30）
  const usMlkUtc = new Date("2026-01-19T15:30:00Z");
  assert.strictEqual(isUSHoliday(usMlkUtc), true, "2026-01-19 应为美股马丁路德金日");
  assert.strictEqual(isUSMarketOpen(usMlkUtc), false);

  // 美股劳动节（2026-09-07 周一美东 10:30，夏令时 UTC 14:30 -> NY 10:30）
  const usLaborDayUtc = new Date("2026-09-07T14:30:00Z");
  assert.strictEqual(isUSHoliday(usLaborDayUtc), true, "2026-09-07 应为美股劳动节休市日");
  assert.strictEqual(isUSMarketOpen(usLaborDayUtc), false, "美股劳动节应一票否决判定为闭市");

  // 4. 美股 2024~2027 每年法定休市日总数必须严格等于 10 天（杜绝漏提劳动节等惨剧重演）
  for (let year = 2024; year <= MAX_COVERED_HOLIDAY_YEAR; year++) {
    const holidaysInYear = Array.from(US_HOLIDAYS).filter((d) => d.startsWith(`${year}-`));
    assert.strictEqual(holidaysInYear.length, 10, `${year} 年 NYSE/NASDAQ 法定休市日数量应严格为 10 天`);
  }

  // 5. 节假日日历覆盖有效性护栏（防止 2028+ 静默失效）
  assert.strictEqual(MAX_COVERED_HOLIDAY_YEAR >= 2027, true, "节假日日历至少需覆盖至 2027 年");
  assert.strictEqual(checkHolidayCoverage(new Date("2026-06-01")), true, "覆盖年限内应返回 true");
  assert.strictEqual(checkHolidayCoverage(new Date("2028-01-01")), false, "超出覆盖年限应触发护栏拦截并返回 false");
});

void test("evaluateAdaptiveThrottle - 休市与无行情变动自适应降频评估", () => {
  const normalTradingUtc = new Date("2026-09-07T02:00:00Z"); // A股开盘
  const holidayUtc = new Date("2026-10-01T02:00:00Z"); // 国庆休市

  // 1. 股票市场开市期间：维持标准高频，不降频
  const r1 = evaluateAdaptiveThrottle({
    aShareEnabled: true,
    hkStockEnabled: false,
    usStockEnabled: false,
    has24HourCrypto: false,
    hasPriceChanged: false,
    consecutiveUnchangedCount: 1,
    now: normalTradingUtc,
  });
  assert.strictEqual(r1.isThrottled, false, "开市期间应维持高频");
  assert.strictEqual(r1.consecutiveUnchangedCount, 2);

  // 2. 纯股票标的，在节假日休市：检测到休市且无变动，立即降频
  const r2 = evaluateAdaptiveThrottle({
    aShareEnabled: true,
    hkStockEnabled: false,
    usStockEnabled: false,
    has24HourCrypto: false,
    hasPriceChanged: false,
    consecutiveUnchangedCount: 0,
    now: holidayUtc,
  });
  assert.strictEqual(r2.isThrottled, true, "节假日休市纯股票持仓应立即激活降频");
  assert.strictEqual(r2.consecutiveUnchangedCount, 1);

  // 3. 包含 24/7 加密资产：在股市休市期间，前 2 次无变动不降频，连续第 3 次无变动触发降频节能
  let cryptoThrottle = evaluateAdaptiveThrottle({
    aShareEnabled: true,
    hkStockEnabled: false,
    usStockEnabled: false,
    has24HourCrypto: true,
    hasPriceChanged: false,
    consecutiveUnchangedCount: 1,
    now: holidayUtc,
  });
  assert.strictEqual(cryptoThrottle.isThrottled, false, "加密资产第2次无变动暂不降频");
  assert.strictEqual(cryptoThrottle.consecutiveUnchangedCount, 2);

  cryptoThrottle = evaluateAdaptiveThrottle({
    aShareEnabled: true,
    hkStockEnabled: false,
    usStockEnabled: false,
    has24HourCrypto: true,
    hasPriceChanged: false,
    consecutiveUnchangedCount: 2,
    now: holidayUtc,
  });
  assert.strictEqual(cryptoThrottle.isThrottled, true, "连续3次无变动应自适应降频至 60s");
  assert.strictEqual(cryptoThrottle.consecutiveUnchangedCount, 3);

  // 4. 一旦行情发生价格波动：立即恢复标准高频并重置计数
  const rPriceChange = evaluateAdaptiveThrottle({
    aShareEnabled: true,
    hkStockEnabled: false,
    usStockEnabled: false,
    has24HourCrypto: true,
    hasPriceChanged: true,
    consecutiveUnchangedCount: 3,
    now: holidayUtc,
  });
  assert.strictEqual(rPriceChange.isThrottled, false, "价格波动应立即解除降频");
  assert.strictEqual(rPriceChange.consecutiveUnchangedCount, 0, "计数器归零");

  // 5. 基金支持：用户关闭 A 股、仅保留基金，A 股开市期间仍应维持高频，不发生错误降频
  const rFundOnly = evaluateAdaptiveThrottle({
    fundEnabled: true,
    aShareEnabled: false,
    hkStockEnabled: false,
    usStockEnabled: false,
    has24HourCrypto: false,
    hasPriceChanged: false,
    consecutiveUnchangedCount: 1,
    now: normalTradingUtc,
  });
  assert.strictEqual(rFundOnly.isThrottled, false, "仅开基金且在交易时段应维持高频");
  assert.strictEqual(rFundOnly.consecutiveUnchangedCount, 2);
});

void test("chunkArray - 大批量标的切片保护与边界分块校验", () => {
  // 1. 空数组或非法大小容错
  assert.deepStrictEqual(chunkArray([], 40), []);
  assert.deepStrictEqual(chunkArray(["a"], 0), []);
  assert.deepStrictEqual(chunkArray(["a"], -1), []);

  // 2. 数量小于切片大小时单批返回
  const small = ["sh600519", "sz000001", "hk00700"];
  assert.deepStrictEqual(chunkArray(small, 40), [small]);

  // 3. 数量刚好整除
  const exact80 = Array.from({ length: 80 }, (_, i) => `s${i}`);
  const chunks80 = chunkArray(exact80, 40);
  assert.strictEqual(chunks80.length, 2);
  assert.strictEqual(chunks80[0].length, 40);
  assert.strictEqual(chunks80[1].length, 40);

  // 4. 数量有余数（如 95 个标的切片为 40 + 40 + 15）
  const items95 = Array.from({ length: 95 }, (_, i) => `s${i}`);
  const chunks95 = chunkArray(items95, 40);
  assert.strictEqual(chunks95.length, 3);
  assert.strictEqual(chunks95[0].length, 40);
  assert.strictEqual(chunks95[1].length, 40);
  assert.strictEqual(chunks95[2].length, 15);
  assert.deepStrictEqual(chunks95.flat(), items95);
});

void test("decodeGbk - 原生零依赖 GBK 解码与多级容错兜底", () => {
  // 1. 标准 ASCII 腾讯数据流解析（最关键的行情数字/符号验证）
  const asciiData = 'v_sh600519="1~Moutai~600519~1700.50~1680.00~1690.00~1000~...~";';
  const asciiBuf = Buffer.from(asciiData, "utf-8");
  assert.strictEqual(decodeGbk(asciiBuf), asciiData);

  // 2. 支持 ArrayBuffer 与 Uint8Array
  const u8Array = new Uint8Array(asciiBuf);
  assert.strictEqual(decodeGbk(u8Array), asciiData);
  assert.strictEqual(decodeGbk(u8Array.buffer), asciiData);

  // 3. 空 Buffer 边界防护
  assert.strictEqual(decodeGbk(new Uint8Array(0)), "");

  // 4. GBK 编码中文字符（Node.js full-icu 环境测试）
  const gbkDecoder = new TextDecoder("gbk");
  if (gbkDecoder.encoding === "gbk") {
    // 模拟一段 GBK 字节流
    const gbkBytes = new Uint8Array([
      118, 95, 115, 104, 54, 48, 48, 53, 49, 57, 61, 34, 49, 126, // v_sh600519="1~
      0xb9, 0xf3, 0xd4, 0xdd, 0xc3, 0xa9, 0xcc, 0xa8,
      126, 54, 48, 48, 53, 49, 57, 126, 49, 55, 48, 48, 46, 48, 48, 126, 34, 59 // ~600519~1700.00~";
    ]);
    const decoded = decodeGbk(gbkBytes);
    // 验证核心 ASCII 股票代码与数值未损坏
    assert.ok(decoded.includes("600519"));
    assert.ok(decoded.includes("1700.00"));
  }
});

void test("inferAShareExchange - A股交易所前缀精确推断（修复 ETF/债券/深B 被误判为北交所）", () => {
  // ── 1. 沪市：5xxxxx 基金/ETF、6xxxxx 股票、9xxxxx B股 ──
  assert.strictEqual(inferAShareExchange("600519"), "sh"); // 贵州茅台
  assert.strictEqual(inferAShareExchange("601318"), "sh"); // 中国平安
  assert.strictEqual(inferAShareExchange("603686"), "sh"); // 福龙马
  assert.strictEqual(inferAShareExchange("688981"), "sh"); // 中芯国际(科创板)
  assert.strictEqual(inferAShareExchange("510300"), "sh"); // 沪深300ETF
  assert.strictEqual(inferAShareExchange("512880"), "sh"); // 证券ETF
  assert.strictEqual(inferAShareExchange("900901"), "sh"); // 沪市B股

  // ── 2. 深市：0xxxxx 股票、3xxxxx 创业板、1xxxxx 债/基金、2xxxxx B股 ──
  assert.strictEqual(inferAShareExchange("000001"), "sz"); // 平安银行
  assert.strictEqual(inferAShareExchange("002385"), "sz"); // 大北农
  assert.strictEqual(inferAShareExchange("300750"), "sz"); // 宁德时代
  assert.strictEqual(inferAShareExchange("159915"), "sz"); // 创业板ETF（旧逻辑误判为 bj）
  assert.strictEqual(inferAShareExchange("159919"), "sz"); // 沪深300ETF(深)
  assert.strictEqual(inferAShareExchange("200011"), "sz"); // 深市B股（旧逻辑误判为 bj）

  // ── 3. 北交所：43/83/87/88/92 开头 ──
  assert.strictEqual(inferAShareExchange("430047"), "bj");
  assert.strictEqual(inferAShareExchange("830799"), "bj");
  assert.strictEqual(inferAShareExchange("871981"), "bj");
  assert.strictEqual(inferAShareExchange("920002"), "bj");

  // ── 4. 可转债与债券：明确段位优先于首位兜底 ──
  assert.strictEqual(inferAShareExchange("113050"), "sh"); // 沪市可转债
  assert.strictEqual(inferAShareExchange("110043"), "sh"); // 沪市可转债
  assert.strictEqual(inferAShareExchange("123456"), "sz"); // 深市可转债
  assert.strictEqual(inferAShareExchange("127045"), "sz"); // 深市可转债
  assert.strictEqual(inferAShareExchange("128145"), "sz"); // 深市可转债

  // ── 5. 边界与非 6 位输入兜底 ──
  assert.strictEqual(inferAShareExchange(""), "sh");
  assert.strictEqual(inferAShareExchange("60051"), "sh");
  assert.strictEqual(inferAShareExchange("6005199"), "sh");
});

void test("normalizeAShareCode - 输入解析端与行情抓取端前缀规则绝对一致", () => {
  // 已带前缀：原样返回，不做二次推断
  assert.strictEqual(normalizeAShareCode("sh600519"), "sh600519");
  assert.strictEqual(normalizeAShareCode("sz159915"), "sz159915");
  assert.strictEqual(normalizeAShareCode("bj830799"), "bj830799");
  assert.strictEqual(normalizeAShareCode("SH600519"), "sh600519");

  // 裸 6 位代码：按代码段补齐正确交易所
  assert.strictEqual(normalizeAShareCode("600519"), "sh600519");
  assert.strictEqual(normalizeAShareCode("000001"), "sz000001");
  assert.strictEqual(normalizeAShareCode("510300"), "sh510300");
  assert.strictEqual(normalizeAShareCode("159915"), "sz159915");
  assert.strictEqual(normalizeAShareCode("200011"), "sz200011");
  assert.strictEqual(normalizeAShareCode("830799"), "bj830799");

  // 非标准位数：保持历史兜底语义
  assert.strictEqual(normalizeAShareCode("60051"), "sh60051");
  assert.strictEqual(normalizeAShareCode("001"), "sz001");
});

void test("validateAndParseInput - ETF/债券代码端到端前缀正确（P0 回归守卫）", () => {
  // 用户直接输入裸 6 位 ETF / 债券代码，必须落到正确交易所
  assert.strictEqual(validateAndParseInput("159915").parsed?.symbol, "sz159915");
  assert.strictEqual(validateAndParseInput("510300").parsed?.symbol, "sh510300");
  assert.strictEqual(validateAndParseInput("200011").parsed?.symbol, "sz200011");
  assert.strictEqual(validateAndParseInput("113050").parsed?.symbol, "sh113050");
  assert.strictEqual(validateAndParseInput("830799").parsed?.symbol, "bj830799");

  // 上述标的均应被识别为 A 股并归入 A股 分组
  for (const code of ["159915", "510300", "200011", "113050", "830799"]) {
    const res = validateAndParseInput(code);
    assert.strictEqual(res.parsed?.type, "A_SHARE", `${code} 应识别为 A_SHARE`);
    assert.strictEqual(res.parsed?.defaultGroup, "A股", `${code} 应归入 A股 分组`);
  }

  // 用户显式带前缀时，尊重用户输入，不覆盖
  assert.strictEqual(validateAndParseInput("sh600519").parsed?.symbol, "sh600519");
  assert.strictEqual(validateAndParseInput("sz000001").parsed?.symbol, "sz000001");

  // 解析出的 A 股代码再经抓取端规范化，结果必须保持幂等（两端零漂移）
  for (const code of ["159915", "510300", "200011", "113050", "830799", "600519", "000001"]) {
    const parsed = validateAndParseInput(code).parsed!.symbol;
    assert.strictEqual(normalizeAShareCode(parsed), parsed, `${code} 解析与抓取端前缀应完全一致`);
  }
});

void test("DexScreenerService - Alpha 无效/已下架合约地址抑制黑名单机制", async () => {
  const service = new DexScreenerService();
  const deadAddr = "0x000000000000000000000000000000000000dead";

  // 1. 初始状态未被抑制
  assert.strictEqual(service.isAddressSuppressed(deadAddr), false);

  // 2. 标记失效后进入抑制状态（大小写不敏感）
  (service as any).markAddressInvalid(deadAddr);
  assert.strictEqual(service.isAddressSuppressed(deadAddr), true);
  assert.strictEqual(service.isAddressSuppressed(deadAddr.toUpperCase()), true);

  // 3. 处于抑制期内，fetchQuotes 自动短路跳过，不发起任何网络请求，直接返回空数组
  const res = await service.fetchQuotes([deadAddr]);
  assert.deepStrictEqual(res, []);

  // 4. 清理缓存后抑制解除
  service.clearInvalidCache();
  assert.strictEqual(service.isAddressSuppressed(deadAddr), false);

  // 5. 模拟两轮连续返回空（无流动性池）触发自动抑制机制
  let networkCalls = 0;
  (service as any).fetchBatch = async () => {
    networkCalls++;
    return { items: [], networkError: false };
  };

  // 第 1 轮：batch (1) + fallback (1) = 2 calls
  await service.fetchQuotes([deadAddr]);
  assert.strictEqual(service.isAddressSuppressed(deadAddr), false, "第 1 轮失败尚不进入黑名单");

  // 第 2 轮：batch (1) + fallback (1) = 2 calls -> 达到阈值自动进入黑名单
  await service.fetchQuotes([deadAddr]);
  assert.strictEqual(service.isAddressSuppressed(deadAddr), true, "连续 2 轮确认无流动性池后自动进入抑制黑名单");

  // 第 3 轮：被黑名单拦截，networkCalls 计数不再增加
  const callsBefore = networkCalls;
  await service.fetchQuotes([deadAddr]);
  assert.strictEqual(networkCalls, callsBefore, "处于抑制期内的坏地址完全不再打网");
});

void test("Tencent行情解析 - A股/港股/美股 Golden Sample 契约测试与三角数学自洽自愈", () => {
  // ── 1. A 股 Golden Sample 契约解析测试 ──────────────────────────────
  const aService = new AShareService();
  // 模拟标准 50 字段腾讯 A 股报文（以茅台为例）
  const aShareRaw =
    'v_sh600519="1~贵州茅台~600519~1800.00~1780.00~1790.00~25000~13000~12000~1799.00~10~1798.00~20~1797.00~30~1796.00~40~1795.00~50~1801.00~15~1802.00~25~1803.00~35~1804.00~45~1805.00~55~15:00:00/1800.00/25000/S/45000000/1234|~20260915150000~20.00~1.12~1815.00~1785.00~1800.00/25000/45000000~25000~45000~0.85~32.50~~1815.00~1785.00~1.69~22610.00~22610.00~11.50~1958.00~1602.00~0.55";';
  const aItems = aService.parseResponse(aShareRaw);
  assert.strictEqual(aItems.length, 1);
  const a0 = aItems[0];
  assert.strictEqual(a0.id, "sh600519");
  assert.strictEqual(a0.name, "贵州茅台");
  assert.strictEqual(a0.symbol, "600519");
  assert.strictEqual(a0.type, "A_SHARE");
  assert.strictEqual(a0.price, 1800.00);
  assert.strictEqual(a0.prevClose, 1780.00);
  assert.strictEqual(a0.open, 1790.00);
  assert.strictEqual(a0.high, 1815.00);
  assert.strictEqual(a0.low, 1785.00);
  assert.strictEqual(a0.change, 20.00);
  assert.strictEqual(a0.changePercent, 1.12);
  assert.strictEqual(a0.volume, 2500000); // 25000 手 × 100
  assert.strictEqual(a0.turnover, 450000000); // 45000 万元 × 10000
  assert.strictEqual(a0.currency, "CNY");
  // 深度量价指标断言
  assert.strictEqual(a0.turnoverRate, 0.85);
  assert.strictEqual(a0.peTtm, 32.50);
  assert.strictEqual(a0.amplitude, 1.69);
  assert.strictEqual(a0.circulationMarketValue, 2261000000000);
  assert.strictEqual(a0.totalMarketValue, 2261000000000);
  assert.strictEqual(a0.pb, 11.50);
  assert.strictEqual(a0.limitUp, 1958.00);
  assert.strictEqual(a0.limitDown, 1602.00);
  assert.strictEqual(a0.volumeRatio, 0.55);
  assert.strictEqual(a0.avgPrice, undefined);

  // 模拟含均价及大盘指数 edge case（涨跌停为 -1，PB 为 0.00，均价正常）
  const indexRaw =
    'v_sh000001="1~上证指数~000001~3836.53~3830.45~3839.25~12326636~0~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~~20260930093018~6.08~0.16~3839.97~3836.48~3836.53/12326636/17742917639~12326636~1774292~0.02~16.75~~3839.97~3836.48~0.09~601531.73~682529.57~0.00~-1~-1~6.54~0~3837.41";';
  const indexItems = aService.parseResponse(indexRaw);
  assert.strictEqual(indexItems.length, 1);
  const idx0 = indexItems[0];
  assert.strictEqual(idx0.symbol, "000001");
  assert.strictEqual(idx0.turnoverRate, 0.02);
  assert.strictEqual(idx0.peTtm, 16.75);
  assert.strictEqual(idx0.amplitude, 0.09);
  assert.strictEqual(idx0.circulationMarketValue, 601531.73 * 1e8);
  assert.strictEqual(idx0.totalMarketValue, 682529.57 * 1e8);
  // 指数的 -1 与 0.00 必须被过滤为 undefined，均价 3837.41 正常解析
  assert.strictEqual(idx0.pb, undefined);
  assert.strictEqual(idx0.limitUp, undefined);
  assert.strictEqual(idx0.limitDown, undefined);
  assert.strictEqual(idx0.volumeRatio, 6.54);
  assert.strictEqual(idx0.avgPrice, 3837.41);

  // 模拟 A 股字段位移（F.CHANGE_AMT 变为 99999.00 离奇错值），验证三角数学自愈机制
  const aShareShifted =
    'v_sh600519="1~贵州茅台~600519~1800.00~1780.00~1790.00~25000~13000~12000~1799.00~10~1798.00~20~1797.00~30~1796.00~40~1795.00~50~1801.00~15~1802.00~25~1803.00~35~1804.00~45~1805.00~55~15:00:00/1800.00/25000/S/45000000/1234|~20260915150000~99999.00~888.88~1815.00~1785.00~1800.00/25000/45000000~25000~45000~0.85~32.50~~1815.00~1785.00~1.69~22610.00~22610.00~11.50~1958.00~1602.00~0.55";';
  const aHealedItems = aService.parseResponse(aShareShifted);
  assert.strictEqual(aHealedItems.length, 1);
  // 必须自愈为正确的 1800 - 1780 = 20.00 与 1.12%
  assert.strictEqual(aHealedItems[0].change, 20.00);
  assert.strictEqual(aHealedItems[0].changePercent, 1.12);

  // ── 2. 港股 Golden Sample 契约解析测试 ──────────────────────────────
  const hkService = new HKStockService();
  const hkF = new Array(50).fill("0");
  hkF[0] = "100";
  hkF[1] = "腾讯控股";
  hkF[2] = "00700";
  hkF[3] = "380.20";
  hkF[4] = "375.00";
  hkF[5] = "376.00";
  hkF[6] = "15200000";
  hkF[30] = "2026/09/15 16:08:24";
  hkF[31] = "5.20";
  hkF[32] = "1.39";
  hkF[33] = "382.00";
  hkF[34] = "375.20";
  hkF[37] = "5779040000";
  const hkRaw = `v_hk00700="${hkF.join("~")}";`;
  const hkItems = hkService.parseResponse(hkRaw);
  assert.strictEqual(hkItems.length, 1);
  const hk0 = hkItems[0];
  assert.strictEqual(hk0.id, "hk00700");
  assert.strictEqual(hk0.name, "腾讯控股");
  assert.strictEqual(hk0.symbol, "00700");
  assert.strictEqual(hk0.type, "HK_STOCK");
  assert.strictEqual(hk0.price, 380.20);
  assert.strictEqual(hk0.prevClose, 375.00);
  assert.strictEqual(hk0.change, 5.20);
  assert.strictEqual(hk0.changePercent, 1.39);
  assert.strictEqual(hk0.high, 382.00);
  assert.strictEqual(hk0.low, 375.20);
  assert.strictEqual(hk0.turnover, 5779040000);
  assert.strictEqual(hk0.currency, "HKD");

  // 港股字段缺失空值容错
  hkF[31] = "";
  hkF[32] = "0";
  const hkEmptyChange = `v_hk00700="${hkF.join("~")}";`;
  const hkHealed = hkService.parseResponse(hkEmptyChange);
  assert.strictEqual(hkHealed[0].change, 5.20);
  assert.strictEqual(hkHealed[0].changePercent, 1.39);

  // 港股恒生指数规范化与解析契约测试
  assert.strictEqual(hkService.normalizeCode("hkHSI"), "hkHSI");
  assert.strictEqual(hkService.normalizeCode("hsi"), "hkHSI");
  assert.strictEqual(hkService.normalizeCode("hkhsi"), "hkHSI");
  assert.strictEqual(hkService.normalizeCode("hkHSTECH"), "hkHSTECH");
  assert.strictEqual(normalizeSymbolKey("hkHSI"), "hkhsi");
  assert.strictEqual(normalizeSymbolKey("HSI"), "hkhsi");

  const hsiRaw = 'v_hkHSI="100~恒生指数~HSI~24345.22~24271.20~24172.09~18756593~0~0~24345.22~0~0~0~0~0~0~0~0~0~24345.22~0~0~0~0~0~0~0~0~0~0.0~2026/10/13 18:31:26~74.02~0.30~24345.22~23987.77~24345.22~18756593~18756593~0~0~~0~0~1.47~0~0~Hang Seng Index~0~28056.10~22518.00~1.22~-36.45~0~0~0~0~0~0.00~0.00~0.00~0~-5.01~0.27~ZS~~~-1.21~-2.30~-3.17~0.00~0.00~0.00~0.000~~-8.35~HKD~1~";';
  const hsiItems = hkService.parseResponse(hsiRaw);
  assert.strictEqual(hsiItems.length, 1);
  assert.strictEqual(hsiItems[0].name, "恒生指数");
  assert.strictEqual(hsiItems[0].price, 24345.22);
  assert.strictEqual(hsiItems[0].change, 74.02);
  assert.strictEqual(hsiItems[0].changePercent, 0.30);

  // ── 3. 美股 Golden Sample 契约解析测试 ──────────────────────────────
  const usService = new USStockService();
  const usF = new Array(50).fill("0");
  usF[0] = "200";
  usF[1] = "Apple Inc";
  usF[2] = "AAPL.OQ";
  usF[3] = "230.50";
  usF[4] = "225.00";
  usF[5] = "226.00";
  usF[6] = "45000000";
  usF[30] = "2026-09-15 16:00:01";
  usF[31] = "5.50";
  usF[32] = "2.44";
  usF[33] = "232.00";
  usF[34] = "225.50";
  usF[37] = "10372500000";
  const usRaw = `v_usAAPL="${usF.join("~")}";`;
  const usItems = usService.parseResponse(usRaw);
  assert.strictEqual(usItems.length, 1);
  const us0 = usItems[0];
  assert.strictEqual(us0.id, "usAAPL");
  assert.strictEqual(us0.name, "Apple Inc");
  assert.strictEqual(us0.symbol, "AAPL"); // 必须成功剥离后缀 .OQ
  assert.strictEqual(us0.type, "US_STOCK");
  assert.strictEqual(us0.price, 230.50);
  assert.strictEqual(us0.prevClose, 225.00);
  assert.strictEqual(us0.change, 5.50);
  assert.strictEqual(us0.changePercent, 2.44);
  assert.strictEqual(us0.high, 232.00);
  assert.strictEqual(us0.low, 225.50);
  assert.strictEqual(us0.turnover, 10372500000);
  assert.strictEqual(us0.currency, "USD");

  // 美股字段错位自愈测试
  usF[31] = "-999.00";
  usF[32] = "-50.00";
  const usShifted = `v_usAAPL="${usF.join("~")}";`;
  const usHealed = usService.parseResponse(usShifted);
  assert.strictEqual(usHealed[0].change, 5.50);
  assert.strictEqual(usHealed[0].changePercent, 2.44);
});

void test("P2-9 回归 - 腾讯短报文（35~37 字段）成交额保持 undefined，禁止被 || 0 伪装成 0", () => {
  // 三个腾讯服务的字段不足守卫都是 `if (f.length < 35)`，而 `F.TURNOVER` 是**下标 37**，
  // 落在守卫覆盖范围之外：报文长度 35~37 时 `f[37]` 取到的是 `undefined`。
  // §5.5 口径要求「上游未供数」如实保持 `undefined`（卡片渲染为 `--`），
  // 不得用 `parseFloat(...) || 0` 把它伪装成「成交额为 0」——不抛错、不告警，是最难发现的一类静默失真。
  // `noUncheckedIndexedAccess` 未开启（AGENTS.md §4），typecheck 不会提醒这类越界，故由本用例守住。
  const build = (code: string, overrides: Record<number, string>, length: number): string => {
    const fields = new Array<string>(length).fill("0");
    for (const [index, value] of Object.entries(overrides)) fields[Number(index)] = value;
    return `v_${code}="${fields.join("~")}";`;
  };

  const aShareBase: Record<number, string> = {
    0: "1", 1: "贵州茅台", 2: "600519", 3: "1800.00", 4: "1780.00", 5: "1790.00", 6: "25000",
    31: "20.00", 32: "1.12", 33: "1815.00", 34: "1785.00",
  };
  const hkBase: Record<number, string> = {
    0: "100", 1: "腾讯控股", 2: "00700", 3: "378.20", 4: "376.00", 5: "377.00", 6: "12000000",
    31: "2.20", 32: "0.58", 33: "380.00", 34: "375.00",
  };
  const usBase: Record<number, string> = {
    0: "200", 1: "苹果", 2: "AAPL.OQ", 3: "185.92", 4: "185.00", 5: "186.00", 6: "52000000",
    31: "0.92", 32: "0.50", 33: "187.00", 34: "184.50",
  };

  const cases = [
    // A 股成交额单位为「万元」，解析层要 ×10000 归一到「元」；港美股已是元/美元，直通
    { label: "A股", service: new AShareService(), code: "sh600519", base: aShareBase, raw: "45000", expect: 450000000, expectPrice: 1800, expectVolume: 2500000 },
    { label: "港股", service: new HKStockService(), code: "hk00700", base: hkBase, raw: "5779040000", expect: 5779040000, expectPrice: 378.2, expectVolume: 12000000 },
    { label: "美股", service: new USStockService(), code: "usAAPL", base: usBase, raw: "10372500000", expect: 10372500000, expectPrice: 185.92, expectVolume: 52000000 },
  ];

  for (const c of cases) {
    // ① 短报文（恰好通过 `length < 35` 守卫、但读不到下标 37）→ 必须 undefined，不是 0
    const shortItems = c.service.parseResponse(build(c.code, c.base, 35));
    assert.strictEqual(shortItems.length, 1, `${c.label} 35 字段报文应通过守卫并产出 1 条`);
    assert.strictEqual(shortItems[0].turnover, undefined, `${c.label} 守卫外下标越界时成交额必须保持 undefined`);
    // 越界只允许影响「守卫外的位」，守卫内的价格与成交量不得被波及
    assert.strictEqual(shortItems[0].price, c.expectPrice, `${c.label} 短报文价格仍应正常解析`);
    assert.strictEqual(shortItems[0].volume, c.expectVolume, `${c.label} 短报文成交量仍应正常解析`);

    // ② 报文补齐下标 37 → 正常按单位换算出数值
    const fullItems = c.service.parseResponse(build(c.code, { ...c.base, 37: c.raw }, 38));
    assert.strictEqual(fullItems[0].turnover, c.expect, `${c.label} 有供数时成交额应按单位换算解析`);

    // ③ "-1" 是腾讯的「无数据」占位，同样必须落 undefined，而不是 -1 或 0
    const dashItems = c.service.parseResponse(build(c.code, { ...c.base, 37: "-1" }, 38));
    assert.strictEqual(dashItems[0].turnover, undefined, `${c.label} "-1" 占位不得当成数值输出`);
  }
});

void test("escapeHtml - Webview 预警矩阵与 HTML 转义防御校验 (CWE-79)", () => {
  // 基础特殊字符转义
  assert.strictEqual(escapeHtml('<script>alert("xss")</script>'), "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
  assert.strictEqual(escapeHtml("Tom & Jerry's \"Token\""), "Tom &amp; Jerry&#39;s &quot;Token&quot;");
  assert.strictEqual(escapeHtml(null), "");
  assert.strictEqual(escapeHtml(undefined), "");
  assert.strictEqual(escapeHtml(123.45), "123.45");

  // 属性双引号逃逸防御（恶意代币名称注入样式与标签）
  const maliciousTokenName = 'DEX" style="position:fixed;top:0" data-fake="';
  const escaped = escapeHtml(maliciousTokenName);
  assert.strictEqual(escaped.includes('"'), false);
  assert.strictEqual(escaped.includes("&quot;"), true);

  // 标签注入防御（图片外链与内联事件）
  const maliciousImg = '<img src="https://attacker.com/x" onerror="alert(1)">';
  const escapedImg = escapeHtml(maliciousImg);
  assert.strictEqual(escapedImg.includes("<"), false);
  assert.strictEqual(escapedImg.includes(">"), false);
  assert.strictEqual(escapedImg, "&lt;img src=&quot;https://attacker.com/x&quot; onerror=&quot;alert(1)&quot;&gt;");
});

void test("BinanceService - 币安代码归一化、展示名格式化、报文解析与失效抑制黑名单", () => {
  const service = new BinanceService();

  // 1. 代码归一化与前缀处理
  assert.strictEqual(service.normalizeSymbol("btc/usdt"), "BTCUSDT");
  assert.strictEqual(service.normalizeSymbol("eth_usdt"), "ETHUSDT");
  assert.strictEqual(service.normalizeSymbol("sol-usdc"), "SOLUSDC");
  assert.strictEqual(service.normalizeSymbol("DOGEUSDT"), "DOGEUSDT");

  // 2. 展示名称格式化
  assert.strictEqual(service.formatDisplayName("BTCUSDT"), "BTC/USDT");
  assert.strictEqual(service.formatDisplayName("ETHUSDC"), "ETH/USDC");
  assert.strictEqual(service.formatDisplayName("SOLFDUSD"), "SOL/FDUSD");
  assert.strictEqual(service.formatDisplayName("DOGE"), "DOGE");

  // 3. 报文解析 (Golden Sample)
  const goldenSample = {
    symbol: "BTCUSDT",
    priceChange: "1250.50",
    priceChangePercent: "1.95",
    lastPrice: "65432.10",
    openPrice: "64181.60",
    highPrice: "66000.00",
    lowPrice: "64000.00",
    prevClosePrice: "64181.60",
    volume: "12345.678",
    quoteVolume: "807800000.50",
  };

  const parsed = service.parseTickerItem(goldenSample);
  assert.strictEqual(parsed.id, "BTCUSDT");
  assert.strictEqual(parsed.symbol, "BTCUSDT");
  assert.strictEqual(parsed.name, "BTC/USDT");
  assert.strictEqual(parsed.type, "CRYPTO");
  assert.strictEqual(parsed.price, 65432.10);
  assert.strictEqual(parsed.changePercent, 1.95);
  assert.strictEqual(parsed.open, 64181.60);
  assert.strictEqual(parsed.prevClose, 64181.60);
  assert.strictEqual(parsed.high, 66000.00);
  assert.strictEqual(parsed.low, 64000.00);
  assert.strictEqual(parsed.change, 1250.50);
  assert.strictEqual(parsed.volume, 12345.678);
  assert.strictEqual(parsed.turnover, 807800000.50);
  assert.strictEqual(parsed.currency, "USDT");

  // 4. 失效抑制黑名单与复位
  assert.strictEqual(service.isSymbolSuppressed("INVALIDCOIN"), false);
  service.markSymbolInvalidForTest("INVALIDCOIN");
  assert.strictEqual(service.isSymbolSuppressed("INVALIDCOIN"), true);
  service.clearInvalidCache();
  assert.strictEqual(service.isSymbolSuppressed("INVALIDCOIN"), false);
});

void test("shouldSkipMarketPolling - 闭市跳过轮询 5 维决策矩阵边界测试", () => {
  // 1. 满足全部 5 项条件：开启闭市停止 + 闭市中 + 已拉取过首轮 + 非强制刷新 + 非单组刷新 => 允许跳过
  assert.strictEqual(
    shouldSkipMarketPolling({
      stopOnMarketClosed: true,
      isMarketOpen: false,
      hasLoadedInitialQuotes: true,
      forceAll: false,
      specificGroupName: undefined,
    }),
    true
  );

  // 2. 开市时段 (isMarketOpen: true) => 绝不跳过
  assert.strictEqual(
    shouldSkipMarketPolling({
      stopOnMarketClosed: true,
      isMarketOpen: true,
      hasLoadedInitialQuotes: true,
      forceAll: false,
    }),
    false
  );

  // 3. 用户关闭了「闭市时停止轮询」配置项 (stopOnMarketClosed: false) => 绝不跳过
  assert.strictEqual(
    shouldSkipMarketPolling({
      stopOnMarketClosed: false,
      isMarketOpen: false,
      hasLoadedInitialQuotes: true,
      forceAll: false,
    }),
    false
  );

  // 4. 冷启动阶段首次拉取 (hasLoadedInitialQuotes: false) => 绝不跳过（必须拉取收盘价填充盘面）
  assert.strictEqual(
    shouldSkipMarketPolling({
      stopOnMarketClosed: true,
      isMarketOpen: false,
      hasLoadedInitialQuotes: false,
      forceAll: false,
    }),
    false
  );

  // 5. 用户触发全局强制刷新 (forceAll: true) => 绝不跳过
  assert.strictEqual(
    shouldSkipMarketPolling({
      stopOnMarketClosed: true,
      isMarketOpen: false,
      hasLoadedInitialQuotes: true,
      forceAll: true,
    }),
    false
  );

  // 6. 用户触发指定分组定向刷新 (specificGroupName: "A股") => 绝不跳过
  assert.strictEqual(
    shouldSkipMarketPolling({
      stopOnMarketClosed: true,
      isMarketOpen: false,
      hasLoadedInitialQuotes: true,
      forceAll: false,
      specificGroupName: "A股",
    }),
    false
  );
});

void test("Active-Set Prune 内存基准与堆内存稳定性测试", () => {
  const quoteCache = new Map<string, any>();
  const initialHeap = process.memoryUsage().heapUsed;

  // 模拟 1000 轮高频自选变动与缓存注入
  for (let i = 0; i < 1000; i++) {
    const activeSymbols = [`sym_${i % 10}`, `sym_${(i + 1) % 10}`];
    const dummyWatchlist = {
      "动态测试组": activeSymbols.map((s) => ({ symbol: s, name: `标的_${s}` })),
    };

    // 注入当前轮次新行情 + 混入已被删除的孤儿历史标的
    quoteCache.set(`sym_${i % 10}`, { price: 100 + i, symbol: `sym_${i % 10}` });
    quoteCache.set(`sym_${(i + 1) % 10}`, { price: 200 + i, symbol: `sym_${(i + 1) % 10}` });
    quoteCache.set(`orphan_dead_${i}`, { price: 999, symbol: `orphan_dead_${i}` });

    // 执行活跃集对齐与死缓存回收
    pruneQuoteCache(dummyWatchlist, quoteCache);

    // 断言活跃集中仅保留当前有效标的与其标准 Key
    assert.ok(quoteCache.size <= 4, `缓存大小应严格受控 (当前: ${quoteCache.size})`);
    assert.strictEqual(quoteCache.has(`orphan_dead_${i}`), false);
  }

  const finalHeap = process.memoryUsage().heapUsed;
  const heapDeltaMB = (finalHeap - initialHeap) / 1024 / 1024;

  // 1000 次循环后增量堆内存应严格低于 10MB（通常近乎 0 增量）
  assert.ok(heapDeltaMB < 10, `循环后堆内存增量过大: ${heapDeltaMB.toFixed(2)} MB`);
});

void test("分组自选排序逻辑 - 涨幅/跌幅/名称/现价/默认 稳定排序规则", () => {
  const items = [
    { name: "贵州茅台", confSymbol: "sh600519", item: { price: 1800, changePercent: -1.2, name: "贵州茅台", symbol: "sh600519" } },
    { name: "比亚迪", confSymbol: "sz002594", item: { price: 260, changePercent: 5.8, name: "比亚迪", symbol: "sz002594" } },
    { name: "宁德时代", confSymbol: "sz300750", item: { price: 210, changePercent: 2.3, name: "宁德时代", symbol: "sz300750" } },
    { name: "阿里巴巴", confSymbol: "hk09988", item: { price: 80, changePercent: -3.5, name: "阿里巴巴", symbol: "hk09988" } },
  ];

  // 1. 默认顺序（保持配置原序）
  const defaultList = [...items];
  assert.strictEqual(defaultList[0].name, "贵州茅台");
  assert.strictEqual(defaultList[1].name, "比亚迪");

  // 2. 按涨幅排序（降序）：比亚迪(+5.8%) -> 宁德时代(+2.3%) -> 贵州茅台(-1.2%) -> 阿里巴巴(-3.5%)
  const changeDescList = [...items].sort((a, b) => (b.item.changePercent ?? 0) - (a.item.changePercent ?? 0));
  assert.deepStrictEqual(
    changeDescList.map((x) => x.name),
    ["比亚迪", "宁德时代", "贵州茅台", "阿里巴巴"]
  );

  // 3. 按跌幅排序（升序）：阿里巴巴(-3.5%) -> 贵州茅台(-1.2%) -> 宁德时代(+2.3%) -> 比亚迪(+5.8%)
  const changeAscList = [...items].sort((a, b) => (a.item.changePercent ?? 0) - (b.item.changePercent ?? 0));
  assert.deepStrictEqual(
    changeAscList.map((x) => x.name),
    ["阿里巴巴", "贵州茅台", "宁德时代", "比亚迪"]
  );

  // 4. 按名称拼音排序：阿里巴巴 (A) -> 比亚迪 (B) -> 贵州茅台 (G) -> 宁德时代 (N)
  const nameAscList = [...items].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }));
  assert.deepStrictEqual(
    nameAscList.map((x) => x.name),
    ["阿里巴巴", "比亚迪", "贵州茅台", "宁德时代"]
  );

  // 5. 按现价排序（降序）：贵州茅台(1800) -> 比亚迪(260) -> 宁德时代(210) -> 阿里巴巴(80)
  const priceDescList = [...items].sort((a, b) => (b.item.price ?? 0) - (a.item.price ?? 0));
  assert.deepStrictEqual(
    priceDescList.map((x) => x.name),
    ["贵州茅台", "比亚迪", "宁德时代", "阿里巴巴"]
  );
});

void test("基金分组与场内ETF - 资产推导、输入提示与分组层级校验", () => {
  // 1. 组名推导：基金与 ETF 组名推导为 A_SHARE
  assert.strictEqual(resolveItemAssetType({ symbol: "" }, "基金"), "A_SHARE");
  assert.strictEqual(resolveItemAssetType({ symbol: "" }, "核心ETF"), "A_SHARE");
  assert.strictEqual(resolveItemAssetType({ symbol: "510300" }, "基金"), "A_SHARE");

  // 2. 输入解析提示：场内基金代码段精准识别提示
  const fund1 = validateAndParseInput("510300");
  assert.ok(fund1.parsed?.hint?.includes("场内基金/ETF"), "510300 应提示场内基金/ETF");
  assert.strictEqual(fund1.parsed?.symbol, "sh510300");

  const fund2 = validateAndParseInput("159915");
  assert.ok(fund2.parsed?.hint?.includes("场内基金/ETF"), "159915 应提示场内基金/ETF");
  assert.strictEqual(fund2.parsed?.symbol, "sz159915");

  // 3. 腾讯抓取端与输入解析端前缀完全一致
  assert.strictEqual(fund1.parsed?.symbol, normalizeAShareCode("510300"));
  assert.strictEqual(fund2.parsed?.symbol, normalizeAShareCode("159915"));
});

void test("基金板块设置与状态栏轮播/分桶抓取联动", () => {
  const mockWatchlist = {
    "基金": [
      { symbol: "sh510050", name: "上证50ETF" },
      { symbol: "sz159915", name: "创业板ETF" },
    ],
    "A股": [
      { symbol: "sh600036", name: "招商银行" },
    ],
  };
  const mockQuoteCache = new Map<string, any>([
    ["sh510050", { symbol: "sh510050", name: "上证50ETF", price: 2.6, changePercent: 1.5 }],
    ["sz159915", { symbol: "sz159915", name: "创业板ETF", price: 1.8, changePercent: -0.5 }],
    ["sh600036", { symbol: "sh600036", name: "招商银行", price: 35.0, changePercent: 0.2 }],
  ]);

  // 1. 基金开启轮播，A股关闭轮播
  const quotes1 = extractStatusBarQuotes(mockWatchlist, mockQuoteCache, {
    fund: { enabled: true, statusBar: true },
    aShare: { enabled: true, statusBar: false },
  });
  assert.strictEqual(quotes1.length, 2);
  assert.deepStrictEqual(quotes1.map((q) => q.symbol), ["sh510050", "sz159915"]);

  // 2. 基金关闭轮播，A股开启轮播
  const quotes2 = extractStatusBarQuotes(mockWatchlist, mockQuoteCache, {
    fund: { enabled: true, statusBar: false },
    aShare: { enabled: true, statusBar: true },
  });
  assert.strictEqual(quotes2.length, 1);
  assert.strictEqual(quotes2[0].symbol, "sh600036");

  // 3. 基金板块禁用，抓取分桶应跳过基金
  const targets = extractTargetsFromWatchlist(mockWatchlist, {
    fundEnabled: false,
    aShareEnabled: true,
  });
  assert.deepStrictEqual(targets.funds, []);
  assert.deepStrictEqual(targets.aShares, ["sh600036"]);

  // 4. 基金板块启用，应独立进入 funds 桶，而非混入 aShares
  const targetsWithFund = extractTargetsFromWatchlist(mockWatchlist, {
    fundEnabled: true,
    aShareEnabled: true,
  });
  assert.deepStrictEqual(targetsWithFund.funds, ["sh510050", "sz159915"]);
  assert.deepStrictEqual(targetsWithFund.aShares, ["sh600036"]);
});

void test("scheduler - 闭市全板块跳过轮询时不应清空已缓存收盘行情（防止状态栏全部归零）", () => {
  const mockWatchlist = {
    "A股": [{ symbol: "sh600519", name: "贵州茅台", type: "A_SHARE" }],
    "美股": [{ symbol: "AAPL", name: "Apple", type: "US_STOCK" }],
  };

  // 1. 全板块休市/跳过抓取：targets 全部为空
  const targets = extractTargetsFromWatchlist(mockWatchlist, {
    fundEnabled: true,
    aShareEnabled: true,
    hkStockEnabled: true,
    usStockEnabled: true,
    binanceEnabled: false,
    alphaEnabled: false,
    skipFund: true,
    skipAShare: true,
    skipHKStock: true,
    skipUSStock: true,
  });
  assert.strictEqual(targets.aShares.length, 0);
  assert.strictEqual(targets.usStocks.length, 0);

  // 2. 内存已有的收盘行情缓存
  const quoteCache = new Map<string, any>();
  quoteCache.set("sh600519", { symbol: "sh600519", name: "贵州茅台", price: 1800, changePercent: 1.5 });
  quoteCache.set("aapl", { symbol: "AAPL", name: "Apple", price: 230, changePercent: 0.8 });

  // 3. 验证此时判断自选是否为空：不应为空
  const isWatchlistCompletelyEmpty =
    !mockWatchlist ||
    Object.values(mockWatchlist).every((list) => !Array.isArray(list) || list.length === 0);
  assert.strictEqual(isWatchlistCompletelyEmpty, false, "用户配置了标的，不应判定为完全空自选");

  // 4. pruneQuoteCache 不会误删闭市标的
  pruneQuoteCache(mockWatchlist, quoteCache);
  assert.strictEqual(quoteCache.size, 2, "闭市标的收盘行情应完好保留在缓存中");

  // 5. 状态栏提取依然能获取到有效报价，杜绝归零
  const statusBarQuotes = extractStatusBarQuotes(mockWatchlist, quoteCache, {
    statusBarEnabled: true,
    aShare: { statusBar: true },
    usStock: { statusBar: true },
  });
  assert.strictEqual(statusBarQuotes.length, 2);
  assert.strictEqual(statusBarQuotes[0].price, 1800);
  assert.strictEqual(statusBarQuotes[1].price, 230);
});

void test("scripts/sync-version - package.json 版本变更全自动同步测试", () => {
  const req = createRequire(import.meta.url);
  const { syncVersion } = req("../scripts/sync-version.js");

  // 1. 测试当前仓库版本读取（使用 dryRun: true 确保绝对不写盘、不删除本地已有 vsix 包）
  const resCurrent = syncVersion(undefined, false, true);
  assert.strictEqual(typeof resCurrent.version, "string");
  assert.strictEqual(resCurrent.version.length > 0, true);
  assert.strictEqual(Array.isArray(resCurrent.modifiedFiles), true);
  assert.strictEqual(Array.isArray(resCurrent.deletedVsix), true);

  // 2. 隔离环境：测试 package.json 版本变动时，自动更新 README.md 与 RELEASE.md
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketlens-sync-test-"));
  try {
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ version: "2.5.0" }, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempDir, "README.md"),
      '<img src="https://img.shields.io/badge/Release-v1.1.5-blue.svg" alt="Version">',
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempDir, "README.en.md"),
      '<img src="https://img.shields.io/badge/Release-v1.1.5-blue.svg" alt="Version">',
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempDir, "RELEASE.md"),
      "npx @vscode/vsce package -o marketlens-1.1.5.vsix\ngit tag v1.1.5 && git push origin v1.1.5",
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempDir, "CHANGELOG.md"),
      "# Changelog\n\n## [Unreleased]\n\n### 🚀 新特性\n- 示例改动\n",
      "utf8"
    );
    // 创建历史版本与当前版本的 vsix 测试文件
    fs.writeFileSync(path.join(tempDir, "marketlens-1.0.0.vsix"), "old-pkg-1", "utf8");
    fs.writeFileSync(path.join(tempDir, "marketlens-2.4.0.vsix"), "old-pkg-2", "utf8");
    fs.writeFileSync(path.join(tempDir, "marketlens-2.5.0.vsix"), "current-pkg", "utf8");

    // 2.1 先测试 dryRun = true 模式下的无损预检行为（零磁盘写入与删除）
    const dryRunRes = syncVersion(tempDir, false, true);
    assert.strictEqual(dryRunRes.version, "2.5.0");
    assert.strictEqual(dryRunRes.modifiedFiles.length, 4);
    assert.strictEqual(dryRunRes.deletedVsix.length, 2);
    const unmodReadme = fs.readFileSync(path.join(tempDir, "README.md"), "utf8");
    assert.strictEqual(unmodReadme.includes("Release-v1.1.5-blue.svg"), true, "dryRun 模式下不得写盘");
    const unmodChangelog = fs.readFileSync(path.join(tempDir, "CHANGELOG.md"), "utf8");
    assert.strictEqual(unmodChangelog.includes("## [Unreleased]"), true);
    assert.strictEqual(unmodChangelog.includes("## [2.5.0]"), false, "dryRun 模式下不得写盘");
    assert.strictEqual(fs.existsSync(path.join(tempDir, "marketlens-1.0.0.vsix")), true, "dryRun 模式下不得删除文件");

    // 2.2 正式落盘执行同步
    const syncRes = syncVersion(tempDir);
    assert.strictEqual(syncRes.version, "2.5.0");
    assert.strictEqual(syncRes.modifiedFiles.length, 4);
    assert.strictEqual(syncRes.modifiedFiles.includes("README.md"), true);
    assert.strictEqual(syncRes.modifiedFiles.includes("README.en.md"), true);
    assert.strictEqual(syncRes.modifiedFiles.includes("RELEASE.md"), true);
    assert.strictEqual(syncRes.modifiedFiles.includes("CHANGELOG.md"), true);

    // 验证旧版本 vsix 自动清理，当前版本安全保留
    assert.strictEqual(Array.isArray(syncRes.deletedVsix), true);
    assert.strictEqual(syncRes.deletedVsix.length, 2);
    assert.strictEqual(syncRes.deletedVsix.includes("marketlens-1.0.0.vsix"), true);
    assert.strictEqual(syncRes.deletedVsix.includes("marketlens-2.4.0.vsix"), true);
    assert.strictEqual(fs.existsSync(path.join(tempDir, "marketlens-1.0.0.vsix")), false, "旧版 vsix 应被删除");
    assert.strictEqual(fs.existsSync(path.join(tempDir, "marketlens-2.4.0.vsix")), false, "旧版 vsix 应被删除");
    assert.strictEqual(fs.existsSync(path.join(tempDir, "marketlens-2.5.0.vsix")), true, "当前版本的 vsix 应被安全保留");

    const updatedReadme = fs.readFileSync(path.join(tempDir, "README.md"), "utf8");
    assert.strictEqual(
      updatedReadme.includes("Release-v2.5.0-blue.svg"),
      true,
      "README badge 应被自动同步为新版本号"
    );

    const updatedRelease = fs.readFileSync(path.join(tempDir, "RELEASE.md"), "utf8");
    assert.strictEqual(
      updatedRelease.includes("marketlens-2.5.0.vsix"),
      true,
      "RELEASE vsix 包名应被自动同步为新版本号"
    );
    assert.strictEqual(
      updatedRelease.includes("git tag v2.5.0 && git push origin v2.5.0"),
      true,
      "RELEASE git tag 应被自动同步为新版本号"
    );

    const updatedChangelog = fs.readFileSync(path.join(tempDir, "CHANGELOG.md"), "utf8");
    assert.strictEqual(
      updatedChangelog.includes("## [2.5.0]"),
      true,
      "CHANGELOG 应被自动同步为新版本号"
    );
    assert.strictEqual(
      updatedChangelog.includes("## [Unreleased]"),
      true,
      "CHANGELOG 顶部应保留空的 Unreleased 模板"
    );

    // 3. 测试 cleanAll = true 时，打包前彻底清理所有版本 vsix（含当前版本同名残留包）
    fs.writeFileSync(path.join(tempDir, "marketlens-2.5.0.vsix"), "current-stale-pkg", "utf8");
    const cleanAllRes = syncVersion(tempDir, true);
    assert.strictEqual(cleanAllRes.deletedVsix.includes("marketlens-2.5.0.vsix"), true);
    assert.strictEqual(fs.existsSync(path.join(tempDir, "marketlens-2.5.0.vsix")), false, "cleanAll 时当前版本 vsix 也应被彻底删除");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("ASSET_TYPE_TO_SECTION_MAP - 资产底层类型与市场板块映射覆盖性校验", () => {
  assert.strictEqual(ASSET_TYPE_TO_SECTION_MAP["A_SHARE"], "aShare");
  assert.strictEqual(ASSET_TYPE_TO_SECTION_MAP["HK_STOCK"], "hkStock");
  assert.strictEqual(ASSET_TYPE_TO_SECTION_MAP["US_STOCK"], "usStock");
  assert.strictEqual(ASSET_TYPE_TO_SECTION_MAP["CRYPTO"], "binance");
  assert.strictEqual(ASSET_TYPE_TO_SECTION_MAP["BSC_TOKEN"], "alpha");
  assert.strictEqual(ASSET_TYPE_TO_SECTION_MAP["ALPHA_TOKEN"], "alpha");
});

void test("NORMALIZE_SYMBOL_KEY_CLIENT_SCRIPT - 前端 Webview 注入脚本与后端 TS 实现 100% 同源无漂移校验", () => {
  // 使用 Function 动态评估客户端脚本提取出的 getSymbolKey
  const clientEvalFn = new Function(`${NORMALIZE_SYMBOL_KEY_CLIENT_SCRIPT}; return getSymbolKey;`)() as (sym: string) => string;

  const testCases = [
    "00700",
    "hk00700",
    "hk700",
    "06030",
    "hk06030",
    "AAPL",
    "usAAPL",
    "us.AAPL",
    "us_AAPL",
    "us-AAPL",
    "usAMD",
    "AMD",
    "USB",
    "usUSB",
    "us.USB",
    "sh600519",
    "600519",
    "sz000001",
    "bj920002",
    "BTCUSDT",
    "btcusdt",
    "SOL/USDT",
    "0x2170ed0880ac9a755fd29b2688956bd959f933f8",
    "usBRK.B",
    "us.BRK.B",
    "",
  ];

  for (const sym of testCases) {
    const backendResult = normalizeSymbolKey(sym);
    const clientResult = clientEvalFn(sym);
    assert.strictEqual(
      clientResult,
      backendResult,
      `标的 "${sym}" 在前端脚本中的归一化结果 "${clientResult}" 与后端 TS 结果 "${backendResult}" 不一致！`
    );
  }
});

void test("scripts/sync-readme-en - Markdown 语法隔离保护与专有名词映射测试", async () => {
  const req = createRequire(import.meta.url);
  const { computeHash, protectMarkdown, restoreMarkdown, GLOSSARY_MAP, syncReadmeEn } = req("../scripts/sync-readme-en.js");

  // 1. 哈希计算一致性
  const hash1 = computeHash("hello world");
  const hash2 = computeHash("hello world");
  const hash3 = computeHash("hello world 2");
  assert.strictEqual(hash1, hash2, "相同内容哈希值应严格相等");
  assert.notStrictEqual(hash1, hash3, "不同内容哈希值不应相等");

  // 2. Markdown 占位保护与还原（代码块、内联代码、HTML标签、图片徽章、链接URL）
  const sampleMarkdown = [
    "# Title",
    "<p align=\"center\"><img src=\"icon.png\"></p>",
    "Use `npm test` to run tests.",
    "```typescript",
    "const a = 1;",
    "```",
    "Visit [GitHub](https://github.com/DevQQQQQ/marketLens).",
    "![Badge](https://img.shields.io/badge/1-2)",
  ].join("\n");

  const { processed, tokens } = protectMarkdown(sampleMarkdown);
  assert.strictEqual(tokens.length >= 5, true, "应识别并提取至少 5 个受保护的 Markdown 占位符");
  assert.strictEqual(processed.includes("https://github.com/DevQQQQQ/marketLens"), false, "URL应被占位符替换保护");
  assert.strictEqual(processed.includes("const a = 1;"), false, "代码块内容应被占位符替换保护");

  const restored = restoreMarkdown(processed, tokens);
  assert.strictEqual(restored, sampleMarkdown, "还原后内容应与原 Markdown 100% 字节无损匹配");

  // 3. 专有名词映射字典覆盖校验
  let testText = "支持老板键一键隐藏，提供摸鱼模式和颜色脱敏，具备活跃集修剪与六合一全能行情。";
  for (const [pattern, replacement] of GLOSSARY_MAP) {
    testText = testText.replace(pattern, replacement);
  }
  assert.strictEqual(testText.includes("Boss Key"), true, "老板键应映射为 Boss Key");
  assert.strictEqual(testText.includes("Active-Set Pruning"), true, "活跃集修剪应映射为 Active-Set Pruning");
  assert.strictEqual(testText.includes("6-in-1 Unified Market Coverage"), true, "六合一全能行情应映射为 6-in-1 Unified Market Coverage");

  // 4. 沙盒隔离环境下的同步与幂等性测试（杜绝真实仓库写盘副作用）
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketlens-readme-sync-"));
  try {
    fs.mkdirSync(path.join(tempDir, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "README.md"),
      "# MarketLens\nhttps://img.shields.io/badge/Release-v1.1.7-blue.svg\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempDir, "README.en.md"),
      "# MarketLens EN\nhttps://img.shields.io/badge/Release-v1.1.6-blue.svg\n",
      "utf8"
    );

    const syncResult = await syncReadmeEn(tempDir, false);
    assert.strictEqual(syncResult, true, "沙盒目录下同步应返回 true");

    const updatedEn = fs.readFileSync(path.join(tempDir, "README.en.md"), "utf8");
    assert.strictEqual(
      updatedEn.includes("Release-v1.1.7-blue.svg"),
      true,
      "README.en.md 徽章应与 README.md 同步更新为 v1.1.7"
    );
    assert.strictEqual(
      fs.existsSync(path.join(tempDir, "scripts", ".readme-hash")),
      true,
      ".readme-hash 应在沙盒 scripts 目录下生成"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

void test("autoCollapseClosedGroups - 休市自动折叠与状态栏过滤纯算法测试", () => {
  // 1. 测试时间基准
  // 周日 10:00 UTC (北京时间 18:00 周日，A股/港股/美股全休市，加密资产全天开盘)
  const sundayClosed = new Date("2026-09-20T10:00:00.000Z");
  // 周五 02:00 UTC (北京时间 10:00 周五，A股/基金盘中正常开盘)
  const fridayOpen = new Date("2026-09-18T02:00:00.000Z");

  // 2. isItemMarketClosed 标的级休市判定
  assert.strictEqual(isItemMarketClosed({ symbol: "sh600519", type: "A_SHARE" }, "A股", sundayClosed), true);
  assert.strictEqual(isItemMarketClosed({ symbol: "hk00700", type: "HK_STOCK" }, "港股", sundayClosed), true);
  assert.strictEqual(isItemMarketClosed({ symbol: "usAAPL", type: "US_STOCK" }, "美股", sundayClosed), true);
  assert.strictEqual(isItemMarketClosed({ symbol: "510300" }, "场内基金", sundayClosed), true);
  // 加密资产 24/7 永不休市
  assert.strictEqual(isItemMarketClosed({ symbol: "BTCUSDT", type: "CRYPTO" }, "Binance", sundayClosed), false);
  assert.strictEqual(isItemMarketClosed({ symbol: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", type: "ALPHA_TOKEN" }, "Alpha", sundayClosed), false);

  // 开盘时段
  assert.strictEqual(isItemMarketClosed({ symbol: "sh600519", type: "A_SHARE" }, "A股", fridayOpen), false);
  assert.strictEqual(isItemMarketClosed({ symbol: "510300" }, "场内基金", fridayOpen), false);

  // 3. isGroupMarketClosed 分组级休市判定
  assert.strictEqual(
    isGroupMarketClosed("🇨🇳 A股", [{ symbol: "sh600519", type: "A_SHARE" }, { symbol: "sz000001", type: "A_SHARE" }], sundayClosed),
    true
  );
  assert.strictEqual(
    isGroupMarketClosed("📁 场内基金", [{ symbol: "510300" }], sundayClosed),
    true
  );
  assert.strictEqual(
    isGroupMarketClosed("💰 Binance", [{ symbol: "BTCUSDT", type: "CRYPTO" }], sundayClosed),
    false
  );
  // 混杂资产分组：只要组内包含 24/7 开盘标的，该组即不判定为全休市
  assert.strictEqual(
    isGroupMarketClosed("自选", [{ symbol: "sh600519", type: "A_SHARE" }, { symbol: "BTCUSDT", type: "CRYPTO" }], sundayClosed),
    false
  );
  // 空组推导
  assert.strictEqual(isGroupMarketClosed("A股", [], sundayClosed), true);
  assert.strictEqual(isGroupMarketClosed("Binance", [], sundayClosed), false);

  // 4. extractStatusBarQuotes 在 autoCollapseClosedGroups 开启时的状态栏过滤
  const mockWatchlist = {
    "A股": [{ symbol: "sh600519", name: "贵州茅台", type: "A_SHARE" }],
    "场内基金": [{ symbol: "510300", name: "300ETF" }],
    "美股": [{ symbol: "usAAPL", name: "苹果", type: "US_STOCK" }],
    "Binance": [{ symbol: "BTCUSDT", name: "BTC", type: "CRYPTO" }],
  };
  const mockCache = new Map<string, any>();
  mockCache.set("sh600519", { symbol: "sh600519", name: "贵州茅台", price: 1780, changePercent: 1.2 });
  mockCache.set("510300", { symbol: "510300", name: "300ETF", price: 3.5, changePercent: 0.5 });
  mockCache.set("aapl", { symbol: "usAAPL", name: "苹果", price: 220, changePercent: -0.8 });
  mockCache.set("btcusdt", { symbol: "BTCUSDT", name: "BTC", price: 65000, changePercent: 2.5 });

  // 4.1 未开启休市过滤：4 个标的全量参与轮播
  const allQuotes = extractStatusBarQuotes(mockWatchlist, mockCache, {
    statusBarEnabled: true,
    autoCollapseClosedGroups: false,
    now: sundayClosed,
  });
  assert.strictEqual(allQuotes.length, 4);

  // 4.2 开启休市过滤：A股/基金/美股休市被自动剔除，仅保留 24/7 的 BTCUSDT
  const filteredQuotes = extractStatusBarQuotes(mockWatchlist, mockCache, {
    statusBarEnabled: true,
    autoCollapseClosedGroups: true,
    now: sundayClosed,
  });
  assert.strictEqual(filteredQuotes.length, 1);
  assert.strictEqual(filteredQuotes[0].symbol, "BTCUSDT");

  // 4.3 若用户仅关注 A 股与基金，且处于休市时：返回空数组（状态栏静默隐藏）
  const aShareOnlyWatchlist = {
    "A股": [{ symbol: "sh600519", name: "贵州茅台", type: "A_SHARE" }],
    "场内基金": [{ symbol: "510300", name: "300ETF" }],
  };
  const emptyClosedQuotes = extractStatusBarQuotes(aShareOnlyWatchlist, mockCache, {
    statusBarEnabled: true,
    autoCollapseClosedGroups: true,
    now: sundayClosed,
  });
  assert.strictEqual(emptyClosedQuotes.length, 0);
});

void test("buildGroupNodeId - 休市分组节点 id 随会话失效以规避 VS Code 展开记忆", () => {
  // 1. 休市 + 自动折叠开启：id 必须携带会话标识。
  //    否则 VS Code 会按同一节点句柄恢复用户上一次的手动展开，覆盖「休市默认折叠」语义
  assert.strictEqual(buildGroupNodeId("基金", true, true, "s1"), "group_基金@closed#s1");
  assert.notStrictEqual(
    buildGroupNodeId("基金", true, true, "s1"),
    buildGroupNodeId("基金", true, true, "s2")
  );

  // 2. 开盘分组：id 保持稳定，用户手动折叠的偏好得以跨会话保留
  assert.strictEqual(buildGroupNodeId("Binance", true, false, "s1"), "group_Binance");
  assert.strictEqual(
    buildGroupNodeId("Binance", true, false, "s1"),
    buildGroupNodeId("Binance", true, false, "s2")
  );

  // 3. 自动折叠开关关闭：即使处于休市也退回稳定 id
  assert.strictEqual(buildGroupNodeId("基金", false, true, "s1"), "group_基金");
  assert.strictEqual(
    buildGroupNodeId("基金", false, true, "s1"),
    buildGroupNodeId("基金", false, true, "s2")
  );

  // 4. 同一会话内不同分组的 id 互不冲突
  assert.notStrictEqual(
    buildGroupNodeId("基金", true, true, "s1"),
    buildGroupNodeId("🇨🇳 A股", true, true, "s1")
  );

  // 5. 用户显式「全部展开」：所有分组（含开盘分组）都必须换 id，
  //    否则 VS Code 会沿用「用户上一次折叠」的记忆，导致 collapsibleState=Expanded 被覆盖
  assert.strictEqual(buildGroupNodeId("基金", true, true, "s1", true), "group_基金@open#s1");
  assert.strictEqual(buildGroupNodeId("Binance", true, false, "s1", true), "group_Binance@open#s1");
  assert.notStrictEqual(
    buildGroupNodeId("基金", true, true, "s1", true),
    buildGroupNodeId("基金", true, true, "s1", false)
  );

  // 6. forceExpanded 默认参数向后兼容：不传时与显式传 false 完全一致
  assert.strictEqual(
    buildGroupNodeId("基金", true, true, "s1"),
    buildGroupNodeId("基金", true, true, "s1", false)
  );
});

void test("backupHelper - 配置导出与导入校验契约", () => {
  const sampleConfig: any = {
    autoRefresh: true,
    refreshInterval: 6000,
    maskMode: false,
    colorNeutral: false,
    colorScheme: "redUpGreenDown",
    statusBar: { enabled: true },
    autoCollapseClosedGroups: true,
    proxyPort: 7890,
    proxyUrl: "http://127.0.0.1:7890",
    fund: { enabled: true, networkMode: "direct", proxyUrl: "http://127.0.0.1:7890", stopOnMarketClosed: true, statusBar: true },
    aShare: { enabled: true, networkMode: "direct", proxyUrl: "http://127.0.0.1:7890", stopOnMarketClosed: true, statusBar: true },
    hkStock: { enabled: true, networkMode: "direct", proxyUrl: "http://127.0.0.1:7890", stopOnMarketClosed: true, statusBar: true },
    usStock: { enabled: true, networkMode: "direct", proxyUrl: "http://127.0.0.1:7890", stopOnMarketClosed: true, statusBar: true },
    binance: { enabled: true, networkMode: "proxy", proxyUrl: "http://127.0.0.1:7890", statusBar: true },
    alpha: { enabled: true, networkMode: "proxy", proxyUrl: "http://127.0.0.1:7890", statusBar: true },
    watchlist: {
      "A股": [
        { symbol: "sh600519", name: "贵州茅台", type: "A_SHARE" },
        { symbol: "sz000001", name: "平安银行", type: "A_SHARE" },
      ],
      "Binance": [
        { symbol: "BTCUSDT", name: "BTC/USDT", type: "CRYPTO" },
      ],
    },
    alerts: {
      "sh600519": { symbol: "sh600519", name: "贵州茅台", above: 2000, enabled: true },
    },
    alertNotificationMode: "notification",
    alertCooldownMinutes: 15,
  };

  const sampleSortModes: any = {
    "A股": "changeDesc",
    "Binance": "priceDesc",
  };

  // 1. 生成备份对象
  const backup = generateBackupData(sampleConfig, sampleSortModes, "1.1.11");
  assert.strictEqual(backup.version, "1.1.11");
  assert.strictEqual(backup.schemaVersion, 1);
  assert.ok(typeof backup.exportedAt === "string");
  assert.strictEqual(backup.settings.autoRefresh, true);
  assert.strictEqual(backup.settings.refreshInterval, 6000);
  assert.strictEqual(backup.settings.colorScheme, "redUpGreenDown");
  assert.strictEqual(backup.settings.proxyPort, 7890);
  assert.strictEqual(backup.settings.watchlist?.["A股"]?.length, 2);
  assert.strictEqual(backup.settings.alerts?.["sh600519"]?.above, 2000);
  assert.strictEqual(backup.groupSortModes?.["A股"], "changeDesc");

  // 2. 校验标准备份对象
  const val1 = validateBackupData(backup);
  assert.strictEqual(val1.valid, true);
  assert.strictEqual(val1.summary?.totalSymbols, 3);
  assert.strictEqual(val1.summary?.groupCount, 2);
  assert.strictEqual(val1.summary?.alertCount, 1);
  assert.strictEqual(val1.data?.settings.colorScheme, "redUpGreenDown");
  assert.strictEqual(val1.data?.groupSortModes?.["A股"], "changeDesc");

  // 3. 校验平铺结构（无 settings 包装，直接顶层配置）兼容
  const flatConfig = {
    watchlist: {
      "港股": ["hk00700"],
    },
    alerts: {
      "hk00700": { symbol: "hk00700", below: 300, enabled: true },
    },
    colorScheme: "greenUpRedDown",
  };
  const val2 = validateBackupData(flatConfig);
  assert.strictEqual(val2.valid, true);
  assert.strictEqual(val2.summary?.totalSymbols, 1);
  assert.strictEqual(val2.summary?.alertCount, 1);
  assert.strictEqual(val2.data?.settings.watchlist?.["港股"]?.[0]?.symbol, "hk00700");

  // 4. 非法数据防御
  assert.strictEqual(validateBackupData(null).valid, false);
  assert.strictEqual(validateBackupData("").valid, false);
  assert.strictEqual(validateBackupData([]).valid, false);
  assert.strictEqual(validateBackupData({ watchlist: "not an object" }).valid, false);
  assert.strictEqual(validateBackupData({ watchlist: { "A股": "not an array" } }).valid, false);
  assert.strictEqual(validateBackupData({ alerts: "not an object" }).valid, false);

  // 5. 平铺结构缺失 watchlist/alerts 时不回填空对象（避免导入时清空现有自选和预警）
  const noWatchlist = validateBackupData({ autoRefresh: false });
  assert.strictEqual(noWatchlist.valid, true);
  assert.strictEqual(noWatchlist.data?.settings.watchlist, undefined);
  assert.strictEqual(noWatchlist.data?.settings.alerts, undefined);

  // 6. 脏数组元素清洗：只保留有效 string symbol 或带合法 symbol 的对象
  const dirtyWatchlist = validateBackupData({
    watchlist: {
      "A股": ["sh600030", null, { symbol: 123 }, { symbol: "sz000001", type: "A_SHARE" }],
      "美股": [{ symbol: "  AAPL  ", name: 123 as any, type: "US_STOCK" }, null, "非法保留"],
    },
    alerts: {
      "sh600030": { symbol: "sh600030", above: 100, enabled: true },
      bad: null,
      bad2: { symbol: 456 },
    },
  });
  assert.strictEqual(dirtyWatchlist.valid, true);
  assert.strictEqual(dirtyWatchlist.data?.settings.watchlist?.["A股"]?.length, 2);
  assert.strictEqual(dirtyWatchlist.data?.settings.watchlist?.["A股"]?.[0]?.symbol, "sh600030");
  assert.strictEqual(dirtyWatchlist.data?.settings.watchlist?.["A股"]?.[0]?.type, "A_SHARE");
  assert.strictEqual(dirtyWatchlist.data?.settings.watchlist?.["A股"]?.[1]?.symbol, "sz000001");
  assert.strictEqual(dirtyWatchlist.data?.settings.watchlist?.["A股"]?.[1]?.type, "A_SHARE");
  assert.strictEqual(dirtyWatchlist.data?.settings.watchlist?.["美股"]?.length, 2);
  assert.strictEqual(dirtyWatchlist.data?.settings.watchlist?.["美股"]?.[0]?.symbol, "AAPL");
  assert.strictEqual(dirtyWatchlist.data?.settings.watchlist?.["美股"]?.[0]?.name, undefined);
  assert.strictEqual(dirtyWatchlist.data?.settings.watchlist?.["美股"]?.[0]?.type, "US_STOCK");
  assert.strictEqual(dirtyWatchlist.data?.settings.watchlist?.["美股"]?.[1]?.symbol, "非法保留");
  assert.strictEqual(dirtyWatchlist.data?.settings.watchlist?.["美股"]?.[1]?.type, "US_STOCK");
  assert.strictEqual(dirtyWatchlist.data?.settings.alerts?.["sh600030"]?.above, 100);
  assert.strictEqual(dirtyWatchlist.data?.settings.alerts?.["sh600030"]?.enabled, true);
  assert.strictEqual(dirtyWatchlist.data?.settings.alerts?.["bad"], undefined);
  assert.strictEqual(dirtyWatchlist.data?.settings.alerts?.["bad2"], undefined);
});

void test("sanitizeWatchlist - 容错清洗、null过滤与裸字符串规整", () => {
  // 1. 根级别非法数据兜底
  assert.deepStrictEqual(sanitizeWatchlist(null), {});
  assert.deepStrictEqual(sanitizeWatchlist(undefined), {});
  assert.deepStrictEqual(sanitizeWatchlist("string"), {});
  assert.deepStrictEqual(sanitizeWatchlist(123), {});
  assert.deepStrictEqual(sanitizeWatchlist([]), {});

  // 2. 分组为 null / 非数组时规整为空数组
  const nonArrayGroup = sanitizeWatchlist({
    "A股": null,
    "港股": "not-an-array",
    "美股": { symbol: "AAPL" },
  });
  assert.deepStrictEqual(nonArrayGroup, {
    "A股": [],
    "港股": [],
    "美股": [],
  });

  // 3. 裸字符串自动包装为合规 WatchConfigItem 并正确推导板块
  const rawStringWatchlist = sanitizeWatchlist({
    "自选A股": ["sh600519", "000001", "  601318  "],
    "港股": ["00700", "hk09988"],
    "美股": ["AAPL", "TSLA"],
    "Crypto": ["BTCUSDT", "ETHUSDT"],
  });
  assert.strictEqual(rawStringWatchlist["自选A股"].length, 3);
  assert.strictEqual(rawStringWatchlist["自选A股"][0].symbol, "sh600519");
  assert.strictEqual(rawStringWatchlist["自选A股"][0].type, "A_SHARE");
  assert.strictEqual(rawStringWatchlist["自选A股"][2].symbol, "601318");

  assert.strictEqual(rawStringWatchlist["港股"][0].symbol, "00700");
  assert.strictEqual(rawStringWatchlist["港股"][0].type, "HK_STOCK");

  assert.strictEqual(rawStringWatchlist["美股"][0].symbol, "AAPL");
  assert.strictEqual(rawStringWatchlist["美股"][0].type, "US_STOCK");

  assert.strictEqual(rawStringWatchlist["Crypto"][0].symbol, "BTCUSDT");
  assert.strictEqual(rawStringWatchlist["Crypto"][0].type, "CRYPTO");

  // 4. 脏元素过滤（null, undefined, 数字, 无 symbol, symbol 为空）
  const dirtyItems = sanitizeWatchlist({
    "A股": [
      null,
      undefined,
      123,
      {},
      { name: "只有名称没有代码" },
      { symbol: "   " },
      { symbol: 456 },
      { symbol: "sh600030", name: "  中信证券  ", type: "A_SHARE" },
      { symbol: "sz000001", name: "", type: "UNKNOWN_TYPE" as any },
    ],
  });
  assert.strictEqual(dirtyItems["A股"].length, 2);
  assert.strictEqual(dirtyItems["A股"][0].symbol, "sh600030");
  assert.strictEqual(dirtyItems["A股"][0].name, "中信证券");
  assert.strictEqual(dirtyItems["A股"][0].type, "A_SHARE");
  assert.strictEqual(dirtyItems["A股"][1].symbol, "sz000001");
  assert.strictEqual(dirtyItems["A股"][1].name, undefined);
  assert.strictEqual(dirtyItems["A股"][1].type, "A_SHARE");
});

void test("batchReorderWatchlist - 脏元素（含 null/空对象）防御与同组拖拽安全性", () => {
  const dirtyWatchlist: Record<string, any[]> = {
    "A股": [
      null,
      { symbol: "sh600519", type: "A_SHARE" },
      undefined,
      { symbol: "sz000001", type: "A_SHARE" },
      {},
    ],
  };

  // 尝试将 sz000001 移动到 sh600519 前面，即使组内含有 null/undefined 也绝不抛出 TypeError
  const reordered = batchReorderWatchlist(dirtyWatchlist, [
    { sourceGroup: "A股", sourceSymbol: "sz000001" },
  ], "A股", "sh600519");

  assert.notStrictEqual(reordered, null);
  const symbols = reordered!["A股"].map((x) => x?.symbol).filter(Boolean);
  assert.deepStrictEqual(symbols, ["sz000001", "sh600519"]);
});

void test("network 常量与本地端口探活接口基础契约", async () => {
  assert.strictEqual(DEFAULT_PROXY_PORT, 10808);
  assert.strictEqual(DEFAULT_PROXY_URL, "http://127.0.0.1:10808");
  assert.strictEqual(COMMON_PROXY_PORTS.includes(10808), true);
  // testLocalPort 探测未开放的端口应安全返回 false 而不崩溃
  const deadRes = await testLocalPort(65534);
  assert.strictEqual(deadRes, false);
});

void test("smartNetworkGet - 核心网络调度、直连模式、代理回退与熔断守卫", async () => {
  resetProxyCache();
  const originalGet = axios.get;
  const originalEnv = { ...process.env };
  const cleanProxyEnv = () => {
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;
  };

  try {
    cleanProxyEnv();
    // 1. 直连模式：显式声明 proxy: false
    let interceptedConfig: any = null;
    axios.get = (async (url: string, config: any) => {
      interceptedConfig = config;
      return { data: { status: "ok" }, status: 200, statusText: "OK", headers: {}, config };
    }) as any;

    const resDirect = await smartNetworkGet<Record<string, string>>("http://example.com/api", { mode: "direct" });
    assert.strictEqual(resDirect.data.status, "ok");
    assert.strictEqual(interceptedConfig.proxy, false, "直连模式必须显式设置 proxy: false");

    // 2. 代理模式：目标代理请求成功并更新 cachedWorkingPort
    axios.get = (async (url: string, config: any) => {
      interceptedConfig = config;
      return { data: { price: "50000" }, status: 200, statusText: "OK", headers: {}, config };
    }) as any;

    const resProxy = await smartNetworkGet<Record<string, string>>("http://example.com/quote", {
      mode: "proxy",
      proxyUrl: "http://127.0.0.1:7890",
    });
    assert.strictEqual(resProxy.data.price, "50000");
    assert.strictEqual(interceptedConfig.proxy.port, 7890);
    assert.strictEqual(getCachedWorkingPort(), 7890, "请求成功后必须缓存工作端口");

    // 3. 远端服务器返回原生 HTTP 响应（如 400 Bad Request）时必须保留异常且不进入探测
    axios.get = (async () => {
      const err: any = new Error("Request failed with status code 400");
      err.response = { status: 400, data: { msg: "Invalid symbol" } };
      throw err;
    }) as any;

    await assert.rejects(
      async () => {
        await smartNetworkGet("http://example.com/bad", { mode: "proxy", proxyUrl: "http://127.0.0.1:7890" });
      },
      (err: any) => {
        return err.response?.status === 400;
      },
      "业务 HTTP 响应异常必须直接抛出保留 response"
    );

    // 4. 目标端口不可达，但系统环境变量代理可达时的自适应降级
    resetProxyCache();
    cleanProxyEnv();
    process.env.HTTP_PROXY = "http://127.0.0.1:7897";

    axios.get = (async (url: string, config: any) => {
      if (config.proxy?.port === 10808) {
        throw new Error("connect ECONNREFUSED 127.0.0.1:10808");
      }
      if (config.proxy?.port === 7897) {
        return { data: { fallback: "sys-proxy" }, status: 200, statusText: "OK", headers: {}, config };
      }
      throw new Error("unexpected port");
    }) as any;

    const resSys = await smartNetworkGet<Record<string, string>>("http://example.com/test", {
      mode: "proxy",
      proxyUrl: "http://127.0.0.1:10808",
    });
    assert.strictEqual(resSys.data.fallback, "sys-proxy");
    assert.strictEqual(getCachedWorkingPort(), 7897, "自适应切换后必须更新工作端口为系统代理端口");

    // 清理环境变量
    cleanProxyEnv();

    // 5. 所有端口不可达时触发熔断冷却并阻止重试
    resetProxyCache();
    axios.get = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as any;

    await assert.rejects(
      async () => {
        await smartNetworkGet("http://example.com/dead", {
          mode: "proxy",
          proxyUrl: "http://127.0.0.1:9999",
        });
      },
      /\[MarketLens\] 代理连接失败。已阻止直连。/,
      "所有端口失败必须阻止直连"
    );

    // 冷却期内再次请求必须立即拦截
    await assert.rejects(
      async () => {
        await smartNetworkGet("http://example.com/dead2", {
          mode: "proxy",
          proxyUrl: "http://127.0.0.1:9999",
        });
      },
      /端口探测处于冷却中/,
      "熔断冷却期内必须拒绝重试"
    );

    // 重置后解除冷却
    resetProxyCache();
    assert.strictEqual(getCachedWorkingPort(), undefined);
  } finally {
    axios.get = originalGet;
    resetProxyCache();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  }
});

void test("BinanceService - fetchQuotes 批量拉取与代理/直连模式及异常隔离", async () => {
  const service = new BinanceService();
  const originalGet = axios.get;

  try {
    // 1. 空输入测试
    const emptyRes = await service.fetchQuotes([]);
    assert.deepStrictEqual(emptyRes, []);

    // 2. 模拟 Binance 正常行情返回
    axios.get = (async () => {
      return {
        status: 200,
        data: [
          {
            symbol: "BTCUSDT",
            priceChange: "500",
            priceChangePercent: "1.2",
            lastPrice: "68000.00",
            openPrice: "67500.00",
            highPrice: "69000.00",
            lowPrice: "67000.00",
            prevClosePrice: "67500.00",
            volume: "1000",
            quoteVolume: "68000000",
          },
          {
            symbol: "ETHUSDT",
            priceChange: "-30",
            priceChangePercent: "-0.8",
            lastPrice: "3500.00",
            openPrice: "3530.00",
            highPrice: "3600.00",
            lowPrice: "3480.00",
            prevClosePrice: "3530.00",
            volume: "5000",
            quoteVolume: "17500000",
          },
        ],
      };
    }) as any;

    const quotes = await service.fetchQuotes(["BTCUSDT", "ETHUSDT"], { mode: "direct" });
    assert.strictEqual(quotes.length, 2);
    assert.strictEqual(quotes[0].symbol, "BTCUSDT");
    assert.strictEqual(quotes[0].price, 68000);
    assert.strictEqual(quotes[1].symbol, "ETHUSDT");
    assert.strictEqual(quotes[1].price, 3500);

    // 3. 网络异常单批次失败容错，返回空数组并不崩溃
    axios.get = (async () => {
      throw new Error("Network timeout");
    }) as any;

    const failedQuotes = await service.fetchQuotes(["BTCUSDT"], { mode: "direct" });
    assert.deepStrictEqual(failedQuotes, []);
  } finally {
    axios.get = originalGet;
  }
});

void test("DexScreenerService - fetchQuotes 报文映射、多流动性池与无效地址 TTL 清理", async () => {
  const service = new DexScreenerService();
  const originalGet = axios.get;

  try {
    // 1. 空输入与非法格式校验
    const emptyRes = await service.fetchQuotes([]);
    assert.deepStrictEqual(emptyRes, []);

    const invalidFormatRes = await service.fetchQuotes(["not-an-address"]);
    assert.deepStrictEqual(invalidFormatRes, []);

    // 2. 模拟 DexScreener 正常返回 pairs
    const mockAddr = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
    axios.get = (async () => {
      return {
        status: 200,
        data: {
          schemaVersion: "1.0.0",
          pairs: [
            {
              chainId: "bsc",
              dexId: "pancakeswap",
              pairAddress: "0x1234567890abcdef1234567890abcdef12345678",
              baseToken: { address: mockAddr, name: "Wrapped BNB", symbol: "WBNB" },
              priceUsd: "580.5",
              priceChange: { h24: 3.5 },
              volume: { h24: 1000000 },
              liquidity: { usd: 50000000 },
            },
          ],
        },
      };
    }) as any;

    const quotes = await service.fetchQuotes([mockAddr], { mode: "direct" });
    assert.strictEqual(quotes.length, 1);
    assert.strictEqual(quotes[0].id, mockAddr);
    assert.strictEqual(quotes[0].symbol, "WBNB");
    assert.strictEqual(quotes[0].name, "Wrapped BNB");
    assert.strictEqual(quotes[0].price, 580.5);
    assert.strictEqual(quotes[0].changePercent, 3.5);
    assert.strictEqual(quotes[0].currency, "USDT");
    assert.strictEqual(quotes[0].type, "ALPHA_TOKEN");

    // 3. 测试清理无效地址缓存
    service.clearInvalidCache();
    assert.strictEqual(service.isAddressSuppressed(mockAddr), false);
  } finally {
    axios.get = originalGet;
  }
});

void test("scheduler - 网络持续故障退避计数与自动复位守卫", async () => {
  const { RefreshScheduler } = await import("../src/scheduler.ts");
  const mockMarketManager: any = {
    clearInvalidCache: () => {},
    pollAll: async () => [],
  };
  const mockTreeProvider: any = {
    setAlerts: () => {},
    buildTree: () => {},
    applyQuotes: () => {},
    isEmpty: () => false,
  };
  const mockStatusBar: any = {
    setQuotes: () => {},
    show: () => {},
    hide: () => {},
    isBossKeyActive: () => false,
  };
  const mockTreeView: any = { visible: true };

  const scheduler = new RefreshScheduler({
    marketManager: mockMarketManager,
    treeProvider: mockTreeProvider,
    statusBar: mockStatusBar,
    treeView: mockTreeView,
  });

  const vscode = await import("vscode");
  const originalWatchlist = vscode.workspace.getConfiguration("marketlens").get("watchlist");
  await vscode.workspace.getConfiguration("marketlens").update("watchlist", {
    "A股": [{ symbol: "sh600519", name: "贵州茅台", type: "A_SHARE" }]
  }, vscode.ConfigurationTarget.Global);

  try {
    assert.strictEqual(scheduler.getConsecutiveNetworkFailures(), 0);

    // 1. 模拟全失败：quotes 为空但有 targets 时递增
    await scheduler.refresh(true);
    assert.strictEqual(scheduler.getConsecutiveNetworkFailures(), 1);

    await scheduler.refresh(true);
    assert.strictEqual(scheduler.getConsecutiveNetworkFailures(), 2);

    // 2. 模拟拉取成功：quotes > 0 时立即自动复位为 0
    mockMarketManager.pollAll = async () => [
      { id: "sh600519", symbol: "sh600519", name: "茅台", type: "A_SHARE", price: 1800, changePercent: 1.5 }
    ];
    await scheduler.refresh(true);
    assert.strictEqual(scheduler.getConsecutiveNetworkFailures(), 0, "成功抓取后失败计数必须立即复位为 0");

    // 3. stop 也会清零
    mockMarketManager.pollAll = async () => [];
    await scheduler.refresh(true);
    assert.strictEqual(scheduler.getConsecutiveNetworkFailures(), 1);
    scheduler.stop();
    assert.strictEqual(scheduler.getConsecutiveNetworkFailures(), 0, "stop 必须重置连续网络失败计数");
  } finally {
    scheduler.dispose();
    await vscode.workspace.getConfiguration("marketlens").update("watchlist", originalWatchlist, vscode.ConfigurationTarget.Global);
  }
});

void test("scheduler - refreshInterval 为 0 或负数时安全兜底 >= 1000ms 且 refreshGroup 并发冲突排队重试", async () => {
  const { RefreshScheduler } = await import("../src/scheduler.ts");
  const { GroupItem } = await import("../src/ui/watchlistProvider.ts");
  const vscode = await import("vscode");

  let groupPolled = 0;
  let releaseSlowRefresh: (() => void) | undefined;

  const mockMarketManager: any = {
    clearInvalidCache: () => {},
    pollAll: async (targets: any) => {
      if (releaseSlowRefresh) {
        const waitPromise = new Promise<void>((res) => {
          const prev = releaseSlowRefresh!;
          releaseSlowRefresh = () => {
            prev();
            res();
          };
        });
        await waitPromise;
      }
      if (targets.aShares?.includes("sh600519") && targets.usStocks?.length === 0) {
        groupPolled++;
      }
      return [];
    },
  };
  const mockTreeProvider: any = {
    setAlerts: () => {},
    buildTree: () => {},
    applyQuotes: () => {},
    isEmpty: () => false,
  };
  let backoffArgs: { failures: number; seconds: number } | undefined;
  const mockStatusBar: any = {
    setQuotes: () => {},
    show: () => {},
    hide: () => {},
    setNetworkBackoff: (failures: number, seconds: number) => {
      backoffArgs = { failures, seconds };
    },
  };
  const mockTreeView: any = { visible: true };

  const scheduler = new RefreshScheduler({
    marketManager: mockMarketManager,
    treeProvider: mockTreeProvider,
    statusBar: mockStatusBar,
    treeView: mockTreeView,
  });

  const cfg = vscode.workspace.getConfiguration("marketlens");
  const origInterval = cfg.get("refreshInterval");
  const origWatchlist = cfg.get("watchlist");

  try {
    // 1. 验证 refreshInterval 设为 0 或负数时，scheduleNextTick 兜底 >= 1000ms，且退避状态同步到 StatusBar
    await cfg.update("refreshInterval", -500, vscode.ConfigurationTarget.Global);
    await cfg.update("watchlist", {
      "A股": [{ symbol: "sh600519", name: "贵州茅台", type: "A_SHARE" }],
      "美股": [{ symbol: "usAAPL", name: "Apple", type: "US_STOCK" }],
    }, vscode.ConfigurationTarget.Global);

    await scheduler.refresh(true);
    await scheduler.refresh(true);
    assert.strictEqual(scheduler.getConsecutiveNetworkFailures(), 2);
    assert.ok(backoffArgs, "scheduleNextTick 必须调用 statusBar.setNetworkBackoff");
    assert.strictEqual(backoffArgs!.failures, 2);
    // standardInterval 兜底 >= 1000ms（当 refreshInterval = -500 时回退 5000ms 或 >= 1000ms），绝不为 0 或负数
    assert.ok(backoffArgs!.seconds >= 1, `退避秒数必须 >= 1s (实际: ${backoffArgs!.seconds}s)`);

    // 2. 验证 refreshGroup 在全量刷新进行中（isRefreshing = true）时不会静默丢弃，而是挂入 retryTimer 排队执行
    scheduler.stop();
    (scheduler as any).isRefreshing = true;
    const dummyGroup = new GroupItem("A股", []);
    await scheduler.refreshGroup(dummyGroup);

    // 此时因 isRefreshing 为 true，尚未真正执行，但已挂出 retryTimer 且 retryCount === 1
    assert.strictEqual(groupPolled, 0);
    assert.strictEqual((scheduler as any).retryCount, 1, "refreshGroup 并发冲突时应递增 retryCount 并排队");
    assert.ok((scheduler as any).retryTimer !== undefined, "refreshGroup 并发冲突时应挂出 retryTimer");

    // 释放锁并等待 retryTimer (300ms) 自动触发完成分组刷新
    (scheduler as any).isRefreshing = false;
    await new Promise((r) => setTimeout(r, 360));
    assert.strictEqual(groupPolled, 1, "retryTimer 到期后应自动补执行被阻塞的 refreshGroup");
    assert.strictEqual((scheduler as any).retryCount, 0, "成功执行后 retryCount 应复位为 0");
  } finally {
    scheduler.dispose();
    await cfg.update("refreshInterval", origInterval, vscode.ConfigurationTarget.Global);
    await cfg.update("watchlist", origWatchlist, vscode.ConfigurationTarget.Global);
  }
});

void test("BinanceService & DexScreenerService - 失效黑名单 10 分钟 TTL 到期后自动解封恢复", () => {
  const binance = new BinanceService();
  const dex = new DexScreenerService();

  const originalNow = Date.now;
  let fakeNow = 1_700_000_000_000;
  Date.now = () => fakeNow;

  try {
    const deadCoin = "DEADCOINUSDT";
    const deadAddr = "0x000000000000000000000000000000000000dead";

    // 1. 标记失效后立即处于抑制期
    binance.markSymbolInvalidForTest(deadCoin);
    (dex as any).markAddressInvalid(deadAddr);
    assert.strictEqual(binance.isSymbolSuppressed(deadCoin), true);
    assert.strictEqual(dex.isAddressSuppressed(deadAddr), true);

    // 2. 推进 5 分钟（尚未满 10 分钟 TTL）：依然处于抑制期
    fakeNow += 5 * 60 * 1000;
    assert.strictEqual(binance.isSymbolSuppressed(deadCoin), true, "5分钟未满 TTL 仍应保持抑制");
    assert.strictEqual(dex.isAddressSuppressed(deadAddr), true, "5分钟未满 TTL 仍应保持抑制");

    // 3. 推进超过 10 分钟 TTL（+6 分钟，累计 11 分钟）：自动解封恢复并清理过期键
    fakeNow += 6 * 60 * 1000;
    assert.strictEqual(binance.isSymbolSuppressed(deadCoin), false, "超过 10 分钟 TTL 后币安失效缓存应自动解封");
    assert.strictEqual(dex.isAddressSuppressed(deadAddr), false, "超过 10 分钟 TTL 后链上合约失效缓存应自动解封");
  } finally {
    Date.now = originalNow;
  }
});

void test("StatusBar & Extension - 网络退避 Tooltip 呈现与老板键期间 Webview 修改 maskMode 联动退出专注模式", async () => {
  const { StatusBar } = await import("../src/ui/statusBar.ts");
  const { activate, deactivate } = await import("../src/extension.ts");
  const { SettingsWebviewPanel } = await import("../src/ui/settingsWebview.ts");
  const vscode = await import("vscode");

  // 1. 验证 StatusBar.setNetworkBackoff 在正常模式下追加退避告警 Tooltip，在伪装模式下不泄露
  const bar = new StatusBar({ maskMode: false, colorNeutral: false });
  try {
    bar.setQuotes([
      { id: "sh600519", symbol: "sh600519", name: "贵州茅台", type: "A_SHARE", price: 1800, changePercent: 1.2 },
    ]);
    bar.setNetworkBackoff(3, 12);
    const normalTooltip = String((bar as any).barItem.tooltip || "");
    assert.ok(
      normalTooltip.includes("行情连接异常") && normalTooltip.includes("连续失败 3 次") && normalTooltip.includes("12s 后重试"),
      `正常模式下状态栏 Tooltip 应包含网络退避重试提示，实际: ${normalTooltip}`
    );

    // 恢复正常后退避提示消失
    bar.setNetworkBackoff(0, 0);
    const recoveredTooltip = String((bar as any).barItem.tooltip || "");
    assert.strictEqual(recoveredTooltip.includes("行情连接异常"), false, "网络恢复后应清除退避提示");
  } finally {
    bar.dispose();
  }

  // 2. 验证老板键（专注模式）激活期间，Webview 触发 onDidUpdateSetting("maskMode", true) 会自动解除老板键
  const subscriptions: { dispose(): void }[] = [];
  const mockContext: any = {
    subscriptions,
    extensionUri: vscode.Uri.file("/mock"),
    extension: { packageJSON: { version: "1.2.6" } },
    globalState: {
      get: (_k: string, def: unknown) => def,
      update: async () => {},
    },
  };

  await activate(mockContext);
  try {
    // 先触发老板键进入隐身状态
    await vscode.commands.executeCommand("marketlens.toggleBossKey");
    // 此时通过 SettingsWebviewPanel.onDidUpdateSetting 修改 maskMode
    assert.ok(typeof SettingsWebviewPanel.onDidUpdateSetting === "function");
    SettingsWebviewPanel.onDidUpdateSetting!("maskMode", true);

    // 再次调用 toggleBossKey 应当是从 false -> true（说明方才 maskMode 修改已自动将 bossKey 复位为 false）
    await vscode.commands.executeCommand("marketlens.toggleBossKey");
    // 再次恢复
    await vscode.commands.executeCommand("marketlens.toggleBossKey");
  } finally {
    deactivate();
    for (const sub of subscriptions) {
      try { sub.dispose(); } catch {}
    }
  }
});

void test("P1-6 时区口径回归 - 节假日覆盖护栏的年份必须与查表时区同源", () => {
  // 同一瞬间 2027-12-31T20:00Z：纽约侧仍是 2027-12-31（覆盖内），北京侧已跨入 2028-01-01（超限）
  const instant = new Date("2027-12-31T20:00:00Z");
  assert.strictEqual(
    checkHolidayCoverage(instant, newYorkDateFormatter),
    true,
    "美股查表键按美东取年，护栏必须同口径，否则会因宿主机时区误报超限"
  );
  assert.strictEqual(
    checkHolidayCoverage(instant, beijingDateFormatter),
    false,
    "A股/港股查表键按北京取年，跨年边界必须判定为已超出覆盖上限"
  );

  // 默认参数保持向后兼容（北京口径，与 A股/港股调用点一致）
  assert.strictEqual(checkHolidayCoverage(new Date("2026-06-01T04:00:00Z")), true);

  // 占位预测年份护栏：2027 仍是预测数据，2026 已为官方终版
  assert.strictEqual(FORECAST_HOLIDAY_YEARS.has(2027), true, "2027 日历尚未复核，必须留在预测集合内");
  assert.strictEqual(FORECAST_HOLIDAY_YEARS.has(MAX_COVERED_HOLIDAY_YEAR - 1), false);
  assert.strictEqual(
    A_SHARE_HOLIDAYS.has("2027-02-05"),
    true,
    "2027 除夕为全日休市；半日市/提前收盘严禁写入日历（§5.5）"
  );
});

void test("audit - 魔法数字常量化与休市日历年度过期护栏验证 (M3 & M4)", () => {
  // 1. 验证网络超时三元组常量、探活超时与预警冷却常量
  assert.strictEqual(DEFAULT_REQUEST_TIMEOUT_MS, 5000);
  assert.strictEqual(SYSTEM_PROXY_FALLBACK_TIMEOUT_MS, 2500);
  assert.strictEqual(QUICK_PROXY_PROBE_TIMEOUT_MS, 1500);
  assert.strictEqual(PORT_PROBE_TIMEOUT_MS, 600);
  assert.strictEqual(DEFAULT_ALERT_COOLDOWN_MINUTES, 15);

  // 2. 验证休市日历年度过期护栏：有效年份返回 true，超出上限年份返回 false 并按年度独立护栏拦截
  assert.strictEqual(checkHolidayCoverage(new Date("2026-10-13")), true);
  assert.strictEqual(checkHolidayCoverage(new Date("2027-12-31")), true);
  assert.strictEqual(checkHolidayCoverage(new Date("2028-01-01")), false);
  assert.strictEqual(checkHolidayCoverage(new Date("2029-01-01")), false);

  // 3. 验证 stripMarketPrefix 跨格式统一剥离前缀 (P-3)
  assert.strictEqual(stripMarketPrefix("hk00700"), "00700");
  assert.strictEqual(stripMarketPrefix("hk/00700"), "00700");
  assert.strictEqual(stripMarketPrefix("us.BRK/B"), "brk/b");
  assert.strictEqual(stripMarketPrefix("us/AAPL"), "aapl");
  assert.strictEqual(stripMarketPrefix("sh600519"), "600519");
  assert.strictEqual(stripMarketPrefix("sz000001"), "000001");
  assert.strictEqual(stripMarketPrefix("bj830799"), "830799");
  assert.strictEqual(stripMarketPrefix("AAPL"), "aapl");
  assert.strictEqual(stripMarketPrefix(""), "");

  // 4. 验证 getWatchlistFingerprint 规范化一致性 (P-4)
  const fp1 = getWatchlistFingerprint({ "美股": ["us.AAPL"] });
  const fp2 = getWatchlistFingerprint({ "美股": ["AAPL"] });
  assert.strictEqual(fp1, fp2, "不同前缀形式的同一标的指纹应完全相同，避免无意义全量重启");
});

void test("F1 & F2: 持仓成本浮动盈亏计算、脱敏遮罩与大盘指数导入契约", async () => {
  const { StockItem } = await import("../src/ui/watchlistProvider.ts");
  const { WatchlistOps } = await import("../src/watchlistOps.ts");
  const vscode = await import("vscode");

  // 1. sanitizeWatchlist 正确保留有效 cost 与 shares，过滤非法负数与 NaN
  const sanitized = sanitizeWatchlist({
    "A股": [
      { symbol: "sh600519", name: "贵州茅台", type: "A_SHARE", cost: 1600, shares: 100 },
      { symbol: "sz000001", name: "平安银行", type: "A_SHARE", cost: -10, shares: "invalid" },
      { symbol: "sh61398", name: "工商银行", type: "A_SHARE", cost: 5.5, shares: 1000 },
    ],
  });
  assert.strictEqual(sanitized["A股"][0].cost, 1600);
  assert.strictEqual(sanitized["A股"][0].shares, 100);
  assert.strictEqual(sanitized["A股"][1].cost, undefined, "负数成本应被过滤");
  assert.strictEqual(sanitized["A股"][1].shares, undefined, "非数字持仓应被过滤");
  assert.strictEqual(sanitized["A股"][2].cost, 5.5);
  assert.strictEqual(sanitized["A股"][2].shares, 1000);

  // 2. StockItem 盈利状态渲染 (现价 1800, 成本 1600, 100 股)
  const itemProfit: MarketItem = {
    id: "sh600519",
    name: "贵州茅台",
    symbol: "sh600519",
    type: "A_SHARE",
    price: 1800,
    changePercent: 1.5,
    currency: "CNY",
  };
  const nodeProfit = new StockItem(
    itemProfit,
    "A股",
    "sh600519",
    false, // maskMode
    false,
    undefined,
    "贵州茅台",
    "greenUpRedDown",
    1600,
    100
  );
  // 浮盈: (1800 - 1600) * 100 = 20,000 = 2.00万，收益率: +12.5%
  assert.ok(nodeProfit.description?.toString().includes("+¥2.00万 (+12.5%)"), "盈利应格式化输出万分位与收益率");
  const tooltipProfit = (nodeProfit.tooltip as any)?.value || String(nodeProfit.tooltip || "");
  assert.ok(tooltipProfit.includes("持仓盈亏对账"), "Tooltip 应包含持仓盈亏对账");
  assert.ok(tooltipProfit.includes("今日盈亏"), "Tooltip 应包含今日盈亏");
  assert.ok(tooltipProfit.includes("累计浮盈"), "Tooltip 应包含累计浮盈");
  assert.ok(tooltipProfit.includes("+¥2.00万"), "Tooltip 应包含累计浮盈金额");

  // 3.1 测试 Alpha 链上代币 Tooltip 持仓盈亏对账与双货币符号防回归
  const itemAlpha: MarketItem = {
    id: "0x73b84f7e3901f39fc29f3704a03126d317ab4444",
    name: "PUP",
    symbol: "PUP",
    type: "ALPHA_TOKEN",
    price: 0.000291,
    changePercent: -6.59,
    currency: "USD",
  };
  const nodeAlpha = new StockItem(
    itemAlpha,
    "Alpha",
    "0x73b84f7e3901f39fc29f3704a03126d317ab4444",
    false,
    false,
    undefined,
    "PUP",
    "greenUpRedDown",
    0.000300,
    3000000
  );
  const tooltipAlpha = (nodeAlpha.tooltip as any)?.value || String(nodeAlpha.tooltip || "");
  assert.ok(tooltipAlpha.includes("持仓盈亏对账"), "Alpha Tooltip 应包含持仓盈亏对账");
  assert.ok(tooltipAlpha.includes("$0.000300"), "Alpha Tooltip 应包含持仓均价");
  assert.ok(tooltipAlpha.includes("3,000,000"), "Alpha Tooltip 应包含千分位持仓数量");
  assert.ok(tooltipAlpha.includes("今日盈亏"), "Alpha Tooltip 应包含今日盈亏");
  assert.ok(tooltipAlpha.includes("累计浮盈"), "Alpha Tooltip 应包含累计浮盈");
  assert.strictEqual(tooltipAlpha.includes("$$"), false, "Alpha Tooltip 严禁出现双货币符号 $$");

  // 3. StockItem 亏损状态渲染 (现价 1500, 成本 1600, 100 股)
  const itemLoss: MarketItem = {
    id: "sh600519",
    name: "贵州茅台",
    symbol: "sh600519",
    type: "A_SHARE",
    price: 1500,
    changePercent: -2.0,
    currency: "CNY",
  };
  const nodeLoss = new StockItem(
    itemLoss,
    "A股",
    "sh600519",
    false,
    false,
    undefined,
    "贵州茅台",
    "greenUpRedDown",
    1600,
    100
  );
  // 浮亏: (1500 - 1600) * 100 = -10,000 = -1.00万，收益率: -6.25% -> -6.3%
  assert.ok(nodeLoss.description?.toString().includes("-¥1.00万 (-6.3%)"), "亏损应正确渲染负号");

  // 4. 摸鱼脱敏模式 (maskMode = true) 下一票否决持仓数字泄露
  const nodeMasked = new StockItem(
    itemProfit,
    "A股",
    "sh600519",
    true, // maskMode = true
    false,
    undefined,
    "贵州茅台",
    "greenUpRedDown",
    1600,
    100
  );
  assert.ok(nodeMasked.description?.toString().includes("[***]"), "脱敏模式下持仓浮盈应打码为 [***]");
  assert.strictEqual(nodeMasked.description?.toString().includes("2.00万"), false, "脱敏模式严禁泄露真实盈亏");
  assert.strictEqual(nodeMasked.description?.toString().includes("1800"), false, "脱敏模式严禁泄露现价");

  // 5. WatchlistOps addCommonIndices 一键导入大盘指数
  let savedWatchlist: WatchlistConfig = {};
  await vscode.workspace.getConfiguration("marketlens").update("watchlist", {
    "A股": [{ symbol: "sh600519", name: "贵州茅台", type: "A_SHARE" }],
  }, vscode.ConfigurationTarget.Global);

  const ops = new WatchlistOps({
    quoteCache: new Map(),
    rebuildTree: (wl) => {
      if (wl) savedWatchlist = wl;
    },
  });
  await ops.addCommonIndices();
  assert.ok(savedWatchlist["A股"].some((it: WatchConfigItem) => it.symbol === "sh000001"), "应导入上证指数");
  assert.ok(savedWatchlist["港股"].some((it: WatchConfigItem) => it.symbol === "hkHSI"), "应导入恒生指数");
  assert.ok(savedWatchlist["美股"].some((it: WatchConfigItem) => it.symbol === "us.IXIC"), "应导入纳斯达克");
  assert.ok(savedWatchlist["Binance"].some((it: WatchConfigItem) => it.symbol === "BTCUSDT"), "应导入比特币");

  // 再次执行应幂等防重
  const originalCount = savedWatchlist["A股"].length;
  await vscode.workspace.getConfiguration("marketlens").update("watchlist", savedWatchlist, vscode.ConfigurationTarget.Global);
  await ops.addCommonIndices();
  assert.strictEqual(savedWatchlist["A股"].length, originalCount, "重复执行不应重复追加已有指数");

  // 6. 验证通用与全局设置 Webview 面板包含一键导入大盘指数按钮
  const { getSettingsWebviewHtml } = await import("../src/ui/settingsHtml.ts");
  const html = getSettingsWebviewHtml("nonce123", "1.2.6", "vscode-resource://", {} as any);
  assert.ok(html.includes("btnAddCommonIndices"), "Webview HTML 必须包含 btnAddCommonIndices 按钮");
  assert.ok(html.includes("一键导入全球大盘指数"), "Webview HTML 必须包含一键导入全球大盘指数说明");
});

void test("F3: 状态栏持仓盈亏独立轮播条 (方案3智能混合模式 + 模式B摸鱼伪装安全防线 + 自定义间隔)", async () => {
  const { StatusBar } = await import("../src/ui/statusBar.ts");
  const { readConfig } = await import("../src/utils/config.ts");
  const { getSettingsWebviewHtml } = await import("../src/ui/settingsHtml.ts");

  // 1. 初始化 StatusBar
  const bar = new StatusBar({ maskMode: false, colorNeutral: false, colorScheme: "greenUpRedDown" });
  try {
    const mockHoldings = [
      {
        name: "贵州茅台",
        symbol: "sh600519",
        currency: "CNY" as const,
        cost: 1600,
        shares: 100,
        price: 1800,
        changePercent: 1.25,
        change: 22.5,
      },
      {
        name: "PUP",
        symbol: "PUPUSDT",
        currency: "USD" as const,
        cost: 0.000300,
        shares: 3000000,
        price: 0.000291,
        changePercent: -6.59,
        change: -0.0000205,
      },
    ];

    // 2. setHoldings 触发渲染 Frame 0 (全账户总账)
    bar.setHoldings(mockHoldings, true, 3);
    const holdingItem = (bar as any).holdingBarItem;
    assert.ok(holdingItem.text.includes("今日:"), "第0帧应展示全账户今日盈亏总账");
    assert.ok(holdingItem.text.includes("浮盈:"), "第0帧应展示全账户累计浮盈总账");
    assert.ok(holdingItem.text.includes("¥"), "第0帧应展示主导币种符号");
    assert.ok(bar.isHoldingCarouselRunning(), "轮播定时器应当处于运行中");

    // 3. 悬停 Tooltip 验证
    const tooltip = holdingItem.tooltip?.value || String(holdingItem.tooltip || "");
    assert.ok(tooltip.includes("持仓盈亏独立对账看板"), "Tooltip 应包含持仓对账标题");
    assert.ok(tooltip.includes("贵州茅台"), "Tooltip 应包含茅台持仓明细");
    assert.ok(tooltip.includes("PUP"), "Tooltip 应包含 PUP 持仓明细");

    // 4. 模拟轮播下一帧 Frame 1 (单标的茅台)
    (bar as any).holdingIndex = 1;
    (bar as any).renderHolding();
    assert.ok(holdingItem.text.includes("贵州茅台"), "第1帧应展示贵州茅台");
    assert.ok(holdingItem.text.includes("[1/2]"), "第1帧应展示标的序号 [1/2]");

    // 5. 模拟轮播下一帧 Frame 2 (单标的 PUP)
    (bar as any).holdingIndex = 2;
    (bar as any).renderHolding();
    assert.ok(holdingItem.text.includes("PUP"), "第2帧应展示 PUP");
    assert.ok(holdingItem.text.includes("[2/2]"), "第2帧应展示标的序号 [2/2]");

    // 6. 模式 B 守卫验证：切换摸鱼伪装模式 (maskMode = true)，一票否决彻底隐藏
    bar.setMaskMode(true);
    assert.strictEqual(holdingItem.text, "", "摸鱼模式下持仓状态栏条目文本必须清空");
    assert.strictEqual(bar.isHoldingCarouselRunning(), false, "摸鱼模式下轮播定时器必须停止");

    // 切回正常模式
    bar.setMaskMode(false);
    assert.ok(holdingItem.text.length > 0, "切回正常模式后应恢复持仓显示");
    assert.ok(bar.isHoldingCarouselRunning(), "切回正常模式后应重启轮播定时器");

    // 7. 老板键守卫验证：按下老板键 (bossKey = true)，一票否决彻底隐藏
    bar.toggleBossKey(true);
    assert.strictEqual(holdingItem.text, "", "老板键激活下持仓状态栏条目必须清空");
    assert.strictEqual(bar.isHoldingCarouselRunning(), false, "老板键激活下轮播定时器必须停止");

    // 再次按下恢复
    bar.toggleBossKey(false);
    assert.ok(holdingItem.text.length > 0, "解除老板键后应恢复持仓展示");

    // 8. 无持仓时自动静默隐藏
    bar.setHoldings([], true, 3);
    assert.strictEqual(holdingItem.text, "", "无持仓标的时应自动静默隐藏");
    assert.strictEqual(bar.isHoldingCarouselRunning(), false, "无持仓标的时定时器应停止");
  } finally {
    bar.dispose();
  }

  // 9. 配置与设置 Webview 验证
  const cfg = readConfig();
  assert.strictEqual(cfg.statusBar.holdingEnabled, true, "holdingEnabled 默认应为 true");
  assert.strictEqual(cfg.statusBar.holdingInterval, 3, "holdingInterval 默认应为 3 秒");

  const html = getSettingsWebviewHtml("test-nonce", "1.2.6", "vscode-resource://", {} as any);
  assert.ok(html.includes("statusBarHoldingEnabled"), "设置面板必须包含 statusBarHoldingEnabled 开关");
  assert.ok(html.includes("statusBarHoldingInterval"), "设置面板必须包含 statusBarHoldingInterval 输入框");
  assert.ok(html.includes("持仓盈亏独立轮播条"), "设置面板必须包含持仓盈亏独立轮播条标题");
});

void test("P-12 ~ P-15: 状态栏持仓总控/板块过滤、Tooltip安全基线、order去冲突与边界钳制防线", async () => {
  const { extractHoldingQuotes } = await import("../src/utils/symbolHelper.ts");
  const { StatusBar } = await import("../src/ui/statusBar.ts");
  const fs = await import("node:fs");

  const mockWatchlist = {
    "A股": [
      { symbol: "sh600519", name: "贵州茅台", type: "A_SHARE" as const, cost: 1600, shares: 100 },
    ],
    "美股": [
      { symbol: "usAAPL", name: "苹果", type: "US_STOCK" as const, cost: 150, shares: 10 },
    ],
    "基金": [
      { symbol: "sh510300", name: "沪深300ETF", type: "A_SHARE" as const, cost: 3.5, shares: 1000 },
    ],
  };

  const mockCache = new Map<string, any>([
    ["sh600519", { id: "sh600519", symbol: "sh600519", name: "贵州茅台", type: "A_SHARE", price: 1800, changePercent: 1.0 }],
    ["usaapl", { id: "usAAPL", symbol: "usAAPL", name: "苹果", type: "US_STOCK", price: 200, changePercent: 2.0, currency: "USD" }],
    ["sh510300", { id: "sh510300", symbol: "sh510300", name: "沪深300ETF", type: "A_SHARE", price: 4.0, changePercent: 0.5 }],
  ]);

  // 1. P-12: statusBarEnabled = false 时 extractHoldingQuotes 必须直接返回空数组
  const noStatusBarHoldings = extractHoldingQuotes(mockWatchlist, mockCache, {
    statusBarEnabled: false,
  });
  assert.strictEqual(noStatusBarHoldings.length, 0, "总控关闭时持仓行情必须为空");

  // 2. P-12: 分板块开关过滤（例如关闭美股 statusBar）
  const noUsHoldings = extractHoldingQuotes(mockWatchlist, mockCache, {
    statusBarEnabled: true,
    usStock: { enabled: true, statusBar: false },
    aShare: { enabled: true, statusBar: true },
    fund: { enabled: true, statusBar: true },
  });
  assert.strictEqual(noUsHoldings.some((h) => h.symbol === "usAAPL"), false, "美股状态栏关闭时不应提取美股持仓");
  assert.strictEqual(noUsHoldings.some((h) => h.symbol === "sh600519"), true, "A股正常开启时应保留A股持仓");

  // 3. P-12: 基金板块关闭时过滤
  const noFundHoldings = extractHoldingQuotes(mockWatchlist, mockCache, {
    statusBarEnabled: true,
    fund: { enabled: false, statusBar: true },
    aShare: { enabled: true, statusBar: true },
  });
  assert.strictEqual(noFundHoldings.some((h) => h.symbol === "sh510300"), false, "基金板块关闭时不应提取基金持仓");

  // 4. P-13: Tooltip 安全基线验证 (isTrusted = false, supportHtml = false, 特殊字符名称转义)
  const bar = new StatusBar({ maskMode: false, colorNeutral: false });
  try {
    bar.setHoldings([
      {
        name: "<img src=x onerror=alert(1)>测试标的",
        symbol: "sh000001",
        currency: "CNY",
        cost: 3000,
        shares: 100,
        price: 3200,
        changePercent: 1.0,
      },
    ]);
    const holdingItem = (bar as any).holdingBarItem;
    const tooltip = holdingItem.tooltip;
    assert.strictEqual(tooltip.isTrusted, false, "Tooltip isTrusted 必须为 false 贯彻最小权限");
    assert.strictEqual(tooltip.supportHtml, false, "Tooltip supportHtml 必须为 false 杜绝 HTML 注入");
    assert.strictEqual(tooltip.value.includes("<img src=x"), false, "外部标的名称必须转义，严禁原样输出 HTML 标签");
    assert.ok(tooltip.value.includes("&lt;img"), "特殊 HTML 字符必须被转义");
  } finally {
    bar.dispose();
  }

  // 5. P-14: package.json order 序号冲突验证 (holdingEnabled 64, holdingInterval 65, 不与 70/71 冲突)
  const pkgContent = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const props = pkgContent.contributes.configuration.properties;
  assert.strictEqual(props["marketlens.statusBar.holdingEnabled"].order, 64, "holdingEnabled order 应为 64");
  assert.strictEqual(props["marketlens.statusBar.holdingInterval"].order, 65, "holdingInterval order 应为 65");
  assert.strictEqual(props["marketlens.alerts"].order, 70, "alerts order 应为 70");
  assert.notStrictEqual(props["marketlens.statusBar.holdingEnabled"].order, props["marketlens.alerts"].order, "holdingEnabled 与 alerts 严禁 order 冲突");

  // 6. P-15: holdingInterval 边界钳制验证 (1~60s)
  const testBar = new StatusBar({ maskMode: false, colorNeutral: false });
  try {
    testBar.setHoldings([{ name: "test", symbol: "test", currency: "CNY", cost: 1, shares: 1, price: 1, changePercent: 0 }], true, 100);
    assert.strictEqual((testBar as any).holdingInterval, 60, "超上限数值应钳制在 60s");
    testBar.setHoldings([{ name: "test", symbol: "test", currency: "CNY", cost: 1, shares: 1, price: 1, changePercent: 0 }], true, -10);
    assert.strictEqual((testBar as any).holdingInterval, 1, "负数应钳制在 1s");
    testBar.setHoldings([{ name: "test", symbol: "test", currency: "CNY", cost: 1, shares: 1, price: 1, changePercent: 0 }], true, NaN);
    assert.strictEqual((testBar as any).holdingInterval, 3, "NaN 应安全回退默认值 3s");
  } finally {
    testBar.dispose();
  }
});

void test("计价货币单一出口 - 加密与链上标的按 U 本位（USDT）计价", async () => {
  const { resolveQuoteCurrency } = await import("../src/utils/symbolHelper.ts");
  const { StatusBar } = await import("../src/ui/statusBar.ts");

  // 1. 类型兜底：三类虚拟资产一律 USDT，且不得被美股 USD 兜底截胡
  assert.strictEqual(resolveQuoteCurrency({ type: "CRYPTO" }), "USDT");
  assert.strictEqual(resolveQuoteCurrency({ type: "BSC_TOKEN" }), "USDT");
  assert.strictEqual(resolveQuoteCurrency({ type: "ALPHA_TOKEN" }), "USDT");
  assert.strictEqual(resolveQuoteCurrency({ type: "A_SHARE" }), "CNY");
  assert.strictEqual(resolveQuoteCurrency({ type: "HK_STOCK" }), "HKD");
  assert.strictEqual(resolveQuoteCurrency({ type: "US_STOCK" }), "USD");

  // 2. 显式 currency 优先于类型推导（§5.5 资产类型裁决序）
  assert.strictEqual(resolveQuoteCurrency({ currency: "USD", type: "CRYPTO" }), "USD");

  // 3. 持仓看板按币种分桶：USDT 不得与美股美元混进同一桶，否则盈亏合计会串币种
  const bar = new StatusBar({ maskMode: false, colorNeutral: false });
  try {
    bar.setHoldings([
      { name: "比特币", symbol: "BTCUSDT", currency: "USDT", cost: 60000, shares: 1, price: 65000, changePercent: 1.5 },
      { name: "苹果", symbol: "usAAPL", currency: "USD", cost: 180, shares: 10, price: 200, changePercent: 2.0 },
    ]);
    const buckets = (bar as any).aggregateHoldings() as Array<[string, { count: number }]>;
    const labels = buckets.map(([cur]) => cur);
    assert.ok(labels.includes("USDT"), "加密持仓必须独立成 U 本位桶");
    assert.strictEqual(buckets.find(([cur]) => cur === "USDT")?.[1].count, 1);
    assert.strictEqual(buckets.find(([cur]) => cur === "USD")?.[1].count, 1);
  } finally {
    bar.dispose();
  }
});

// AGENTS.md §5.1 红线：每一组已注册键位都必须在文档中可见。
// 旧版规约把这条写成「已有 unit.test.ts 用例」，但那个用例从未存在，只能靠人工跑 shell 探针。
// 本用例即为该缺口的收口：读 package.json 的 keybindings，逐条（含 win / mac 变体）
// 比对双语 README 与设置面板 About 速查段。
void test("§5.1 键位文档化契约 - 每个已注册键位都必须在双语 README 与设置面板速查中可见", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
  const pkg = JSON.parse(read("package.json").replace(/^\uFEFF/, ""));
  const keybindings: Array<{ command: string; key?: string; win?: string; mac?: string }> =
    pkg.contributes?.keybindings ?? [];

  assert.ok(keybindings.length > 0, "package.json 必须至少注册一组键位");

  // 与 README 快捷键表、About 速查段一致的展示写法：控制键首字母大写、以 " + " 连接、字母键大写
  const toDisplay = (raw: string) =>
    raw
      .split("+")
      .map((part) => {
        const p = part.trim().toLowerCase();
        if (p === "ctrl") return "Ctrl";
        if (p === "cmd") return "Cmd";
        if (p === "alt") return "Alt";
        if (p === "shift") return "Shift";
        return p.length === 1 ? p.toUpperCase() : p;
      })
      .join(" + ");

  const docs = [
    { file: "README.md", text: read("README.md") },
    { file: "README.en.md", text: read("README.en.md") },
    { file: "src/ui/settingsHtml.ts", text: read("src/ui/settingsHtml.ts") },
  ];

  const missing: string[] = [];
  for (const kb of keybindings) {
    for (const field of ["key", "win", "mac"] as const) {
      const raw = kb[field];
      if (!raw) continue;
      const display = toDisplay(raw);
      for (const doc of docs) {
        if (!doc.text.includes(display)) {
          missing.push(`${kb.command} 的 ${field}="${raw}"（文档写法「${display}」）缺失于 ${doc.file}`);
        }
      }
    }
  }

  assert.deepStrictEqual(missing, [], `以下已注册键位未在文档中露出（AGENTS.md §5.1）：\n${missing.join("\n")}`);
});

// ── AGENTS.md §5.4 脱敏红线 / §5.6 异步与生命周期 回归补口（体检报告 P1-2、P2-1、P2-2、P2-3、P2-5）──

/**
 * 捕获 logger sink 落到宿主 console 的行。
 * mock 的 `OutputChannel.appendLine` 是空实现，日志取证只能走 console 侧；
 * 而 sink 刻意让两个通道共用同一行已清洗文本，所以这里取到的就是通道里的那一行。
 */
async function withCapturedConsole(run: () => void | Promise<void>): Promise<string[]> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines;
}

/** 让未被接住的 Promise 拒绝在本轮测试里显性失败，而不是悄悄冒成进程级 unhandledRejection */
async function assertNoUnhandledRejection(run: () => void | Promise<void>): Promise<void> {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown) => {
    seen.push(reason);
  };
  process.on("unhandledRejection", onRejection);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onRejection);
  }
  assert.deepStrictEqual(seen, [], "存在未被接住的 Promise 拒绝（AGENTS.md §5.6）");
}

void test("P1-2 回归 - 日志红线：标识只落不可逆标签，外部文本进 sink 前统一清洗", async () => {
  // 1. describeForLog：定长十六进制标签、跨调用可复现，且不保留原文可辨识片段
  const tag = describeForLog("sh600519");
  assert.match(tag, /^#[0-9a-f]{6}$/, "标签必须是 sha1 前 6 位十六进制");
  assert.strictEqual(tag, describeForLog("sh600519"), "同一标的在任何进程必须得到同一标签（跨行关联用）");
  assert.ok(!tag.includes("600519"), "标签不得回显标的代码");
  assert.notStrictEqual(describeForLog("sh600519"), describeForLog("sz000001"), "不同标的不得撞标签");
  assert.strictEqual(describeForLog(""), "#<empty>");
  assert.strictEqual(describeForLog(undefined), "#<empty>");

  // 2. describeListForLog：整幅自选清单折叠成「数量 + 最多 3 个标签」
  const symbols = ["sh600519", "sz000001", "hk00700", "usTSLA", "BTCUSDT", "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"];
  const collapsed = describeListForLog(symbols);
  assert.ok(collapsed.startsWith("6 项 ["), `应保留数量: ${collapsed}`);
  assert.strictEqual((collapsed.match(/#/g) ?? []).length, 3, "最多只允许 3 个标签");
  for (const sym of symbols) {
    assert.ok(!collapsed.includes(sym), `折叠结果不得回显 ${sym}`);
  }

  // 3. scrubForLog：URL（常把整批代码带在查询串）与长标识串被替换，短错误词保持可读
  const dirty = "getaddrinfo ECONNREFUSED https://qt.gtimg.cn/q=sh600519,sz000001 timeout of 15000ms";
  const cleaned = scrubForLog(dirty);
  assert.ok(!cleaned.includes("sh600519") && !cleaned.includes("sz000001"), cleaned);
  assert.ok(!cleaned.includes("qt.gtimg.cn"), `URL 本体也必须消失: ${cleaned}`);
  assert.ok(cleaned.includes("ECONNREFUSED") && cleaned.includes("timeout"), "可读诊断词不得被顺手哈希掉");
  const addr = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
  assert.ok(!scrubForLog(`token ${addr} failed`).includes(addr), "合约地址必须收敛为标签");

  // 4. 错误对象：只留错误名 + 清洗后的消息
  const axiosLike = Object.assign(new Error("请求 https://qt.gtimg.cn/q=sh600519 失败"), { name: "AxiosError" });
  const described = describeErrorForLog(axiosLike);
  assert.ok(described.startsWith("AxiosError: "), described);
  assert.ok(!described.includes("sh600519") && !described.includes("qt.gtimg.cn"), described);

  // 5. describeErrorNameForLog：JSON.parse 这类「消息内嵌被解析内容」的错误只留错误名
  assert.strictEqual(describeErrorNameForLog(new SyntaxError('Unexpected token } in JSON at position 42 "sh600519"')), "SyntaxError");
  assert.strictEqual(describeErrorNameForLog(undefined), "unknown");
  assert.strictEqual(describeErrorNameForLog("纯字符串错误"), "unknown");

  // 6. formatDetailForLog：字符串、Error.stack、普通对象三条分支都要清洗
  assert.ok(!formatDetailForLog("见 https://api.binance.com/api/v3/ticker?symbols=BTCUSDT").includes("BTCUSDT"));
  assert.ok(!formatDetailForLog(Object.assign(new Error("https://dexscreener.com/bsc/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"))).includes("dexscreener.com"));
  assert.strictEqual(formatDetailForLog(null), "");
  assert.strictEqual(formatDetailForLog(undefined), "");

  // 7. sink 级取证：真实调用 logger 公共入口，两条通道必须共用同一行已清洗文本
  const sinkLines = await withCapturedConsole(async () => {
    logger.warn("行情请求失败", new Error("request to https://qt.gtimg.cn/q=sh600519,sz000001 failed: 503"));
    logger.info(`失效标的已抑制 ${describeForLog("sh600519")} 冷却 5 分钟`);
  });
  const joined = sinkLines.join("\n");
  assert.ok(joined.includes("[MarketLens] 行情请求失败"), joined);
  assert.ok(!joined.includes("sh600519") && !joined.includes("sz000001"), `日志行不得含标的代码: ${joined}`);
  assert.ok(!joined.includes("qt.gtimg.cn"), `日志行不得含完整 URL: ${joined}`);
  assert.match(joined, /失效标的已抑制 #?[0-9a-f]{6}/, "标签形态必须是 #xxxxxx");
});

void test("P2-2 回归 - Tooltip 富文本消毒：报文不得拼出 Markdown 链接或顶破表格行", async () => {
  const { StockItem } = await import("../src/ui/watchlistProvider.ts");
  // 1. 行内消毒：方括号被反斜杠顶住，`[文案](url)` 与 `command:` 链接语法失效
  const linkPayload = escapeMarkdownInline("[取关](command:marketlens.clearWatchlist)");
  assert.ok(linkPayload.includes("\\[取关\\]"), linkPayload);
  const bareBrackets = linkPayload.replace(/\\[[\]`]/g, "");
  assert.ok(!bareBrackets.includes("[") && !bareBrackets.includes("]"), `方括号必须全部带反斜杠: ${linkPayload}`);

  // 2. 换行必须折叠，否则报文能顶破标题行与表格行注入新条目
  const newlinePayload = escapeMarkdownInline("茅台\n| 列A | 列B |\n|---|---|");
  assert.ok(!newlinePayload.includes("\n"), "行内文本不得保留换行");
  assert.ok(/茅台 .*\|/.test(newlinePayload), newlinePayload);

  // 3. HTML 实体继续被转义（supportHtml=false 之外的第二层防线）
  assert.strictEqual(escapeMarkdownInline(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.strictEqual(escapeMarkdownInline(null), "");
  assert.strictEqual(escapeMarkdownInline(undefined), "");

  // 4. 代码段：反引号在代码段内无法用反斜杠转义，只能删除，防止报文提前闭合
  const codeSpan = toMarkdownCodeSpan("0xdead`beef\n`闭合");
  assert.ok(codeSpan.startsWith("`") && codeSpan.endsWith("`"), codeSpan);
  assert.ok(!codeSpan.slice(1, -1).includes("`"), `代码段内部不得残留反引号: ${codeSpan}`);
  assert.ok(!codeSpan.includes("\n"), "代码段不得跨行");
  assert.strictEqual(toMarkdownCodeSpan(null), "``", "缺失标识只留空代码段，不得写出 \"null\" 字样");

  // 5. 真实节点：标的名来自行情报文，注入链接必须被中和
  const evilName = "[付款](command:workbench.action.openGlobalSettings)";
  const item: MarketItem = {
    id: "sh600519",
    symbol: "sh600519",
    name: evilName,
    type: "A_SHARE",
    price: 1800,
    changePercent: 1.5,
    currency: "CNY",
  };
  const node = new StockItem(item, "A股", "sh600519", false, false, undefined, evilName, "greenUpRedDown");
  const tip = String((node.tooltip as any)?.value ?? "");
  assert.ok(tip.includes("\\[付款\\]"), `Tooltip 必须携带转义后的标的名: ${tip}`);
  assert.ok(!tip.includes(evilName), "报文原文不得原样进 Tooltip");

  // 6. Alpha 卡片：标的名走行内转义、合约地址走代码段，两条路都不能拼出可点链接
  const alphaItem: MarketItem = {
    id: "0xdeadbeef`[x](command:evil)",
    symbol: "PUP`",
    name: "PUP](command:x)",
    type: "ALPHA_TOKEN",
    price: 0.000291,
    changePercent: -6.59,
    currency: "USD",
    chain: "bsc",
    dex: "pancakeswap",
  };
  const alphaNode = new StockItem(alphaItem, "Alpha", alphaItem.id!, false, false, undefined, "PUP", "greenUpRedDown");
  const alphaTip = String((alphaNode.tooltip as any)?.value ?? "");
  assert.ok(alphaTip.includes("PUP\\]"), `行内文本的方括号必须带反斜杠: ${alphaTip}`);
  assert.ok(!alphaTip.includes("PUP]("), "标的名不得拼出可点击的 Markdown 链接");
  assert.ok(!alphaTip.includes("PUP``"), `标的代码内的反引号必须被剥离: ${alphaTip}`);
  // 反引号在代码段内无法转义，只能删除；否则报文可提前闭合代码段再拼富文本
  assert.ok(!alphaTip.includes("0xdeadbeef`"), `合约地址内的反引号必须被剥离: ${alphaTip}`);
  assert.ok(alphaTip.includes("`0xdeadbeef[x](command:evil)`"), "整段报文必须被完整关进一个代码段");
});

void test("P2-3 回归 - 脱敏态下预警铃铛与价格同等对待", async () => {
  const { StockItem } = await import("../src/ui/watchlistProvider.ts");
  const item: MarketItem = {
    id: "sh600519",
    symbol: "sh600519",
    name: "贵州茅台",
    type: "A_SHARE",
    price: 1800,
    changePercent: 1.5,
    currency: "CNY",
  };
  const rule: PriceAlertItem = { symbol: "sh600519", name: "贵州茅台", above: 1900, enabled: true };

  const visible = new StockItem(item, "A股", "sh600519", false, false, rule, "贵州茅台", "greenUpRedDown");
  assert.ok(String(visible.description ?? "").includes("🔔"), "常态下铃铛应提示该标的设有预警");

  const masked = new StockItem(item, "A股", "sh600519", true, false, rule, "贵州茅台", "greenUpRedDown");
  const maskedDesc = String(masked.description ?? "");
  assert.ok(!maskedDesc.includes("🔔"), "脱敏 description 不得暴露「该标的有预警」这一关注信号");
  assert.ok(maskedDesc.includes("****"), maskedDesc);
  // Tooltip 走共享脱敏出口：既无铃铛也不得留真实标的信息
  assert.ok(!String(masked.tooltip ?? "").includes("贵州茅台"), "脱敏 Tooltip 必须走占位文本");
});

void test("P2-1 回归 - 状态栏脱敏判定收口到 maskState 共享谓词", async () => {
  const { StatusBar } = await import("../src/ui/statusBar.ts");
  const holdings: any[] = [
    { name: "贵州茅台", symbol: "sh600519", currency: "CNY", cost: 1600, shares: 100, price: 1800, changePercent: 1.25, change: 22.5 },
  ];

  // 1. 简洁展示模式（maskMode）单独激活即必须屏蔽持仓条与预警闪光
  const maskedBar = new StatusBar({ maskMode: true, colorNeutral: false, colorScheme: "greenUpRedDown" });
  try {
    maskedBar.setHoldings(holdings, true, 3);
    const maskedItem = (maskedBar as any).holdingBarItem;
    assert.strictEqual(maskedItem.text, "", "简洁展示模式下持仓轮播条必须为空");
    assert.strictEqual(maskedItem.tooltip, undefined, "简洁展示模式下不得保留持仓 Tooltip");
    assert.strictEqual(maskedBar.isHoldingCarouselRunning(), false, "简洁展示模式下不得启动持仓轮播定时器");
    maskedBar.flashAlert("贵州茅台 突破 1900", 10);
    assert.strictEqual((maskedBar as any).holdingBarItem.text, "", "脱敏态下预警闪光必须静默");
    maskedBar.setColorNeutral(true);
    maskedBar.setColorScheme("redUpGreenDown");
    assert.strictEqual((maskedBar as any).holdingBarItem.text, "", "脱敏态下配色切换不得重新渲染持仓金额");

    // 2. 同一份持仓在老板键态下必须得到完全一致的结果（共享谓词的两条入参等价）
    const bossBar = new StatusBar({ maskMode: false, colorNeutral: false, colorScheme: "greenUpRedDown" });
    try {
      bossBar.setHoldings(holdings, true, 3);
      assert.notStrictEqual((bossBar as any).holdingBarItem.text, "", "常态下持仓条应有内容（对照组）");
      bossBar.toggleBossKey();
      assert.strictEqual((bossBar as any).holdingBarItem.text, "", "老板键激活后持仓条必须清空");
    } finally {
      bossBar.dispose();
    }
  } finally {
    maskedBar.dispose();
  }

  // 3. 反「平行实现」闸门：状态栏内部不得再手写 bossKeyActive || maskMode 等价条件
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = fs.readFileSync(path.join(repoRoot, "src/ui/statusBar.ts"), "utf8");
  const handWritten = source.split("\n").filter(
    (line) => /this\.bossKeyActive\s*\|\|\s*this\.maskMode/.test(line) || (/this\.maskMode\s*\|\|\s*this\.bossKeyActive/.test(line) && !/isDisplayMasked/.test(line))
  );
  assert.deepStrictEqual(handWritten, [], `状态栏存在手写等价脱敏条件，必须改走 displayMasked（AGENTS.md §5.4）:\n${handWritten.join("\n")}`);
  assert.ok(/private get displayMasked\(\): boolean \{\s*return isDisplayMasked\(/.test(source), "displayMasked 必须直接返回共享谓词");
});

void test("P1-3 回归 - 备份校验把代理地址收敛到共享规范化出口", () => {
  // 1. 全局代理：异形输入不得原样写回公开契约键
  const socks = validateBackupData({ settings: { proxyUrl: "socks5://127.0.0.1:10808" } });
  assert.strictEqual(socks.valid, true);
  assert.strictEqual(socks.data?.settings.proxyUrl, "http://127.0.0.1:10808", "socks5:// 必须转成 Node 侧 http 代理形态");

  const https = validateBackupData({ proxyUrl: "https://proxy.corp.example:3128/" });
  assert.strictEqual(https.data?.settings.proxyUrl, "http://proxy.corp.example:3128", "https:// 与尾斜杠必须被纠偏");

  const barePort = validateBackupData({ proxyUrl: "7890" });
  assert.strictEqual(barePort.data?.settings.proxyUrl, "http://127.0.0.1:7890", "纯端口输入必须补齐 host");

  const blank = validateBackupData({ proxyUrl: "   " });
  assert.strictEqual(blank.data?.settings.proxyUrl, undefined, "空白代理不得写成空串以外的任何形态");

  // 2. 分组排序模式必须按白名单收敛：非法值不得盲转类型灌进 globalState
  const sortModes = validateBackupData({
    groupSortModes: { "A股": "changeDesc", "港股": "DROP TABLE", "美股": 42, "Binance": "priceDesc" },
  });
  assert.strictEqual(sortModes.valid, true);
  assert.deepStrictEqual(sortModes.data?.groupSortModes, { "A股": "changeDesc", "Binance": "priceDesc" });

  // 3. 颜色方案同样只接受已发布枚举
  assert.strictEqual(validateBackupData({ colorScheme: "rainbow" }).data?.settings.colorScheme, undefined);
});

void test("P2-5 回归 - 预警浮窗 reject 与分组排序回调 reject 一律收敛为日志", async () => {
  const vscode = await import("vscode");
  const originalInfo = vscode.window.showInformationMessage;
  const originalWarn = vscode.window.showWarningMessage;
  try {
    // 1. 宿主在关闭窗口时可能 reject 通知 Promise；预警已落库，这里只须静默接住
    (vscode.window as any).showInformationMessage = async () => {
      throw new Error("host window closed");
    };
    const manager = new AlertManager();
    const config: any = {
      alerts: { sh600519: { symbol: "sh600519", name: "贵州茅台", above: 1800, enabled: true } },
      alertNotificationMode: "notification",
      alertCooldownMinutes: 15,
    };
    const rejectLines = await withCapturedConsole(() =>
      assertNoUnhandledRejection(() => {
        const events = manager.checkQuotes(
          [{ id: "sh600519", symbol: "sh600519", name: "贵州茅台", price: 1850, changePercent: 2.5 }] as any,
          config
        );
        assert.strictEqual(events.length, 1, "对照组：预警必须已触发");
      })
    );
    assert.ok(
      rejectLines.join("\n").includes("预警浮窗交互未完成"),
      `reject 必须被接住并留痕，而不是静默吞掉: ${rejectLines.join("\n")}`
    );

    // 2. 「静音」动作同样不得把 reject 冒成未处理 Promise
    (vscode.window as any).showInformationMessage = async () => "静音 15 分钟";
    const mutedManager = new AlertManager();
    await assertNoUnhandledRejection(async () => {
      const events = mutedManager.checkQuotes(
        [{ id: "sh600519", symbol: "sh600519", name: "贵州茅台", price: 1850, changePercent: 2.5 }] as any,
        config
      );
      assert.strictEqual(events.length, 1);
    });
    assert.strictEqual(mutedManager.isMuted("sh600519"), true, "点击静音后该标的必须进入冷却");
  } finally {
    (vscode.window as any).showInformationMessage = originalInfo;
    (vscode.window as any).showWarningMessage = originalWarn;
  }

  // 3. 分组排序落盘回调 reject：树视图入口不能因为一次写盘失败冒出未处理拒绝
  const { WatchlistProvider } = await import("../src/ui/watchlistProvider.ts");
  const provider = new WatchlistProvider(false, false, "greenUpRedDown");
  provider.onGroupSortModeChangeCallback = async () => {
    throw new Error("globalState 写入失败");
  };
  const providerLogLines = await withCapturedConsole(() =>
    assertNoUnhandledRejection(() => {
      provider.setGroupSortMode("A股", "changeDesc");
    })
  );
  assert.ok(
    providerLogLines.join("\n").includes("分组排序落盘回调失败"),
    `写盘失败必须被接住并留痕: ${providerLogLines.join("\n")}`
  );
  assert.strictEqual((provider as any).groupSortModes.get("A股"), "changeDesc", "回调失败不影响内存排序态");
});

void test("P1-2 回归 - 拖拽报文解析失败只落错误名，不回显整幅自选清单", async () => {
  const { WatchlistProvider } = await import("../src/ui/watchlistProvider.ts");
  const provider = new WatchlistProvider(false, false, "greenUpRedDown");
  const leaked = '[{"groupName":"A股","confSymbol":"sh600519","name":"贵州茅台"},';

  const lines = await withCapturedConsole(async () => {
    await provider.handleDrop(
      undefined as any,
      {
        get: (_mimeType: string) => ({ value: leaked, asString: async () => leaked }),
      } as any,
      { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) } as any
    );
  });
  const joined = lines.join("\n");
  assert.ok(joined.includes("拖拽数据 JSON 解析失败"), `解析失败必须留痕: ${joined}`);
  assert.ok(joined.includes("SyntaxError"), `只留错误名: ${joined}`);
  assert.ok(!joined.includes("sh600519"), `日志不得回显被拖拽的标的代码: ${joined}`);
  assert.ok(!joined.includes("贵州茅台"), `日志不得回显被拖拽的标的名: ${joined}`);
});

void test("P2-3 回归 - 简洁展示模式下预警阈值遮值且禁用，且不得连带删除规则", async () => {
  const { getSettingsWebviewHtml } = await import("../src/ui/settingsHtml.ts");
  const html = getSettingsWebviewHtml("nonce-mask", "1.3.2", "vscode-resource://", {
    watchlist: { "A股": [{ symbol: "sh600519", name: "贵州茅台", type: "A_SHARE" }] },
    alerts: { sh600519: { symbol: "sh600519", name: "贵州茅台", above: 1900, below: 1700, changePercent: 5, enabled: true } },
    maskMode: true,
  } as any);

  // 1. 三个阈值输入框必须与成本/数量同构：脱敏态遮值 + disabled
  for (const cls of ["alert-above", "alert-below", "alert-pct"]) {
    const line = html.split("\n").find((l) => l.includes(`class="alert-input ${cls}"`));
    assert.ok(line, `预警表必须渲染 ${cls} 输入框`);
    assert.ok(line!.includes("'***'"), `${cls} 在脱敏态必须遮值`);
    assert.ok(line!.includes("isMasked ? 'disabled'"), `${cls} 在脱敏态必须禁用`);
  }

  // 2. 客户端读取出口：disabled/'***' 是「看不见」而不是「用户清空」，必须回读后端镜像
  const fnStart = html.indexOf("function readThresholdCell(");
  assert.ok(fnStart >= 0, "设置面板脚本必须包含 readThresholdCell 出口");
  let depth = 0;
  let fnEnd = -1;
  for (let i = html.indexOf("{", fnStart); i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) {
        fnEnd = i;
        break;
      }
    }
  }
  assert.ok(fnEnd > fnStart, "readThresholdCell 函数体必须可解析");
  const readThresholdCell = new Function(
    `${html.slice(fnStart, fnEnd + 1)}; return readThresholdCell;`
  )() as (input: { value: string; disabled: boolean } | null, mirrored: unknown) => number | undefined;

  assert.strictEqual(readThresholdCell({ value: "1900", disabled: false }, undefined), 1900, "常态输入框照常解析");
  assert.strictEqual(readThresholdCell({ value: "***", disabled: true }, 1900), 1900, "遮值禁用态必须回读镜像现值，否则开关一切换整条规则就被删");
  assert.strictEqual(readThresholdCell(null, 280), 280, "输入框缺失同样回读镜像");
  assert.strictEqual(readThresholdCell({ value: "***", disabled: true }, undefined), undefined, "镜像无值时保持未设置");
  assert.strictEqual(readThresholdCell({ value: "   ", disabled: false }, 1900), undefined, "用户主动清空仍须表达为删除该阈值");
});

void test("GroupItem - 代理挂起与离线状态呈现契约（方案 1）", async () => {
  const { GroupItem } = await import("../src/ui/watchlistProvider.ts");
  const vscode = await import("vscode");

  // 1. 正常状态 GroupItem
  const normalGroup = new GroupItem("Binance", [], "default", false, false, "", false, false);
  assert.strictEqual(normalGroup.description, "(0)");
  assert.strictEqual((normalGroup.iconPath as any)?.id, "folder");
  assert.strictEqual(normalGroup.tooltip, undefined);

  // 2. 挂起状态 GroupItem (带代理端口提示)
  const suspendedGroup = new GroupItem(
    "Binance",
    [],
    "default",
    false,
    false,
    "",
    false,
    true,
    "http://127.0.0.1:7890"
  );
  assert.ok(typeof suspendedGroup.description === "string" && suspendedGroup.description.includes("代理离线已暂停"), "挂起态描述必须包含代理离线已暂停");
  assert.strictEqual((suspendedGroup.iconPath as any)?.id, "debug-disconnect");
  assert.ok(suspendedGroup.tooltip instanceof (vscode as any).MarkdownString);
  const mdValue = String((suspendedGroup.tooltip as any).value || "");
  assert.ok(mdValue.includes("http://127.0.0.1:7890"), "Tooltip 中必须包含当前代理配置");
  assert.ok(mdValue.includes("🔄 (刷新)"), "Tooltip 中必须包含刷新重试指引");

  // 3. 动态切换挂起状态 setProxySuspended
  normalGroup.setProxySuspended(true, "http://127.0.0.1:10809");
  assert.ok(typeof normalGroup.description === "string" && normalGroup.description.includes("代理离线已暂停"));
  assert.strictEqual((normalGroup.iconPath as any)?.id, "debug-disconnect");

  normalGroup.setProxySuspended(false);
  assert.strictEqual(normalGroup.description, "(0)");
  assert.strictEqual((normalGroup.iconPath as any)?.id, "folder");
  assert.strictEqual(normalGroup.tooltip, undefined);
});

void test("RefreshScheduler - 代理板块连续失败自动挂起、轮询跳过与手动刷新恢复测试（方案 1）", async () => {
  const { RefreshScheduler } = await import("../src/scheduler.ts");
  const { GroupItem } = await import("../src/ui/watchlistProvider.ts");
  const vscode = await import("vscode");

  const mockMarketManager: any = {
    clearInvalidCache: () => {},
    pollAll: async () => [],
  };

  let lastRebuildSuspended: Set<string> | undefined;
  const mockTreeProvider: any = {
    setAlerts: () => {},
    buildTree: (_wl: any, _cache: any, _sections: any, _autoCollapse: any, suspended: Set<string>) => {
      lastRebuildSuspended = suspended;
    },
    applyQuotes: () => {},
    isEmpty: () => false,
  };
  const mockStatusBar: any = {
    setQuotes: () => {},
    show: () => {},
    hide: () => {},
    isBossKeyActive: () => false,
  };
  const mockTreeView: any = { visible: true };

  const scheduler = new RefreshScheduler({
    marketManager: mockMarketManager,
    treeProvider: mockTreeProvider,
    statusBar: mockStatusBar,
    treeView: mockTreeView,
  });

  const cfg = vscode.workspace.getConfiguration("marketlens");
  const origWatchlist = cfg.get("watchlist");
  const origBinance = cfg.get("binance");

  try {
    await cfg.update("watchlist", {
      "A股": [{ symbol: "sh600519", name: "贵州茅台", type: "A_SHARE" }],
      "Binance": [{ symbol: "BTCUSDT", name: "BTC", type: "CRYPTO" }],
    }, vscode.ConfigurationTarget.Global);
    await cfg.update("binance", { enabled: true, networkMode: "proxy", proxyUrl: "http://127.0.0.1:10808" }, vscode.ConfigurationTarget.Global);

    assert.strictEqual(scheduler.isProxySuspended("binance"), false);

    // 1. 第一轮拉取失败（crypto 为 0）
    await scheduler.refresh(false);
    assert.strictEqual(scheduler.isProxySuspended("binance"), false, "第 1 次失败不应立刻挂起");

    // 2. 第二轮拉取连续失败，达到阈值触发代理挂起
    await scheduler.refresh(false);
    assert.strictEqual(scheduler.isProxySuspended("binance"), true, "连续 2 次失败后必须进入挂起状态");
    assert.ok(lastRebuildSuspended?.has("binance"), "rebuildTree 必须接收到挂起板块");

    const { readConfig } = await import("../src/utils/config.ts");
    // 3. 进入挂起状态后，下一次常规轮询（非强制）中 extractTargets 必须跳过 Binance
    const nextTargets = scheduler.extractTargets(readConfig(), undefined, false);
    assert.deepStrictEqual(nextTargets.cryptos, [], "挂起后常规轮询必须跳过 cryptos 提取");
    assert.ok(nextTargets.aShares.length > 0, "A 股正常轮询绝不受影响");

    // 4. 用户点击分组右侧 🔄 按钮重试（refreshGroup）：
    // 模拟代理仍未开启场景 -> 保持挂起
    const binanceGroupItem = new GroupItem("Binance", [], "default", false, false, "", false, true);
    await scheduler.refreshGroup(binanceGroupItem);
    assert.strictEqual(scheduler.isProxySuspended("binance"), true, "重试若仍失败必须继续保持挂起");

    // 5. 模拟用户启动代理客户端后点击 🔄 按钮重试 -> 成功拉取到行情 -> 恢复正常！
    mockMarketManager.pollAll = async () => [
      { id: "BTCUSDT", symbol: "BTCUSDT", name: "BTC", type: "CRYPTO", price: 68000, changePercent: 2.1 }
    ];
    await scheduler.refreshGroup(binanceGroupItem);
    assert.strictEqual(scheduler.isProxySuspended("binance"), false, "成功拉取后必须解除挂起状态");

    // 恢复正常后常规轮询正常提取
    const resumedTargets = scheduler.extractTargets(readConfig(), undefined, false);
    assert.deepStrictEqual(resumedTargets.cryptos, ["BTCUSDT"], "解除挂起后正常恢复 cryptos 轮询");

    // 6. 老板键激活状态下 refreshGroup 失败必须完全静默（AGENTS.md §5.4 守卫）
    mockMarketManager.pollAll = async () => [];
    let warningShowed = false;
    const origShowWarning = (vscode.window as any).showWarningMessage;
    (vscode.window as any).showWarningMessage = () => {
      warningShowed = true;
    };
    mockStatusBar.isBossKeyActive = () => true;
    try {
      await scheduler.refreshGroup(binanceGroupItem);
      assert.strictEqual(warningShowed, false, "老板键激活期间 refreshGroup 失败绝对禁止弹窗");
    } finally {
      (vscode.window as any).showWarningMessage = origShowWarning;
      mockStatusBar.isBossKeyActive = () => false;
    }
  } finally {
    scheduler.dispose();
    await cfg.update("watchlist", origWatchlist, vscode.ConfigurationTarget.Global);
    await cfg.update("binance", origBinance, vscode.ConfigurationTarget.Global);
  }
});












