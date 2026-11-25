// src/ui/panoramaHtml.ts
// 市场全景行情中心 Webview HTML 模版（Phase 2 全市场 6 Tab 完整落地）。
// 零外部依赖，严格遵循 VS Code 主题变量与 CSP 安全规范。

export interface PanoramaHtmlOptions {
  readonly nonce: string;
  readonly cspSource: string;
}

export function getPanoramaHtml(options: PanoramaHtmlOptions): string {
  const { nonce, cspSource } = options;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; font-src ${cspSource};">
  <title>MarketLens 行情中心</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-foreground, #cccccc);
      --border: var(--vscode-panel-border, #333333);
      --card-bg: var(--vscode-editorWidget-background, #252526);
      --up-color: #eb445a;
      --down-color: #2dd36f;
      --neutral-color: #8a919e;
      --accent: var(--vscode-focusBorder, #007acc);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 16px 20px;
      overflow-x: hidden;
      user-select: none;
    }
    /* 顶部导航与 Tab 栏 */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .header-title {
      font-size: 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tabs {
      display: flex;
      gap: 6px;
      background: var(--card-bg);
      padding: 3px;
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--fg);
      padding: 6px 14px;
      font-size: 13px;
      cursor: pointer;
      border-radius: 4px;
      transition: all 0.15s ease;
      opacity: 0.75;
    }
    .tab-btn:hover { opacity: 1; background: rgba(255, 255, 255, 0.05); }
    .tab-btn.active {
      background: var(--accent);
      color: #ffffff;
      opacity: 1;
      font-weight: 500;
    }
    .refresh-info {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .refresh-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
      border-radius: 4px;
      padding: 3px 8px;
      cursor: pointer;
      font-size: 11px;
    }
    .refresh-btn:hover { background: rgba(255, 255, 255, 0.08); }

    /* 内容区栅格布局 */
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .grid-row {
      display: grid;
      grid-template-columns: 340px 1fr 240px;
      gap: 16px;
      align-items: stretch;
      min-height: 480px;
    }
    @media (max-width: 960px) {
      .grid-row { grid-template-columns: 1fr; }
    }
    .crypto-grid {
      display: grid;
      grid-template-columns: 300px 1fr;
      gap: 16px;
      min-height: 480px;
    }
    @media (max-width: 800px) {
      .crypto-grid { grid-template-columns: 1fr; }
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
    }
    .card-title {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      color: var(--fg);
    }
    .card-title .badge {
      font-size: 11px;
      font-weight: normal;
      color: var(--vscode-descriptionForeground, #888);
    }

    /* 指数卡片网格 */
    .index-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .index-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      transition: background 0.15s ease;
    }
    .index-card:hover { background: rgba(255, 255, 255, 0.06); }
    .index-card .card-head {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .index-card .card-price {
      font-size: 20px;
      font-weight: 700;
      margin: 4px 0 2px 0;
    }
    .index-card .card-chg {
      font-size: 12px;
      font-weight: 600;
      display: flex;
      gap: 8px;
    }

    /* Treemap 热力图容器 */
    .treemap-container {
      position: relative;
      flex: 1;
      min-height: 420px;
      border-radius: 4px;
      overflow: hidden;
      background: rgba(0, 0, 0, 0.2);
    }
    .treemap-node {
      position: absolute;
      box-sizing: border-box;
      border: 1px solid rgba(0, 0, 0, 0.35);
      border-radius: 3px;
      padding: 4px 6px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      cursor: pointer;
      transition: transform 0.1s ease, filter 0.1s ease;
    }
    .treemap-node:hover {
      transform: scale(1.02);
      z-index: 10;
      filter: brightness(1.15);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }
    .node-name {
      font-size: 12px;
      font-weight: 600;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      text-shadow: 0 1px 2px rgba(0,0,0,0.6);
    }
    .node-change {
      font-size: 11px;
      color: #ffffff;
      margin-top: 2px;
      font-weight: 500;
      text-shadow: 0 1px 2px rgba(0,0,0,0.6);
    }

    /* 资金流向排行列表 */
    .flow-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .flow-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      padding: 6px 8px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.03);
    }
    .flow-tag {
      font-weight: 600;
      border-radius: 3px;
      padding: 2px 6px;
      font-size: 11px;
    }
    .tag-up { background: rgba(235, 68, 90, 0.15); color: var(--up-color); }
    .tag-down { background: rgba(45, 211, 111, 0.15); color: var(--down-color); }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-title">
      <span>⚡ MarketLens 行情中心</span>
    </div>
    <div class="tabs">
      <button class="tab-btn" data-tab="global">全球</button>
      <button class="tab-btn active" data-tab="ashare">A 股</button>
      <button class="tab-btn" data-tab="hk">港股</button>
      <button class="tab-btn" data-tab="us">美股</button>
      <button class="tab-btn" data-tab="fund">基金</button>
      <button class="tab-btn" data-tab="crypto">加密货币</button>
    </div>
    <div class="refresh-info">
      <span id="updateTime">正在同步最新行情...</span>
      <button class="refresh-btn" id="refreshBtn">刷新</button>
    </div>
  </div>

  <!-- A 股 Tab -->
  <div id="tab-ashare" class="tab-content active">
    <div class="grid-row">
      <!-- 涨跌分布 -->
      <div class="card">
        <div class="card-title">
          <span>A 股涨跌分布</span>
          <span class="badge" id="ashareTurnover">两市成交 --</span>
        </div>
        <div id="distributionSvgBox" style="flex:1; display:flex; align-items:center;">
          <div style="text-align:center; width:100%; color:#888; font-size:12px;">加载涨跌梯度中...</div>
        </div>
      </div>
      <!-- 行业热力图 -->
      <div class="card">
        <div class="card-title">
          <span>行业板块热力图</span>
          <span class="badge">面积: 成交额 ｜ 颜色: 涨跌幅</span>
        </div>
        <div class="treemap-container" id="ashareTreemapBox"></div>
      </div>
      <!-- 主力资金流向 -->
      <div class="card">
        <div class="card-title">
          <span>主力资金流向</span>
          <span class="badge">行业净流入/出</span>
        </div>
        <div style="font-size:11px; color:#eb445a; margin-bottom:4px; font-weight:600;">净流入 Top 5</div>
        <div class="flow-list" id="inflowList" style="margin-bottom:12px;"></div>
        <div style="font-size:11px; color:#2dd36f; margin-bottom:4px; font-weight:600;">净流出 Top 5</div>
        <div class="flow-list" id="outflowList"></div>
      </div>
    </div>
  </div>

  <!-- 全球 Tab -->
  <div id="tab-global" class="tab-content">
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title">
        <span>🌐 全球核心股指概览</span>
        <span class="badge">亚太 ｜ 美欧大盘</span>
      </div>
      <div class="index-grid" id="globalIndexGrid"></div>
    </div>
    <div class="card">
      <div class="card-title">
        <span>🪙 宏观大宗商品与外汇</span>
        <span class="badge">黄金 ｜ 原油 ｜ 离岸汇率</span>
      </div>
      <div class="index-grid" id="globalCommodityGrid"></div>
    </div>
  </div>

  <!-- 港股 Tab -->
  <div id="tab-hk" class="tab-content">
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title">
        <span>🇭🇰 港股核心宽基指数</span>
        <span class="badge">腾讯实时行情</span>
      </div>
      <div class="index-grid" id="hkIndexGrid"></div>
    </div>
    <div class="card">
      <div class="card-title">
        <span>港股核心重仓龙头资产热力图</span>
        <span class="badge">面积: 交易体量 ｜ 颜色: 涨跌幅</span>
      </div>
      <div class="treemap-container" id="hkTreemapBox"></div>
    </div>
  </div>

  <!-- 美股 Tab -->
  <div id="tab-us" class="tab-content">
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title">
        <span>🇺🇸 美股三大基准指数</span>
        <span class="badge">纽约证券交易所 ｜ 纳斯达克</span>
      </div>
      <div class="index-grid" id="usIndexGrid"></div>
    </div>
    <div class="card">
      <div class="card-title">
        <span>科技七巨头 (Magnificent 7) 权重热力图</span>
        <span class="badge">面积: 市值 (万亿美元) ｜ 颜色: 涨跌幅</span>
      </div>
      <div class="treemap-container" id="usTreemapBox"></div>
    </div>
  </div>

  <!-- 基金 Tab -->
  <div id="tab-fund" class="tab-content">
    <div class="card">
      <div class="card-title">
        <span>📊 全市场核心热门 ETF 榜单</span>
        <span class="badge">宽基与主流主题 ｜ 面积: 成交活跃度</span>
      </div>
      <div class="treemap-container" id="fundTreemapBox"></div>
    </div>
  </div>

  <!-- 加密货币 Tab -->
  <div id="tab-crypto" class="tab-content">
    <div class="grid-row">
      <!-- 恐慌与贪婪仪表盘 -->
      <div class="card">
        <div class="card-title">
          <span>加密市场宏观情绪</span>
          <span class="badge">Alternative.me</span>
        </div>
        <div id="fearGreedSvgBox" style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center;">
          <div style="color:#888; font-size:12px;">加载情绪指数中...</div>
        </div>
        <div id="fearGreedHistory" style="margin-top:10px; font-size:11px; color:#888; line-height:1.6; border-top:1px solid var(--border); padding-top:8px;"></div>
      </div>
      <!-- 主流币热力图 -->
      <div class="card">
        <div class="card-title">
          <span>主流资产 24h 涨跌热力图</span>
          <span class="badge">Binance 现货 ｜ 面积: 成交额</span>
        </div>
        <div class="treemap-container" id="cryptoTreemapBox"></div>
      </div>
      <!-- 24h 涨跌排行榜 -->
      <div class="card">
        <div class="card-title">
          <span>24h 涨跌排行榜</span>
          <span class="badge">成交额 > 50万 U</span>
        </div>
        <div style="font-size:11px; color:#eb445a; margin-bottom:4px; font-weight:600;">24h 领涨 Top 5</div>
        <div class="flow-list" id="cryptoGainersList" style="margin-bottom:12px;"></div>
        <div style="font-size:11px; color:#2dd36f; margin-bottom:4px; font-weight:600;">24h 领跌 Top 5</div>
        <div class="flow-list" id="cryptoLosersList"></div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let currentTab = 'ashare';
    let tabDataStore = {};

    // Tab 切换逻辑
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab === currentTab) return;
        currentTab = tab;

        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const target = document.getElementById('tab-' + tab);
        if (target) target.classList.add('active');

        // 发送通知给后端按需拉取
        vscode.postMessage({ command: 'switchTab', tab });
        renderCurrentTab();
      });
    });

    document.getElementById('refreshBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh', tab: currentTab });
    });

    // 监听后端消息
    window.addEventListener('message', event => {
      const msg = event.data;
      if (!msg) return;

      tabDataStore[msg.type] = msg.data;
      if (msg.type === currentTab) {
        renderCurrentTab();
      }
      updateTimestamp();
    });

    function updateTimestamp() {
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      document.getElementById('updateTime').innerText = '已更新 ' + timeStr;
    }

    function getChangeColor(change) {
      if (change > 5) return '#d32f2f';
      if (change > 2) return '#e53935';
      if (change > 0) return '#ef5350';
      if (change === 0) return '#546e7a';
      if (change > -2) return '#43a047';
      if (change > -5) return '#2e7d32';
      return '#1b5e20';
    }

    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function renderIndexCards(containerId, items) {
      const container = document.getElementById(containerId);
      if (!container || !items) return;

      container.innerHTML = items.map(it => {
        const isUp = it.change >= 0;
        const color = isUp ? 'var(--up-color)' : 'var(--down-color)';
        const sign = isUp ? '+' : '';
        return \`
          <div class="index-card">
            <div class="card-head">
              <span>\${escapeHtml(it.name)}</span>
              <span>\${escapeHtml(it.symbol)}</span>
            </div>
            <div class="card-price" style="color:\${color}">\${it.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            <div class="card-chg" style="color:\${color}">
              <span>\${sign}\${it.change.toFixed(2)}%</span>
              <span>\${sign}\${it.changeAmount.toFixed(2)}</span>
            </div>
          </div>
        \`;
      }).join('');
    }

    // 渲染 A 股视图
    function renderAShare() {
      const data = tabDataStore['ashare'];
      if (!data) return;
      const { distribution, sectors, topInflows, topOutflows, distributionSvg } = data;

      if (distribution?.turnover) {
        document.getElementById('ashareTurnover').innerText = '两市成交 ' + distribution.turnover;
      }
      if (distributionSvg) {
        document.getElementById('distributionSvgBox').innerHTML = distributionSvg;
      }

      const inBox = document.getElementById('inflowList');
      inBox.innerHTML = (topInflows || []).map(item => \`
        <div class="flow-item">
          <span>\${escapeHtml(item.name)}</span>
          <span class="flow-tag tag-up">\${escapeHtml(item.extra || '')}</span>
        </div>
      \`).join('');

      const outBox = document.getElementById('outflowList');
      outBox.innerHTML = (topOutflows || []).map(item => \`
        <div class="flow-item">
          <span>\${escapeHtml(item.name)}</span>
          <span class="flow-tag tag-down">\${escapeHtml(item.extra || '')}</span>
        </div>
      \`).join('');

      renderTreemap('ashareTreemapBox', sectors);
    }

    // 渲染全球视图
    function renderGlobal() {
      const data = tabDataStore['global'];
      if (!data) return;
      renderIndexCards('globalIndexGrid', data.indices);
      renderIndexCards('globalCommodityGrid', data.commodities);
    }

    // 渲染港股视图
    function renderHk() {
      const data = tabDataStore['hk'];
      if (!data) return;
      renderIndexCards('hkIndexGrid', data.indices);
      renderTreemap('hkTreemapBox', data.leaders);
    }

    // 渲染美股视图
    function renderUs() {
      const data = tabDataStore['us'];
      if (!data) return;
      renderIndexCards('usIndexGrid', data.indices);
      renderTreemap('usTreemapBox', data.mag7);
    }

    // 渲染基金视图
    function renderFund() {
      const data = tabDataStore['fund'];
      if (!data) return;
      renderTreemap('fundTreemapBox', data.popularEtfs);
    }

    // 渲染加密货币视图
    function renderCrypto() {
      const data = tabDataStore['crypto'];
      if (!data) return;
      const { fearGreedSvg, fearGreed, heatmap, topGainers, topLosers } = data;

      if (fearGreedSvg) {
        document.getElementById('fearGreedSvgBox').innerHTML = fearGreedSvg;
      }

      if (fearGreed) {
        const histBox = document.getElementById('fearGreedHistory');
        const pClose = fearGreed.previousClose !== undefined ? fearGreed.previousClose : '--';
        const wClose = fearGreed.oneWeekAgo !== undefined ? fearGreed.oneWeekAgo : '--';
        histBox.innerHTML = \`
          <div>• 昨收读数: <b>\${pClose}</b> ｜ 上周基准: <b>\${wClose}</b></div>
          <div style="margin-top:2px; opacity:0.8;">💡 评级 < 25 为极度恐慌超卖区；> 75 为极端亢奋过热区</div>
        \`;
      }

      const gBox = document.getElementById('cryptoGainersList');
      if (gBox) {
        gBox.innerHTML = (topGainers || []).map(item => \`
          <div class="flow-item">
            <span>\${escapeHtml(item.name)} <span style="font-size:10px; color:#888;">$\${item.price < 0.01 ? item.price.toFixed(4) : item.price.toFixed(2)}</span></span>
            <span class="flow-tag tag-up">+\${item.change.toFixed(2)}%</span>
          </div>
        \`).join('');
      }

      const lBox = document.getElementById('cryptoLosersList');
      if (lBox) {
        lBox.innerHTML = (topLosers || []).map(item => \`
          <div class="flow-item">
            <span>\${escapeHtml(item.name)} <span style="font-size:10px; color:#888;">$\${item.price < 0.01 ? item.price.toFixed(4) : item.price.toFixed(2)}</span></span>
            <span class="flow-tag tag-down">\${item.change.toFixed(2)}%</span>
          </div>
        \`).join('');
      }

      renderTreemap('cryptoTreemapBox', heatmap);
    }

    // 原生 Treemap 渲染（使用相对百分比铺满容器，兼容半宽多列与全宽单列卡片）
    function renderTreemap(containerId, items) {
      const container = document.getElementById(containerId);
      if (!container || !items || items.length === 0) return;

      let totalW = 0;
      let totalH = 0;
      for (const node of items) {
        if (node.x + node.w > totalW) totalW = node.x + node.w;
        if (node.y + node.h > totalH) totalH = node.y + node.h;
      }
      if (totalW <= 0 || totalH <= 0) return;

      container.innerHTML = items.map(node => {
        const bg = getChangeColor(node.change);
        const changeSign = node.change >= 0 ? '+' : '';
        const titleText = escapeHtml((node.name || '') + ' (' + changeSign + node.change.toFixed(2) + '%)' + (node.extra ? ' ' + node.extra : ''));
        const leftPct = (node.x / totalW * 100).toFixed(4);
        const topPct = (node.y / totalH * 100).toFixed(4);
        const wPct = (node.w / totalW * 100).toFixed(4);
        const hPct = (node.h / totalH * 100).toFixed(4);
        return \`
          <div class="treemap-node" title="\${titleText}" style="left:\${leftPct}%; top:\${topPct}%; width:\${wPct}%; height:\${hPct}%; background:\${bg};">
            <span class="node-name">\${escapeHtml(node.name)}</span>
            <span class="node-change">\${changeSign}\${node.change.toFixed(2)}%</span>
          </div>
        \`;
      }).join('');
    }

    function renderCurrentTab() {
      switch (currentTab) {
        case 'ashare': renderAShare(); break;
        case 'global': renderGlobal(); break;
        case 'hk': renderHk(); break;
        case 'us': renderUs(); break;
        case 'fund': renderFund(); break;
        case 'crypto': renderCrypto(); break;
      }
    }

    window.addEventListener('resize', () => {
      vscode.postMessage({ command: 'resize', width: window.innerWidth, height: window.innerHeight });
    });

    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
}
