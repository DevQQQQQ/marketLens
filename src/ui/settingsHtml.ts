// src/ui/settingsHtml.ts
import { MARKET_SECTIONS } from "../utils/config.ts";
import { NORMALIZE_SYMBOL_KEY_CLIENT_SCRIPT } from "../utils/symbolHelper.ts";
import { DEFAULT_PROXY_PORT } from "../services/network.ts";

export interface SettingsFormData {
	autoRefresh?: boolean;
	refreshInterval?: number;
	maskMode?: boolean;
	colorNeutral?: boolean;
	colorScheme?: 'greenUpRedDown' | 'redUpGreenDown';
	statusBarEnabled?: boolean;
	autoCollapseClosedGroups?: boolean;
	proxyPort?: number;
	proxyUrl?: string;
	fundEnabled?: boolean;
	fundStatusBar?: boolean;
	fundStopOnMarketClosed?: boolean;
	fundNetworkMode?: string;
	aShareEnabled?: boolean;
	aShareStatusBar?: boolean;
	aShareStopOnMarketClosed?: boolean;
	aShareNetworkMode?: string;
	hkStockEnabled?: boolean;
	hkStockStatusBar?: boolean;
	hkStockStopOnMarketClosed?: boolean;
	hkStockNetworkMode?: string;
	usStockEnabled?: boolean;
	usStockStatusBar?: boolean;
	usStockStopOnMarketClosed?: boolean;
	usStockNetworkMode?: string;
	binanceEnabled?: boolean;
	binanceStatusBar?: boolean;
	binanceNetworkMode?: string;
	alphaEnabled?: boolean;
	alphaStatusBar?: boolean;
	alphaNetworkMode?: string;
	alerts?: Record<string, any>;
	alertNotificationMode?: string;
	alertCooldownMinutes?: number;
	watchlist?: Record<string, any[]>;
}

export function getSettingsWebviewHtml(
	nonce: string,
	version: string,
	cspSource: string = '',
	initialData: SettingsFormData = {}
): string {
	const defaultPort = initialData.proxyPort || DEFAULT_PROXY_PORT;
	const defaultProxyUrl = initialData.proxyUrl || `http://127.0.0.1:${defaultPort}`;
	const d: Required<SettingsFormData> = {
		autoRefresh: initialData.autoRefresh !== undefined ? initialData.autoRefresh : true,
		refreshInterval: initialData.refreshInterval || 5000,
		maskMode: !!initialData.maskMode,
		colorNeutral: !!initialData.colorNeutral,
		colorScheme: initialData.colorScheme || 'greenUpRedDown',
		statusBarEnabled:
			initialData.statusBarEnabled !== undefined ? initialData.statusBarEnabled : true,
		autoCollapseClosedGroups:
			initialData.autoCollapseClosedGroups !== undefined ? !!initialData.autoCollapseClosedGroups : true,
		proxyPort: defaultPort,
		proxyUrl: defaultProxyUrl,
		fundEnabled: initialData.fundEnabled !== undefined ? initialData.fundEnabled : true,
		fundStatusBar:
			initialData.fundStatusBar !== undefined ? initialData.fundStatusBar : true,
		fundStopOnMarketClosed:
			initialData.fundStopOnMarketClosed !== undefined
				? initialData.fundStopOnMarketClosed
				: true,
		fundNetworkMode: initialData.fundNetworkMode || 'direct',
		aShareEnabled: initialData.aShareEnabled !== undefined ? initialData.aShareEnabled : true,
		aShareStatusBar:
			initialData.aShareStatusBar !== undefined ? initialData.aShareStatusBar : true,
		aShareStopOnMarketClosed:
			initialData.aShareStopOnMarketClosed !== undefined
				? initialData.aShareStopOnMarketClosed
				: true,
		aShareNetworkMode: initialData.aShareNetworkMode || 'direct',
		hkStockEnabled:
			initialData.hkStockEnabled !== undefined ? initialData.hkStockEnabled : true,
		hkStockStatusBar:
			initialData.hkStockStatusBar !== undefined ? initialData.hkStockStatusBar : true,
		hkStockStopOnMarketClosed:
			initialData.hkStockStopOnMarketClosed !== undefined
				? initialData.hkStockStopOnMarketClosed
				: true,
		hkStockNetworkMode: initialData.hkStockNetworkMode || 'direct',
		usStockEnabled:
			initialData.usStockEnabled !== undefined ? initialData.usStockEnabled : true,
		usStockStatusBar:
			initialData.usStockStatusBar !== undefined ? initialData.usStockStatusBar : true,
		usStockStopOnMarketClosed:
			initialData.usStockStopOnMarketClosed !== undefined
				? initialData.usStockStopOnMarketClosed
				: true,
		usStockNetworkMode: initialData.usStockNetworkMode || 'direct',
		binanceEnabled:
			initialData.binanceEnabled !== undefined ? initialData.binanceEnabled : true,
		binanceStatusBar:
			initialData.binanceStatusBar !== undefined ? initialData.binanceStatusBar : true,
		binanceNetworkMode: initialData.binanceNetworkMode || 'proxy',
		alphaEnabled: initialData.alphaEnabled !== undefined ? initialData.alphaEnabled : true,
		alphaStatusBar:
			initialData.alphaStatusBar !== undefined ? initialData.alphaStatusBar : true,
		alphaNetworkMode: initialData.alphaNetworkMode || 'proxy',
		alerts: initialData.alerts || {},
		alertNotificationMode: initialData.alertNotificationMode || 'notification',
		alertCooldownMinutes: initialData.alertCooldownMinutes || 15,
		watchlist: initialData.watchlist || {},
	};

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data: blob:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource};">
  <title>MarketLens 设置</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --card-bg: var(--vscode-sideBar-background, rgba(255,255,255,0.04));
      --card-border: var(--vscode-widget-border, rgba(255,255,255,0.08));
      --primary: var(--vscode-button-background, #007acc);
      --primary-fg: var(--vscode-button-foreground, #ffffff);
      --hover-bg: var(--vscode-list-hoverBackground, rgba(255,255,255,0.08));
      --active-bg: var(--vscode-list-activeSelectionBackground, #094771);
      --input-bg: var(--vscode-input-background, #252526);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --input-border: var(--vscode-input-border, #3c3c3c);
      --desc-fg: var(--vscode-descriptionForeground, #858585);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      font-size: 13px;
    }
    .layout {
      display: flex;
      height: 100vh;
      overflow: hidden;
    }

    /* ── 左侧侧边导航 ── */
    .sidebar {
      width: 220px;
      border-right: 1px solid var(--card-border);
      padding: 20px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: var(--vscode-sideBar-background);
      user-select: none;
      flex-shrink: 0;
    }
    .brand {
      padding: 4px 10px 16px 10px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 10px;
    }
    .brand h2 { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .brand p { font-size: 11px; color: var(--desc-fg); margin-top: 4px; }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      border-radius: 6px;
      cursor: pointer;
      color: var(--fg);
      transition: background 0.12s ease, color 0.12s ease;
      user-select: none;
    }
    .nav-item:hover { background: var(--hover-bg); }
    .nav-item .icon { font-size: 15px; }

    /* ── 隐藏 radio 输入，用 :checked 驱动 Tab 切换 ── */
    .tab-radio { position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; }

    /* 激活的 nav-item 样式 */
    #tab-r-general:checked ~ .layout .sidebar label[for="tab-r-general"],
    #tab-r-alerts:checked  ~ .layout .sidebar label[for="tab-r-alerts"],
    #tab-r-fund:checked    ~ .layout .sidebar label[for="tab-r-fund"],
    #tab-r-ashare:checked  ~ .layout .sidebar label[for="tab-r-ashare"],
    #tab-r-hkstock:checked ~ .layout .sidebar label[for="tab-r-hkstock"],
    #tab-r-usstock:checked ~ .layout .sidebar label[for="tab-r-usstock"],
    #tab-r-binance:checked ~ .layout .sidebar label[for="tab-r-binance"],
    #tab-r-alpha:checked   ~ .layout .sidebar label[for="tab-r-alpha"],
    #tab-r-about:checked   ~ .layout .sidebar label[for="tab-r-about"] {
      background: var(--active-bg);
      color: #fff;
      font-weight: 500;
    }

    /* ── 右侧主内容区 ── */
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 32px 48px;
    }
    .tab-pane { display: none; }

    /* 激活的 tab-pane */
    #tab-r-general:checked ~ .layout .content #tab-general,
    #tab-r-alerts:checked  ~ .layout .content #tab-alerts,
    #tab-r-fund:checked    ~ .layout .content #tab-fund,
    #tab-r-ashare:checked  ~ .layout .content #tab-ashare,
    #tab-r-hkstock:checked ~ .layout .content #tab-hkstock,
    #tab-r-usstock:checked ~ .layout .content #tab-usstock,
    #tab-r-binance:checked ~ .layout .content #tab-binance,
    #tab-r-alpha:checked   ~ .layout .content #tab-alpha,
    #tab-r-about:checked   ~ .layout .content #tab-about {
      display: block;
      animation: fadeIn 0.15s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .section-header { margin-bottom: 24px; }
    .section-header h1 { font-size: 20px; font-weight: 600; margin-bottom: 6px; }
    .section-header p { color: var(--desc-fg); font-size: 13px; }

    .card-list { display: flex; flex-direction: column; gap: 14px; max-width: 800px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 18px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
    }
    .card.hidden-card { display: none !important; }
    .card-info { flex: 1; }
    .card-title { font-size: 14px; font-weight: 500; margin-bottom: 4px; }
    .card-desc { font-size: 12px; color: var(--desc-fg); line-height: 1.5; }

    /* Toggle Switch */
    .switch { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
      background-color: var(--input-border); transition: .25s; border-radius: 24px;
    }
    .slider:before {
      position: absolute; content: "";
      height: 18px; width: 18px; left: 3px; bottom: 3px;
      background-color: white; transition: .25s; border-radius: 50%;
    }
    input:checked + .slider { background-color: var(--primary); }
    input:checked + .slider:before { transform: translateX(20px); }

    input[type="text"], input[type="number"] {
      background: var(--input-bg); color: var(--input-fg);
      border: 1px solid var(--input-border);
      padding: 7px 12px; border-radius: 4px; outline: none; font-size: 13px;
    }
    input[type="text"]:focus, input[type="number"]:focus { border-color: var(--primary); }

    .radio-group { display: flex; gap: 14px; align-items: center; }
    .radio-label { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }

    .btn-detect {
      background: var(--hover-bg); color: var(--fg);
      border: 1px solid var(--card-border);
      padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;
      display: inline-flex; align-items: center; gap: 6px; transition: background 0.15s;
    }
    .btn-detect:hover { background: var(--card-border); }
    .proxy-input-box { display: flex; align-items: center; gap: 10px; }

    .security-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #73c991; margin-top: 6px; }
    .direct-tag   { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #3794ff; margin-top: 6px; }

    .shortcut-tag {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--hover-bg);
      border: 1px solid var(--card-border);
      color: var(--desc-fg);
      font-family: monospace;
      font-weight: normal;
    }
    .btn-shortcut {
      background: var(--hover-bg);
      color: var(--fg);
      border: 1px solid var(--card-border);
      padding: 5px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s;
    }
    .btn-shortcut:hover {
      background: var(--primary);
      color: var(--primary-fg);
      border-color: var(--primary);
    }
    .btn-restore {
      background: rgba(244, 135, 113, 0.12);
      color: var(--vscode-errorForeground, #f48771);
      border: 1px solid rgba(244, 135, 113, 0.35);
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .btn-restore:hover {
      background: rgba(244, 135, 113, 0.25);
      border-color: rgba(244, 135, 113, 0.6);
      color: #fff;
    }
    .btn-clear {
      background: rgba(239, 68, 68, 0.12);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.35);
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .btn-clear:hover {
      background: rgba(239, 68, 68, 0.25);
      border-color: rgba(239, 68, 68, 0.6);
      color: #fff;
    }
    .btn-action {
      background: var(--hover-bg);
      color: var(--fg);
      border: 1px solid var(--card-border);
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .btn-action:hover {
      background: var(--primary);
      color: var(--primary-fg);
      border-color: var(--primary);
    }
    .btn-telegram {
      background: #0088cc;
      color: #ffffff;
      border: 1px solid #0088cc;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .btn-telegram:hover {
      background: #0077b5;
      border-color: #0077b5;
      color: #ffffff;
    }
    .btn-github {
      background: #238636;
      color: #ffffff;
      border: 1px solid #2ea043;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .btn-github:hover {
      background: #2ea043;
      border-color: #3fb950;
      color: #ffffff;
    }

    .alert-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .alert-table th { padding: 9px 10px; text-align: left; border-bottom: 1px solid var(--card-border); color: var(--desc-fg); font-weight: 500; }
    .alert-table td { padding: 9px 10px; border-bottom: 1px solid var(--card-border); vertical-align: middle; }
    .alert-table tr:hover td { background: var(--hover-bg); }
    .alert-input { width: 85px; padding: 4px 8px; font-size: 12px; text-align: right; }
    .alert-grp-row td { background: rgba(255,255,255,0.03); font-weight: 600; color: var(--primary); font-size: 12px; border-bottom: 1px solid var(--card-border); }

    .toast {
      position: fixed; bottom: 24px; right: 24px;
      background: #333; color: #fff; padding: 10px 16px;
      border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      font-size: 12px; opacity: 0; pointer-events: none; transition: opacity 0.2s; z-index: 999;
    }
    .toast.show { opacity: 1; }
  </style>
</head>
<body>
  <!-- Radio inputs for pure-CSS tab switching (MUST be direct siblings of .layout) -->
  <input class="tab-radio" type="radio" name="tab" id="tab-r-general" checked>
  <input class="tab-radio" type="radio" name="tab" id="tab-r-alerts">
  <input class="tab-radio" type="radio" name="tab" id="tab-r-fund">
  <input class="tab-radio" type="radio" name="tab" id="tab-r-ashare">
  <input class="tab-radio" type="radio" name="tab" id="tab-r-hkstock">
  <input class="tab-radio" type="radio" name="tab" id="tab-r-usstock">
  <input class="tab-radio" type="radio" name="tab" id="tab-r-binance">
  <input class="tab-radio" type="radio" name="tab" id="tab-r-alpha">
  <input class="tab-radio" type="radio" name="tab" id="tab-r-about">

  <div class="layout">
  <!-- 侧边导航 -->
  <div class="sidebar">
    <div class="brand">
      <h2>📊 MarketLens</h2>
      <p>极客行情与摸鱼配置中心</p>
    </div>
    <label class="nav-item" for="tab-r-general"><span class="icon">⚙️</span><span>通用设置</span></label>
    <label class="nav-item" for="tab-r-alerts"><span class="icon">⚡</span><span>到价预警</span></label>
    <label class="nav-item" for="tab-r-fund"><span class="icon">📈</span><span>基金板块</span></label>
    <label class="nav-item" for="tab-r-ashare"><span class="icon">🇨🇳</span><span>A股板块</span></label>
    <label class="nav-item" for="tab-r-hkstock"><span class="icon">🇭🇰</span><span>港股板块</span></label>
    <label class="nav-item" for="tab-r-usstock"><span class="icon">🇺🇸</span><span>美股板块</span></label>
    <label class="nav-item" for="tab-r-binance"><span class="icon">🟡</span><span>Binance板块</span></label>
    <label class="nav-item" for="tab-r-alpha"><span class="icon">🦄</span><span>Alpha板块</span></label>
    <label class="nav-item" for="tab-r-about"><span class="icon">ℹ️</span><span>关于与帮助</span></label>
  </div>

  <!-- 内容区 -->
  <div class="content">

    <!-- 1. 通用设置 -->
    <div id="tab-general" class="tab-pane">
      <div class="section-header">
        <h1>通用与全局设置</h1>
        <p>控制全局刷新调度、摸鱼模式与视觉脱敏</p>
      </div>
      <div class="card-list">
        <div class="card">
          <div class="card-info">
            <div class="card-title">恢复出厂默认设置</div>
            <div class="card-desc">将所有自选标的列表（基金、A股、港股、美股、Binance、Alpha）恢复为首次安装时的初始预设，清空所有到价预警规则，并还原所有配置项。</div>
          </div>
          <button class="btn-restore" id="btnRestoreDefaults">🔄 恢复默认设置</button>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">一键清空自选标的</div>
            <div class="card-desc">一键清空当前所有板块（基金、A股、港股、美股、Binance、Alpha）的自选标的，保留板块分类，方便您从零开始自定义添加喜欢的资产。</div>
          </div>
          <button class="btn-clear" id="btnClearWatchlist">🗑️ 一键清空标的</button>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">📤 导出配置备份 (JSON)</div>
            <div class="card-desc">将当前全部自选标的列表、到价预警规则、分组排序模式及全局个性化设置导出为 JSON 文件，便于备份与跨设备迁移。</div>
          </div>
          <button class="btn-action" id="btnExportSettings">📤 导出配置备份</button>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">📥 导入配置恢复 (JSON)</div>
            <div class="card-desc">从此前导出的 JSON 备份文件中一键恢复自选标的、价格预警与偏好设置，实现换机或重装后的秒级还原。</div>
          </div>
          <button class="btn-action" id="btnImportSettings">📥 导入配置恢复</button>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">全部标的参与底部轮播</div>
            <div class="card-desc">控制 VS Code 底部状态栏是否展示行情轮播。关闭后底部状态栏将完全隐藏自选行情。</div>
          </div>
          <label class="switch"><input type="checkbox" id="statusBarEnabled" ${d.statusBarEnabled ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">🌙 休市自动折叠与停止轮播</div>
            <div class="card-desc">当某板块处于收盘休市时（如 15:05 后的 A 股/基金、周末节假日），左侧自选分组将自动折叠收起，且底部状态栏自动剔除休市标的；当关注的全部标的均休市时，底部状态栏静默隐藏。</div>
          </div>
          <label class="switch"><input type="checkbox" id="autoCollapseClosedGroups" ${d.autoCollapseClosedGroups ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">定时自动刷新</div>
            <div class="card-desc">开启后后台周期轮询最新行情；关闭后彻底停止后台拉取，仅在点击刷新按钮时更新。</div>
          </div>
          <label class="switch"><input type="checkbox" id="autoRefresh" ${d.autoRefresh ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">全局刷新频率 (毫秒)</div>
            <div class="card-desc">自动刷新时间间隔（推荐 3000 ~ 10000 毫秒）。</div>
          </div>
          <input type="number" id="refreshInterval" min="1000" step="500" value="${d.refreshInterval}" style="width: 110px;">
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title" style="display: flex; align-items: center; gap: 8px;">
              <span>伪装摸鱼模式</span>
              <span class="shortcut-tag">Ctrl+Alt+K</span>
            </div>
            <div class="card-desc">开启后底部状态栏伪装为 Git 分支及构建日志（如 <code>git:(main) build: 65.2k</code>），左侧自选列表中的价格与涨跌幅同步替换为 <code>****</code> 遮罩，彻底隐蔽。</div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <button class="btn-shortcut" id="btnKeybindMask" title="在 VS Code 中修改此快捷键">⌨️ 自定义快捷键</button>
            <label class="switch"><input type="checkbox" id="maskMode" ${d.maskMode ? 'checked' : ''}><span class="slider"></span></label>
          </div>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title" style="display: flex; align-items: center; gap: 8px;">
              <span>颜色脱敏模式</span>
              <span class="shortcut-tag">Ctrl+Alt+L</span>
            </div>
            <div class="card-desc">开启后所有涨跌数值使用编辑器默认中性颜色，关闭红绿配色刺激，防止旁观者察觉。</div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <button class="btn-shortcut" id="btnKeybindColor" title="在 VS Code 中修改此快捷键">⌨️ 自定义快捷键</button>
            <label class="switch"><input type="checkbox" id="colorNeutral" ${d.colorNeutral ? 'checked' : ''}><span class="slider"></span></label>
          </div>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">涨跌配色方案</div>
            <div class="card-desc">选择符合您看盘习惯的涨跌视觉色彩。greenUpRedDown (绿涨红跌，国际/加密/美股习惯，默认) 或 redUpGreenDown (红涨绿跌，符合国内传统金融盘面习惯)。</div>
          </div>
          <select id="colorScheme" class="select-box" style="padding: 6px 12px; border-radius: 4px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--card-border); font-size: 13px;">
            <option value="greenUpRedDown" ${d.colorScheme === 'greenUpRedDown' ? 'selected' : ''}>🟢 绿涨红跌 (国际 / 加密货币 / 美股习惯，默认)</option>
            <option value="redUpGreenDown" ${d.colorScheme === 'redUpGreenDown' ? 'selected' : ''}>🔴 红涨绿跌 (国内 A股 传统金融盘面习惯)</option>
          </select>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">本地代理端口 (仅支持 HTTP / 混合代理)</div>
            <div class="card-desc">全插件统一网络代理端口。只需输入端口号（1 ~ 65535，默认 ${DEFAULT_PROXY_PORT}，v2rayN 为 10808/10809，Clash/Verge 为 7890/7897）。未自定义时自动自适应读取系统代理环境变量 (HTTP_PROXY / HTTPS_PROXY / ALL_PROXY) 或探测可用端口。</div>
          </div>
          <div class="proxy-input-box">
            <span style="font-family: monospace; color: var(--desc-fg); font-size: 13px;"></span>
            <input type="text" id="globalProxyPort" value="${d.proxyPort}" placeholder="${DEFAULT_PROXY_PORT}" maxlength="5" style="width: 80px; text-align: center; font-family: monospace; font-size: 13px; font-weight: 500;">
            <button class="btn-detect" id="btnDetectGlobal">⚡ 探测代理</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 2. 到价预警板块 -->
    <div id="tab-alerts" class="tab-pane">
      <div class="section-header">
        <h1>到价预警与剧烈波动监控</h1>
        <p>设定目标突破价、跌破价或单日涨跌幅阈值，触发时通过通知浮窗或状态栏闪烁精准预警</p>
      </div>
      <div class="card-list">
        <div class="card">
          <div class="card-info">
            <div class="card-title">预警提醒方式</div>
            <div class="card-desc">选择预警触发时的展现形式。浮窗通知在右下角轻量提示并支持快速静音；状态栏闪烁仅在底栏高亮切换，静默不打扰工作。</div>
          </div>
          <select id="alertNotificationMode" class="select-box" style="padding: 6px 12px; border-radius: 4px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); font-size: 13px;">
            <option value="notification" ${d.alertNotificationMode === 'notification' ? 'selected' : ''}>仅 VS Code 浮窗通知</option>
            <option value="statusBarOnly" ${d.alertNotificationMode === 'statusBarOnly' ? 'selected' : ''}>仅底部状态栏闪烁</option>
            <option value="both" ${d.alertNotificationMode === 'both' ? 'selected' : ''}>同时弹窗与状态栏闪烁</option>
          </select>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">预警静默冷却间隔 (分钟)</div>
            <div class="card-desc">同一标的触发预警后的冷静期（防止在关键点位来回震荡造成连续提示轰炸）。默认 15 分钟。</div>
          </div>
          <input type="number" id="alertCooldownMinutes" value="${d.alertCooldownMinutes}" min="1" max="1440" style="width: 80px; text-align: center; font-family: monospace; font-size: 13px; font-weight: 500; padding: 6px 8px; border-radius: 4px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border);">
        </div>

        <div class="card" style="flex-direction: column; align-items: stretch; gap: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="card-info">
              <div class="card-title">自选标的预警监控矩阵</div>
              <div class="card-desc">在下方表格中为每个标的配置触发条件。留空项不生效；修改后即时自动保存。</div>
            </div>
            <button class="btn-clear" id="btnClearAllAlerts" style="font-size: 12px; padding: 5px 12px;">🗑️ 清空所有预警</button>
          </div>
          <div style="overflow-x: auto;">
            <table class="alert-table">
              <thead>
                <tr>
                  <th style="width: 28%;">标的名称 / 代码</th>
                  <th style="width: 22%;">高于目标价 (突破 &gt;)</th>
                  <th style="width: 22%;">低于目标价 (跌破 &lt;)</th>
                  <th style="width: 18%;">单日涨跌幅 |%| ≥</th>
                  <th style="width: 10%; text-align: center;">监控开关</th>
                </tr>
              </thead>
              <tbody id="alertTableBody">
                <tr><td colspan="5" style="text-align: center; color: var(--desc-fg); padding: 24px;">加载自选标的列表中...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- 基金板块 -->
    <div id="tab-fund" class="tab-pane">
      <div class="section-header">
        <h1>基金与ETF设置 (Funds / ETFs)</h1>
        <p>配置场内 ETF、指数基金与联接基金的抓取策略</p>
      </div>
      <div class="card-list">
        <div class="card">
          <div class="card-info">
            <div class="card-title">启用基金分组</div>
            <div class="card-desc">是否在左侧看板展示基金与场内 ETF 自选分组。</div>
          </div>
          <label class="switch"><input type="checkbox" id="fundEnabled" ${d.fundEnabled ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">基金标的参与底部轮播</div>
            <div class="card-desc">控制基金自选标的是否在 VS Code 底部状态栏循环轮播展示。</div>
          </div>
          <label class="switch"><input type="checkbox" id="fundStatusBar" ${d.fundStatusBar ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">基金闭市期间停止轮询</div>
            <div class="card-desc">开启后仅在基金与 A 股交易时段（北京时间 9:15–11:30, 13:00–15:05）请求数据，休市与周末停止拉取。</div>
          </div>
          <label class="switch"><input type="checkbox" id="fundStopOnMarketClosed" ${d.fundStopOnMarketClosed ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">网络访问模式</div>
            <div class="card-desc">
              腾讯财经接口属于境内正规服务，推荐选择<b>直连</b>（零延迟）。
              <div id="fundNetTag" class="${d.fundNetworkMode === 'proxy' ? 'security-tag' : 'direct-tag'}">${d.fundNetworkMode === 'proxy' ? '🛡️ 已启用代理（使用通用设置中的全局代理）' : '⚡ 当前为境内直连（推荐）'}</div>
            </div>
          </div>
          <div class="radio-group">
            <label class="radio-label"><input type="radio" name="fundNetwork" value="direct" id="fundNetDirect" ${d.fundNetworkMode !== 'proxy' ? 'checked' : ''}> 直连 (默认)</label>
            <label class="radio-label"><input type="radio" name="fundNetwork" value="proxy"  id="fundNetProxy" ${d.fundNetworkMode === 'proxy' ? 'checked' : ''}> 强制代理</label>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. A 股板块 -->
    <div id="tab-ashare" class="tab-pane">
      <div class="section-header">
        <h1>A股市场设置</h1>
        <p>配置沪深京全市场股票与指数的抓取策略</p>
      </div>
      <div class="card-list">
        <div class="card">
          <div class="card-info">
            <div class="card-title">启用 A 股分组</div>
            <div class="card-desc">是否在左侧看板展示 A 股相关自选分组。</div>
          </div>
          <label class="switch"><input type="checkbox" id="aShareEnabled" ${d.aShareEnabled ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">A股标的参与底部轮播</div>
            <div class="card-desc">控制 A 股自选标的是否在 VS Code 底部状态栏循环轮播展示。</div>
          </div>
          <label class="switch"><input type="checkbox" id="aShareStatusBar" ${d.aShareStatusBar ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">A股闭市期间停止轮询</div>
            <div class="card-desc">开启后仅在 A 股交易时段（北京时间 9:15–11:30, 13:00–15:05）请求数据，休市与周末停止拉取。</div>
          </div>
          <label class="switch"><input type="checkbox" id="aShareStopOnMarketClosed" ${d.aShareStopOnMarketClosed ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">网络访问模式</div>
            <div class="card-desc">
              腾讯财经接口属于境内正规服务，推荐选择<b>直连</b>（零延迟）。
              <div id="aShareNetTag" class="${d.aShareNetworkMode === 'proxy' ? 'security-tag' : 'direct-tag'}">${d.aShareNetworkMode === 'proxy' ? '🛡️ 已启用代理（使用通用设置中的全局代理）' : '⚡ 当前为境内直连（推荐）'}</div>
            </div>
          </div>
          <div class="radio-group">
            <label class="radio-label"><input type="radio" name="aShareNetwork" value="direct" id="aShareNetDirect" ${d.aShareNetworkMode !== 'proxy' ? 'checked' : ''}> 直连 (默认)</label>
            <label class="radio-label"><input type="radio" name="aShareNetwork" value="proxy"  id="aShareNetProxy" ${d.aShareNetworkMode === 'proxy' ? 'checked' : ''}> 强制代理</label>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. 港股板块 -->
    <div id="tab-hkstock" class="tab-pane">
      <div class="section-header">
        <h1>港股市场设置 (HK Stocks)</h1>
        <p>配置港股市场（腾讯控股、美团、阿里巴巴等）的抓取策略</p>
      </div>
      <div class="card-list">
        <div class="card">
          <div class="card-info">
            <div class="card-title">启用港股分组</div>
            <div class="card-desc">是否在左侧看板展示港股相关自选分组。</div>
          </div>
          <label class="switch"><input type="checkbox" id="hkStockEnabled" ${d.hkStockEnabled ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">港股标的参与底部轮播</div>
            <div class="card-desc">控制港股自选标的是否在 VS Code 底部状态栏循环轮播展示。</div>
          </div>
          <label class="switch"><input type="checkbox" id="hkStockStatusBar" ${d.hkStockStatusBar ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">港股闭市期间停止轮询</div>
            <div class="card-desc">开启后仅在港股交易时段（北京时间 9:30–12:00, 13:00–16:10）请求数据，休市与周末停止拉取。</div>
          </div>
          <label class="switch"><input type="checkbox" id="hkStockStopOnMarketClosed" ${d.hkStockStopOnMarketClosed ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">网络访问模式</div>
            <div class="card-desc">
              腾讯财经港股行情源境内畅通，推荐选择<b>直连</b>（零延迟）。
              <div id="hkStockNetTag" class="${d.hkStockNetworkMode === 'proxy' ? 'security-tag' : 'direct-tag'}">${d.hkStockNetworkMode === 'proxy' ? '🛡️ 已启用代理（使用通用设置中的全局代理）' : '⚡ 当前为境内直连（推荐）'}</div>
            </div>
          </div>
          <div class="radio-group">
            <label class="radio-label"><input type="radio" name="hkStockNetwork" value="direct" id="hkStockNetDirect" ${d.hkStockNetworkMode !== 'proxy' ? 'checked' : ''}> 直连 (默认)</label>
            <label class="radio-label"><input type="radio" name="hkStockNetwork" value="proxy"  id="hkStockNetProxy" ${d.hkStockNetworkMode === 'proxy' ? 'checked' : ''}> 强制代理</label>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. 美股板块 -->
    <div id="tab-usstock" class="tab-pane">
      <div class="section-header">
        <h1>美股市场设置 (US Stocks)</h1>
        <p>配置美股纳斯达克、标普与道琼斯标的（苹果、英伟达、特斯拉等）的抓取策略</p>
      </div>
      <div class="card-list">
        <div class="card">
          <div class="card-info">
            <div class="card-title">启用美股分组</div>
            <div class="card-desc">是否在左侧看板展示美股相关自选分组。</div>
          </div>
          <label class="switch"><input type="checkbox" id="usStockEnabled" ${d.usStockEnabled ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">美股标的参与底部轮播</div>
            <div class="card-desc">控制美股自选标的是否在 VS Code 底部状态栏循环轮播展示。</div>
          </div>
          <label class="switch"><input type="checkbox" id="usStockStatusBar" ${d.usStockStatusBar ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">美股闭市期间停止轮询</div>
            <div class="card-desc">开启后仅在美股交易时段（北京时间工作日 21:00 至次日凌晨 5:00）请求数据，非交易时段展示收盘价。</div>
          </div>
          <label class="switch"><input type="checkbox" id="usStockStopOnMarketClosed" ${d.usStockStopOnMarketClosed ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">网络访问模式</div>
            <div class="card-desc">
              腾讯财经美股行情源支持境内直连，亦支持强制走代理。
              <div id="usStockNetTag" class="${d.usStockNetworkMode === 'proxy' ? 'security-tag' : 'direct-tag'}">${d.usStockNetworkMode === 'proxy' ? '🛡️ 已启用代理（使用通用设置中的全局代理）' : '⚡ 当前为直连访问'}</div>
            </div>
          </div>
          <div class="radio-group">
            <label class="radio-label"><input type="radio" name="usStockNetwork" value="direct" id="usStockNetDirect" ${d.usStockNetworkMode !== 'proxy' ? 'checked' : ''}> 直连 (默认)</label>
            <label class="radio-label"><input type="radio" name="usStockNetwork" value="proxy"  id="usStockNetProxy" ${d.usStockNetworkMode === 'proxy' ? 'checked' : ''}> 强制代理</label>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. Binance 板块 -->
    <div id="tab-binance" class="tab-pane">
      <div class="section-header">
        <h1>Binance 加密货币设置</h1>
        <p>配置币安主流代币的抓取与网络安全代理</p>
      </div>
      <div class="card-list">
        <div class="card">
          <div class="card-info">
            <div class="card-title">启用 Binance 分组</div>
            <div class="card-desc">是否在侧边栏显示主流加密货币行情（BTC、ETH 等）。</div>
          </div>
          <label class="switch"><input type="checkbox" id="binanceEnabled" ${d.binanceEnabled ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">Binance标的参与底部轮播</div>
            <div class="card-desc">控制 Binance 主流代币是否在 VS Code 底部状态栏循环轮播展示。</div>
          </div>
          <label class="switch"><input type="checkbox" id="binanceStatusBar" ${d.binanceStatusBar ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">网络访问模式</div>
            <div class="card-desc">
              在公司网络下强烈建议保持<b>强制代理</b>，插件将绝对阻止直连包，杜绝网关产生访问记录。
              <div id="binanceNetTag" class="${d.binanceNetworkMode === 'direct' ? 'direct-tag' : 'security-tag'}">${d.binanceNetworkMode === 'direct' ? '⚡ 已切换为直连访问' : '🛡️ 已启用杜绝直连保护（使用通用设置中的全局代理）'}</div>
            </div>
          </div>
          <div class="radio-group">
            <label class="radio-label"><input type="radio" name="binanceNetwork" value="proxy"  id="binanceNetProxy" ${d.binanceNetworkMode !== 'direct' ? 'checked' : ''}> 强制代理 (默认)</label>
            <label class="radio-label"><input type="radio" name="binanceNetwork" value="direct" id="binanceNetDirect" ${d.binanceNetworkMode === 'direct' ? 'checked' : ''}> 直连</label>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. Alpha 板块 -->
    <div id="tab-alpha" class="tab-pane">
      <div class="section-header">
        <h1>Alpha 链上 DEX 设置</h1>
        <p>配置全链新币（BSC、Solana、Base、以太坊等）与网络代理</p>
      </div>
      <div class="card-list">
        <div class="card">
          <div class="card-info">
            <div class="card-title">启用 Alpha 分组</div>
            <div class="card-desc">是否在侧边栏展示链上 DEX 代币行情。</div>
          </div>
          <label class="switch"><input type="checkbox" id="alphaEnabled" ${d.alphaEnabled ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">Alpha标的参与底部轮播</div>
            <div class="card-desc">控制 Alpha 链上代币是否在 VS Code 底部状态栏循环轮播展示。</div>
          </div>
          <label class="switch"><input type="checkbox" id="alphaStatusBar" ${d.alphaStatusBar ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">网络访问模式</div>
            <div class="card-desc">
              访问 DexScreener 全球链上聚合接口。建议保持<b>强制代理</b>，防止公司网关检测。
              <div id="alphaNetTag" class="${d.alphaNetworkMode === 'direct' ? 'direct-tag' : 'security-tag'}">${d.alphaNetworkMode === 'direct' ? '⚡ 已切换为直连访问' : '🛡️ 已启用杜绝直连保护（使用通用设置中的全局代理）'}</div>
            </div>
          </div>
          <div class="radio-group">
            <label class="radio-label"><input type="radio" name="alphaNetwork" value="proxy"  id="alphaNetProxy" ${d.alphaNetworkMode !== 'direct' ? 'checked' : ''}> 强制代理 (默认)</label>
            <label class="radio-label"><input type="radio" name="alphaNetwork" value="direct" id="alphaNetDirect" ${d.alphaNetworkMode === 'direct' ? 'checked' : ''}> 直连</label>
          </div>
        </div>
      </div>
    </div>

    <!-- 5. 关于 -->
    <div id="tab-about" class="tab-pane">
      <div class="section-header">
        <h1>关于 MarketLens</h1>
        <p>极致摸鱼，从容盯盘</p>
      </div>
      <div class="card-list">
        <div class="card">
          <div class="card-info">
            <div class="card-title">快捷键提示</div>
            <div class="card-desc">
              • <b>老板键一键隐蔽/恢复</b>: <code>Ctrl + Alt + M</code> 或 <code>Alt + M</code> (Mac: <code>Cmd + Alt + M</code>)<br>
              • <b>伪装摸鱼模式开关</b>: <code>Ctrl + Alt + K</code> 或 <code>Alt + K</code> (Mac: <code>Cmd + Alt + K</code>)<br>
              • <b>颜色脱敏模式开关</b>: <code>Ctrl + Alt + L</code> 或 <code>Alt + L</code> (Mac: <code>Cmd + Alt + L</code>)<br>
              • <b>专注模式期间保持完全静默</b>: 不弹出任何状态栏提示、通知与设置面板；此期间按下 <code>Alt + K</code> 会先自动退出专注模式再关闭打码，点击活动栏图标重新打开看板同样会自动退出专注模式。<br>
              • <b>悬停详情卡片</b>: 鼠标放至任意资产上，即可查看今开、昨收、高低、涨跌与成交额。
            </div>
          </div>
          <button class="btn-shortcut" id="btnKeybindAll">⌨️ 打开全局快捷键设置</button>
        </div>
        <div class="card" style="flex-direction: column; align-items: flex-start; gap: 14px;">
          <div class="card-info" style="width: 100%;">
            <div class="card-title">问题反馈与社区交流</div>
            <div class="card-desc" style="margin-bottom: 14px;">本项目已全面开源！遇到 Bug、行情数据异常或有新功能建议？欢迎前往 GitHub 提交 Issue 反馈，或加入官方 Telegram 社群与作者直接交流。</div>
            <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
              <button class="btn-github" id="btnOpenIssues">🐙 GitHub 提交 Issue</button>
              <button class="btn-telegram" id="btnJoinTelegram">✈️ 进入 Telegram 交流群</button>
              <button class="btn-telegram" id="btnJoinPersonalTelegram" style="background: #2AABEE; border-color: #2AABEE;">💬 联系作者个人 TG</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-info">
            <div class="card-title">开源代码与版本信息</div>
            <div class="card-desc">MarketLens v${version.replace(/^v/i, '')} · 由 DevQQQQQ 倾力打造 · MIT 开源协议</div>
          </div>
          <button class="btn-shortcut" id="btnOpenRepo" style="font-size: 12px; padding: 6px 12px;">⭐ 访问 GitHub 仓库</button>
        </div>
      </div>
    </div>

  </div>
  </div>

  <div id="toast" class="toast"></div>

  <script nonce="${nonce}">
    (function() {
      // ── Toast 提示系统（优先初始化，供全局使用） ──
      function showToast(msg) {
        try {
          var t = document.getElementById('toast');
          if (!t) return;
          t.innerText = msg;
          t.classList.add('show');
          setTimeout(function() { t.classList.remove('show'); }, 2500);
        } catch (e) {
          console.log('[MarketLens Toast]', msg);
        }
      }
      window.showToast = showToast;

      // ── 全局错误捕获 ──
      window.onerror = function(msg, url, lineNo, columnNo, error) {
        console.error('MarketLens Webview Error:', msg, lineNo, error);
        showToast('⚠️ 界面异常: ' + msg);
      };

      // ── VS Code API 安全获取与缓存 ──
      var vscode = (function() {
        try {
          if (window.__vscodeApi) return window.__vscodeApi;
          if (typeof acquireVsCodeApi === 'function') {
            window.__vscodeApi = acquireVsCodeApi();
            return window.__vscodeApi;
          }
        } catch (err) {
          console.warn('acquireVsCodeApi notice:', err);
        }
        return window.__vscodeApi || null;
      })();

      // ── 通用指令下发 ──
      function postCmd(cmd, payload) {
        try {
          var api = vscode || window.__vscodeApi;
          if (!api && typeof acquireVsCodeApi === 'function') {
            try {
              window.__vscodeApi = acquireVsCodeApi();
              api = window.__vscodeApi;
              vscode = api;
            } catch (e) {}
          }
          if (api && typeof api.postMessage === 'function') {
            var msg = Object.assign({ command: cmd }, payload || {});
            api.postMessage(msg);
            return true;
          } else {
            console.warn('postCmd: VS Code API not available for', cmd);
          }
        } catch (err) {
          console.error('postCmd error:', err);
        }
        return false;
      }
      window.postCmd = postCmd;

      // ── 快捷通信与辅助 ──
      function sendUpdate(key, value) {
        postCmd('updateSetting', { key: key, value: value });
      }
      window.sendUpdate = sendUpdate;

      function copyText(text, toastMsg) {
        postCmd('copyToClipboard', { text: text });
        showToast(toastMsg || '📋 已复制到剪贴板');
      }
      window.copyText = copyText;

      function triggerDetect(target) {
        showToast('正在探测本机活跃代理端口...');
        postCmd('detectProxy', { target: target });
      }
      window.triggerDetect = triggerDetect;

      // ── Tab 切换逻辑（联动 CSS Radio） ──
      var TAB_RADIOS = {
        'tab-general': 'tab-r-general',
        'tab-alerts':  'tab-r-alerts',
        'tab-fund':    'tab-r-fund',
        'tab-ashare':  'tab-r-ashare',
        'tab-hkstock': 'tab-r-hkstock',
        'tab-usstock': 'tab-r-usstock',
        'tab-binance': 'tab-r-binance',
        'tab-alpha':   'tab-r-alpha',
        'tab-about':   'tab-r-about'
      };

      function switchTab(targetPaneId) {
        var radioId = TAB_RADIOS[targetPaneId];
        if (radioId) {
          var radio = document.getElementById(radioId);
          if (radio) {
            radio.checked = true;
          }
        }
      }
      window.switchTab = switchTab;

      // ── 到价预警监控数据管理 ──
      // 设计契约规范：Webview 设置面板内的 maskMode 属于视觉防肩窥遮罩（Anti-shoulder-surfing Visual Masking），
      // 核心威胁模型为防御近身肉眼偷窥；底层保留完整配置镜像以支持面板双向绑定交互与修改后的原子化回写落盘。
      var currentAlerts = ${JSON.stringify(d.alerts).replace(/</g, '\\u003c')};
      var currentWatchlist = ${JSON.stringify(d.watchlist).replace(/</g, '\\u003c')};
      var alertSaveTimer = null;

      function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      ${NORMALIZE_SYMBOL_KEY_CLIENT_SCRIPT}

      function renderAlertTable(watchlist, alerts) {
        var tbody = document.getElementById('alertTableBody');
        if (!tbody) return;
        watchlist = watchlist || {};
        alerts = alerts || {};

        var maskEl = document.getElementById('maskMode');
        var isMasked = maskEl ? maskEl.checked : ${Boolean(d.maskMode)};

        var html = '';
        var totalCount = 0;

        var groupKeys = Object.keys(watchlist);
        for (var i = 0; i < groupKeys.length; i++) {
          var grpName = groupKeys[i];
          var list = watchlist[grpName];
          if (Array.isArray(list) && list.length > 0) {
            html += '<tr class="alert-grp-row"><td colspan="5">分组: ' + escapeHtml(grpName) + ' (' + list.length + ' 个标的)' + (isMasked ? ' <span style="font-size: 11px; opacity: 0.7;">[已脱敏]</span>' : '') + '</td></tr>';
            for (var j = 0; j < list.length; j++) {
              var item = list[j];
              var sym = (typeof item === 'string') ? item : (item.symbol || item.code || '');
              var name = (typeof item === 'object' && item.name) ? item.name : sym;
              var key = getSymbolKey(sym);
              var rawTicker = sym.toLowerCase().replace(/^(us|hk|sh|sz|bj)[\\._\\-\\/]?/i, '');
              var rule = alerts[key] || alerts[sym] || (sym ? alerts[sym.toLowerCase()] : undefined) || (rawTicker ? alerts[rawTicker] : undefined) || {};

              var aboveVal = (rule.above !== undefined && rule.above !== null) ? rule.above : '';
              var belowVal = (rule.below !== undefined && rule.below !== null) ? rule.below : '';
              var pctVal = (rule.changePercent !== undefined && rule.changePercent !== null) ? rule.changePercent : '';
              var isEnabled = rule.enabled !== false;

              var keyEsc = escapeHtml(key);
              var symEsc = escapeHtml(sym);
              var nameEsc = escapeHtml(name);

              var displayName = isMasked ? '***' : nameEsc;
              var displaySym = isMasked ? (symEsc.length > 3 ? symEsc[0] + '***' + symEsc.slice(-1) : '***') : symEsc;

              html += '<tr data-key="' + keyEsc + '" data-symbol="' + symEsc + '" data-name="' + nameEsc + '">'
                + '<td>'
                + '<div style="font-weight: 500; font-size: 13px;">' + displayName + '</div>'
                + '<div style="font-size: 11px; color: var(--desc-fg); font-family: monospace;">' + displaySym + '</div>'
                + '</td>'
                + '<td><input type="number" step="any" class="alert-input alert-above" placeholder="未设置" value="' + escapeHtml(aboveVal) + '"></td>'
                + '<td><input type="number" step="any" class="alert-input alert-below" placeholder="未设置" value="' + escapeHtml(belowVal) + '"></td>'
                + '<td><input type="number" step="any" class="alert-input alert-pct" placeholder="未设置" value="' + escapeHtml(pctVal) + '"></td>'
                + '<td style="text-align: center;"><label class="switch"><input type="checkbox" class="alert-enabled" ' + (isEnabled ? 'checked' : '') + '><span class="slider"></span></label></td>'
                + '</tr>';
              totalCount++;
            }
          }
        }

        if (totalCount === 0) {
          html = '<tr><td colspan="5" style="text-align: center; color: var(--desc-fg); padding: 24px;">暂无自选标的。请在左侧侧边栏添加自选后，即可在此配置到价预警。</td></tr>';
        }

        // 保存当前正在编辑的输入框焦点，防止实时重渲染时失去焦点
        var activeEl = document.activeElement;
        var activeKey = null;
        var activeClass = null;
        var activeSelStart = null;
        var activeSelEnd = null;
        if (activeEl && tbody.contains(activeEl)) {
          var trParent = activeEl.closest('tr');
          if (trParent) {
            activeKey = trParent.getAttribute('data-key');
            if (activeEl.classList.contains('alert-above')) activeClass = 'alert-above';
            else if (activeEl.classList.contains('alert-below')) activeClass = 'alert-below';
            else if (activeEl.classList.contains('alert-pct')) activeClass = 'alert-pct';
            if (activeEl.selectionStart !== undefined) {
              activeSelStart = activeEl.selectionStart;
              activeSelEnd = activeEl.selectionEnd;
            }
          }
        }

        tbody.innerHTML = html;
        bindAlertTableEvents(tbody);

        // 恢复焦点
        if (activeKey && activeClass) {
          var safeKey = (window.CSS && CSS.escape) ? CSS.escape(activeKey) : activeKey.replace(/["\\\\]/g, '\\\\$&');
          var targetTr = tbody.querySelector('tr[data-key="' + safeKey + '"]');
          if (targetTr) {
            var targetInput = targetTr.querySelector('.' + activeClass);
            if (targetInput) {
              targetInput.focus();
              if (activeSelStart !== null && targetInput.setSelectionRange) {
                try {
                  targetInput.setSelectionRange(activeSelStart, activeSelEnd);
                } catch(e) {}
              }
            }
          }
        }
      }

      function updateAlertRuleFromRow(tr) {
        var key = tr.getAttribute('data-key');
        var sym = tr.getAttribute('data-symbol');
        var name = tr.getAttribute('data-name');
        var aboveInput = tr.querySelector('.alert-above');
        var belowInput = tr.querySelector('.alert-below');
        var pctInput = tr.querySelector('.alert-pct');
        var enabledInput = tr.querySelector('.alert-enabled');

        var above = aboveInput && aboveInput.value.trim() !== '' ? parseFloat(aboveInput.value) : undefined;
        var below = belowInput && belowInput.value.trim() !== '' ? parseFloat(belowInput.value) : undefined;
        var pct = pctInput && pctInput.value.trim() !== '' ? parseFloat(pctInput.value) : undefined;
        var enabled = enabledInput ? enabledInput.checked : true;

        if (above !== undefined && isNaN(above)) above = undefined;
        if (below !== undefined && isNaN(below)) below = undefined;
        if (pct !== undefined && isNaN(pct)) pct = undefined;

        if (above === undefined && below === undefined && pct === undefined) {
          delete currentAlerts[key];
        } else {
          currentAlerts[key] = {
            symbol: sym,
            name: name,
            above: above,
            below: below,
            changePercent: pct,
            enabled: enabled
          };
        }
      }

      function bindAlertTableEvents(tbody) {
        var rows = tbody.querySelectorAll('tr[data-key]');
        for (var i = 0; i < rows.length; i++) {
          (function(tr) {
            var inputs = tr.querySelectorAll('.alert-input');
            for (var k = 0; k < inputs.length; k++) {
              inputs[k].addEventListener('input', function() {
                updateAlertRuleFromRow(tr);
                clearTimeout(alertSaveTimer);
                alertSaveTimer = setTimeout(function() {
                  sendUpdate('alerts', currentAlerts);
                  showToast('⚡ 预警规则已保存');
                }, 500);
              });
            }
            var chk = tr.querySelector('.alert-enabled');
            if (chk) {
              chk.addEventListener('change', function() {
                updateAlertRuleFromRow(tr);
                sendUpdate('alerts', currentAlerts);
                showToast(chk.checked ? '✅ 已开启预警监控' : '⚪ 已暂停预警监控');
              });
            }
          })(rows[i]);
        }
      }

      // ── 网络标签模式控制 ──
      function applyProxyCardVisibility(section, mode) {
        var tag = document.getElementById(section + 'NetTag');
        if (!tag) return;
        if (mode === 'direct') {
          tag.className = 'direct-tag';
          tag.innerHTML = (section === 'binance' || section === 'alpha') ? '⚡ 已切换为直连访问' : '⚡ 当前为境内直连（推荐）';
        } else {
          tag.className = 'security-tag';
          tag.innerHTML = (section === 'binance' || section === 'alpha') ? '🛡️ 已启用杜绝直连保护（使用通用设置中的全局代理）' : '🛡️ 已启用代理（使用通用设置中的全局代理）';
        }
      }

      function handleNetChange(section, mode) {
        sendUpdate(section + '.networkMode', mode);
        applyProxyCardVisibility(section, mode);
        showToast(mode === 'direct' ? '⚡ 已切换为直连模式' : '🛡️ 已切换为代理模式');
      }

      function handlePortBlur(input) {
        var raw = (input.value || '').trim();
        var match = raw.match(/:(\d{1,5})/);
        if (match) {
          raw = match[1];
        }
        var port = parseInt(raw, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          showToast('⚠️ 端口号必须是 1 到 65535 之间的有效整数');
          input.value = input.getAttribute('data-last-valid') || '${DEFAULT_PROXY_PORT}';
          return;
        }
        var lastValid = input.getAttribute('data-last-valid');
        if (lastValid && String(port) === String(lastValid)) {
          return;
        }
        input.value = String(port);
        input.setAttribute('data-last-valid', String(port));
        sendUpdate('proxyPort', port);
        showToast('⚡ 本地代理端口已设置为 ' + port);
      }

      // ── DOM 事件绑定辅助 ──
      function on(id, evt, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener(evt, fn);
      }

      // 1. 通用设置事件
      on('btnRestoreDefaults', 'click', function() {
        var tbody = document.getElementById('alertTableBody');
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--desc-fg); padding: 24px;">🔄 正在恢复出厂默认设置并重构标的列表，请稍候...</td></tr>';
        }
        postCmd('restoreDefaults');
        showToast('🔄 正在请求恢复出厂默认设置...');
      });
      on('btnClearWatchlist', 'click', function() {
        postCmd('clearWatchlist');
        showToast('🗑️ 正在请求清空自选标的...');
      });
      on('btnExportSettings', 'click', function() {
        postCmd('exportSettings');
      });
      on('btnImportSettings', 'click', function() {
        postCmd('importSettings');
      });
      var subIds = ${JSON.stringify(MARKET_SECTIONS.map((s) => `${s}StatusBar`))};
      on('statusBarEnabled', 'change', function() {
        var checked = this.checked;
        for (var i = 0; i < subIds.length; i++) {
          var el = document.getElementById(subIds[i]);
          if (el) el.checked = checked;
        }
        sendUpdate('statusBar.enabled', checked);
        showToast(checked ? '✅ 已开启全部标的参与底部轮播' : '⚪ 已关闭全部标的参与底部轮播');
      });
      on('autoCollapseClosedGroups', 'change', function() {
        sendUpdate('autoCollapseClosedGroups', this.checked);
        showToast(this.checked ? '🌙 已开启休市自动折叠与停止轮播' : '⚪ 已关闭休市自动折叠与停止轮播');
      });

      function syncMasterSwitch() {
        var anyChecked = subIds.some(function(id) {
          var el = document.getElementById(id);
          return el && el.checked;
        });
        var master = document.getElementById('statusBarEnabled');
        if (master) {
          master.checked = !!anyChecked;
        }
      }
      on('autoRefresh', 'change', function() {
        sendUpdate('autoRefresh', this.checked);
        showToast(this.checked ? '✅ 已开启定时自动刷新' : '⚪ 已关闭定时自动刷新');
      });
      on('refreshInterval', 'change', function() {
        var val = parseInt(this.value, 10);
        if (!isNaN(val) && val >= 1000) {
          sendUpdate('refreshInterval', val);
          showToast('⏱️ 全局刷新频率已更新为 ' + val + ' 毫秒');
        }
      });
      on('maskMode', 'change', function() {
        sendUpdate('maskMode', this.checked);
        showToast(this.checked ? '🕶️ 伪装摸鱼模式已开启' : '👁️ 伪装摸鱼模式已关闭');
        renderAlertTable(currentWatchlist, currentAlerts);
      });
      on('colorNeutral', 'change', function() {
        sendUpdate('colorNeutral', this.checked);
        showToast(this.checked ? '🎨 颜色脱敏模式已开启' : '🔴 颜色脱敏模式已关闭');
      });
      on('colorScheme', 'change', function() {
        var neutralEl = document.getElementById('colorNeutral');
        if (neutralEl) {
          neutralEl.checked = false;
        }
        sendUpdate('colorScheme', this.value);
        showToast(this.value === 'redUpGreenDown' ? '🔴 已切换为红涨绿跌 (已自动关闭颜色脱敏)' : '🟢 已切换为绿涨红跌 (已自动关闭颜色脱敏)');
      });
      on('btnKeybindMask', 'click', function() {
        postCmd('openKeybindings', { query: 'marketlens.toggleMask' });
      });
      on('btnKeybindColor', 'click', function() {
        postCmd('openKeybindings', { query: 'marketlens.toggleColorNeutral' });
      });
      on('btnKeybindAll', 'click', function() {
        postCmd('openKeybindings', { query: 'marketlens' });
      });
      on('globalProxyPort', 'blur', function() { handlePortBlur(this); });
      on('globalProxyPort', 'keydown', function(e) {
        if (e.key === 'Enter') {
          this.blur();
        }
      });
      on('btnDetectGlobal', 'click', function() { triggerDetect('global'); });

      // 2. 到价预警事件
      on('alertNotificationMode', 'change', function() {
        sendUpdate('alertNotificationMode', this.value);
        showToast('⚡ 预警提醒方式已更新');
      });
      on('alertCooldownMinutes', 'change', function() {
        var val = parseInt(this.value, 10);
        if (isNaN(val) || val < 1) val = 15;
        this.value = val;
        sendUpdate('alertCooldownMinutes', val);
        showToast('⚡ 预警冷却时间已更新为 ' + val + ' 分钟');
      });
      on('btnClearAllAlerts', 'click', function() {
        postCmd('clearAllAlerts');
      });

      // 3. 关于与交流事件
      on('btnOpenIssues', 'click', function() {
        postCmd('openExternal', { url: 'https://github.com/DevQQQQQ/marketLens/issues' });
      });
      on('btnJoinTelegram', 'click', function() {
        postCmd('openExternal', { url: 'https://t.me/+-eZR0R--jyUwN2Nl' });
      });
      on('btnJoinPersonalTelegram', 'click', function() {
        postCmd('openExternal', { url: 'https://t.me/Dev_QQQQQ' });
      });
      on('btnOpenRepo', 'click', function() {
        postCmd('openExternal', { url: 'https://github.com/DevQQQQQ/marketLens' });
      });

      // 基金市场事件
      on('fundEnabled', 'change', function() {
        sendUpdate('fund.enabled', this.checked);
        showToast(this.checked ? '✅ 基金分组已启用' : '⚪ 基金分组已禁用');
      });
      on('fundStatusBar', 'change', function() {
        syncMasterSwitch();
        sendUpdate('fund.statusBar', this.checked);
        showToast(this.checked ? '✅ 基金标的参与底部轮播' : '⚪ 基金标的退出底部轮播');
      });
      on('fundStopOnMarketClosed', 'change', function() {
        sendUpdate('fund.stopOnMarketClosed', this.checked);
        showToast(this.checked ? '🌙 基金休市停刷已开启' : '☀️ 基金持续拉取已开启');
      });
      on('fundNetDirect', 'change', function() { handleNetChange('fund', 'direct'); });
      on('fundNetProxy', 'change', function() { handleNetChange('fund', 'proxy'); });

      // 3. A股市场事件
      on('aShareEnabled', 'change', function() {
        sendUpdate('aShare.enabled', this.checked);
        showToast(this.checked ? '✅ A股分组已启用' : '⚪ A股分组已禁用');
      });
      on('aShareStatusBar', 'change', function() {
        syncMasterSwitch();
        sendUpdate('aShare.statusBar', this.checked);
        showToast(this.checked ? '✅ A股标的参与底部轮播' : '⚪ A股标的退出底部轮播');
      });
      on('aShareStopOnMarketClosed', 'change', function() {
        sendUpdate('aShare.stopOnMarketClosed', this.checked);
        showToast(this.checked ? '🌙 A股休市停刷已开启' : '☀️ A股持续拉取已开启');
      });
      on('aShareNetDirect', 'change', function() { handleNetChange('aShare', 'direct'); });
      on('aShareNetProxy', 'change', function() { handleNetChange('aShare', 'proxy'); });

      // 4. 港股市场事件
      on('hkStockEnabled', 'change', function() {
        sendUpdate('hkStock.enabled', this.checked);
        showToast(this.checked ? '✅ 港股分组已启用' : '⚪ 港股分组已禁用');
      });
      on('hkStockStatusBar', 'change', function() {
        syncMasterSwitch();
        sendUpdate('hkStock.statusBar', this.checked);
        showToast(this.checked ? '✅ 港股标的参与底部轮播' : '⚪ 港股标的退出底部轮播');
      });
      on('hkStockStopOnMarketClosed', 'change', function() {
        sendUpdate('hkStock.stopOnMarketClosed', this.checked);
        showToast(this.checked ? '🌙 港股休市停刷已开启' : '☀️ 港股持续拉取已开启');
      });
      on('hkStockNetDirect', 'change', function() { handleNetChange('hkStock', 'direct'); });
      on('hkStockNetProxy', 'change', function() { handleNetChange('hkStock', 'proxy'); });

      // 5. 美股市场事件
      on('usStockEnabled', 'change', function() {
        sendUpdate('usStock.enabled', this.checked);
        showToast(this.checked ? '✅ 美股分组已启用' : '⚪ 美股分组已禁用');
      });
      on('usStockStatusBar', 'change', function() {
        syncMasterSwitch();
        sendUpdate('usStock.statusBar', this.checked);
        showToast(this.checked ? '✅ 美股标的参与底部轮播' : '⚪ 美股标的退出底部轮播');
      });
      on('usStockStopOnMarketClosed', 'change', function() {
        sendUpdate('usStock.stopOnMarketClosed', this.checked);
        showToast(this.checked ? '🌙 美股休市停刷已开启' : '☀️ 美股持续拉取已开启');
      });
      on('usStockNetDirect', 'change', function() { handleNetChange('usStock', 'direct'); });
      on('usStockNetProxy', 'change', function() { handleNetChange('usStock', 'proxy'); });

      // 6. Binance 板块事件
      on('binanceEnabled', 'change', function() {
        sendUpdate('binance.enabled', this.checked);
        showToast(this.checked ? '✅ Binance分组已启用' : '⚪ Binance分组已禁用');
      });
      on('binanceStatusBar', 'change', function() {
        syncMasterSwitch();
        sendUpdate('binance.statusBar', this.checked);
        showToast(this.checked ? '✅ Binance标的参与底部轮播' : '⚪ Binance标的退出底部轮播');
      });
      on('binanceNetDirect', 'change', function() { handleNetChange('binance', 'direct'); });
      on('binanceNetProxy', 'change', function() { handleNetChange('binance', 'proxy'); });

      // 7. Alpha 板块事件
      on('alphaEnabled', 'change', function() {
        sendUpdate('alpha.enabled', this.checked);
        showToast(this.checked ? '✅ Alpha分组已启用' : '⚪ Alpha分组已禁用');
      });
      on('alphaStatusBar', 'change', function() {
        syncMasterSwitch();
        sendUpdate('alpha.statusBar', this.checked);
        showToast(this.checked ? '✅ Alpha标的参与底部轮播' : '⚪ Alpha标的退出底部轮播');
      });
      on('alphaNetDirect', 'change', function() { handleNetChange('alpha', 'direct'); });
      on('alphaNetProxy', 'change', function() { handleNetChange('alpha', 'proxy'); });

      // ── 接收 VS Code 消息同步 ──
      window.addEventListener('message', function(event) {
        var msg = event.data;
        if (!msg) return;

        if (msg.command === 'initSettings') {
          var d = msg.data;
          if (!d) return;

          function setChecked(id, val) { var el = document.getElementById(id); if (el) el.checked = !!val; }
          function setValue(id, val)   { var el = document.getElementById(id); if (el) el.value = (val !== undefined && val !== null) ? val : ''; }

          setChecked('autoRefresh',      d.autoRefresh);
          setValue('refreshInterval',    d.refreshInterval);
          setChecked('maskMode',         d.maskMode);
          setChecked('colorNeutral',     d.colorNeutral);
          setValue('colorScheme',        d.colorScheme || 'greenUpRedDown');
          setChecked('statusBarEnabled', d.statusBarEnabled);
          setChecked('autoCollapseClosedGroups', d.autoCollapseClosedGroups);
          var portVal = d.proxyPort || ${DEFAULT_PROXY_PORT};
          setValue('globalProxyPort', portVal);
          var portInput = document.getElementById('globalProxyPort');
          if (portInput) {
            portInput.setAttribute('data-last-valid', String(portVal));
          }

          // 基金
          setChecked('fundEnabled',            d.fundEnabled);
          setChecked('fundStatusBar',          d.fundStatusBar);
          setChecked('fundStopOnMarketClosed',  d.fundStopOnMarketClosed);
          applyProxyCardVisibility('fund', d.fundNetworkMode);
          if (d.fundNetworkMode === 'proxy') {
            setChecked('fundNetProxy', true);
          } else {
            setChecked('fundNetDirect', true);
          }

          // A股
          setChecked('aShareEnabled',            d.aShareEnabled);
          setChecked('aShareStatusBar',          d.aShareStatusBar);
          setChecked('aShareStopOnMarketClosed',  d.aShareStopOnMarketClosed);
          applyProxyCardVisibility('aShare', d.aShareNetworkMode);
          if (d.aShareNetworkMode === 'proxy') {
            setChecked('aShareNetProxy', true);
          } else {
            setChecked('aShareNetDirect', true);
          }

          // 港股
          setChecked('hkStockEnabled',            d.hkStockEnabled);
          setChecked('hkStockStatusBar',          d.hkStockStatusBar);
          setChecked('hkStockStopOnMarketClosed',  d.hkStockStopOnMarketClosed);
          applyProxyCardVisibility('hkStock', d.hkStockNetworkMode);
          if (d.hkStockNetworkMode === 'proxy') {
            setChecked('hkStockNetProxy', true);
          } else {
            setChecked('hkStockNetDirect', true);
          }

          // 美股
          setChecked('usStockEnabled',            d.usStockEnabled);
          setChecked('usStockStatusBar',          d.usStockStatusBar);
          setChecked('usStockStopOnMarketClosed',  d.usStockStopOnMarketClosed);
          applyProxyCardVisibility('usStock', d.usStockNetworkMode);
          if (d.usStockNetworkMode === 'proxy') {
            setChecked('usStockNetProxy', true);
          } else {
            setChecked('usStockNetDirect', true);
          }

          // Binance
          setChecked('binanceEnabled',   d.binanceEnabled);
          setChecked('binanceStatusBar', d.binanceStatusBar);
          applyProxyCardVisibility('binance', d.binanceNetworkMode);
          if (d.binanceNetworkMode === 'proxy') {
            setChecked('binanceNetProxy', true);
          } else {
            setChecked('binanceNetDirect', true);
          }

          // Alpha
          setChecked('alphaEnabled',   d.alphaEnabled);
          setChecked('alphaStatusBar', d.alphaStatusBar);
          applyProxyCardVisibility('alpha', d.alphaNetworkMode);
          if (d.alphaNetworkMode === 'proxy') {
            setChecked('alphaNetProxy', true);
          } else {
            setChecked('alphaNetDirect', true);
          }

          // 到价预警
          setValue('alertNotificationMode', d.alertNotificationMode || 'notification');
          setValue('alertCooldownMinutes', d.alertCooldownMinutes !== undefined ? d.alertCooldownMinutes : 15);
          if (d.alerts !== undefined) currentAlerts = d.alerts || {};
          if (d.watchlist !== undefined) currentWatchlist = d.watchlist || {};
          renderAlertTable(currentWatchlist, currentAlerts);

        } else if (msg.command === 'proxyDetected' || msg.command === 'portDetected') {
          var port = msg.port;
          if (!port && msg.url) {
            var m = msg.url.match(/:(\d{1,5})/);
            if (m) port = parseInt(m[1], 10);
          }
          if (port) {
            var input = document.getElementById('globalProxyPort');
            if (input) {
              input.value = String(port);
              input.setAttribute('data-last-valid', String(port));
            }
            sendUpdate('proxyPort', port);
            showToast('✅ 成功检测并匹配可用代理端口: ' + port);
          } else {
            showToast('❌ 未探测到活跃代理端口');
          }
        }
      });

      // 当面板获得焦点（如从侧边栏切换回设置面板）时主动拉取最新配置，确保即时同频
      window.addEventListener('focus', function() {
        postCmd('getSettings');
      });

      // 首次即时渲染到价预警表格
      renderAlertTable(currentWatchlist, currentAlerts);

      // 发起双重握手获取最新配置
      postCmd('getSettings');
      setTimeout(function() {
        postCmd('getSettings');
      }, 300);
    })();
  </script>
</body>
</html>`;
}
