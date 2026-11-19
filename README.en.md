# MarketLens is a financial market ticker, portfolio PnL tracker, and stealth productivity tool for developers. It unifies Funds, Market Indices, A-Shares, Hong Kong Stocks, US Stocks, Binance Crypto, and on-chain DEX tokens, keeping you informed of market fluctuations while coding.

<p align="center">
  <b>📊 Professional real-time market dashboard, portfolio tracker, and stealth productivity tool built for developers</b><br>
  Real-time tracking of Exchange-Traded Funds (ETFs) & Feeder Funds, Market Indices, A-Shares (SSE / SZSE / BSE), Hong Kong Stocks (HKEX), US Stocks (NASDAQ / S&P 500 / NYSE), Binance mainstream crypto, and all-chain DEX tokens (Solana / BSC / Base / Ethereum, etc.), with multi-currency portfolio valuation.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS_Code-^1.85.0-007ACC?logo=visualstudiocode" alt="VS Code Version">
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/Release-v1.3.9-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-orange" alt="Platform">
</p>

---

## 🌟 Why Choose MarketLens?

As developers, while focusing on writing code, we often need to keep an eye on our investments (funds, stocks, market indices, crypto, and on-chain tokens). Constantly switching between desktop trading applications breaks your coding flow and easily attracts unwanted attention.

**MarketLens** deeply integrates multi-market tickers and productivity alerts directly into VS Code:

- 🌲 **6-in-1 Unified Market Coverage**: On-field ETFs/funds, A-Shares, HK stocks, US stocks, Binance crypto, and Alpha DEX tokens all in one place—say goodbye to multi-app switching.
- 🎯 **Trading Day IPO & Subscription Calendar**: Intelligent reminders for today's A-share IPOs, convertible bonds, and HK IPOs during trading hours, one-click copy to clipboard with zero-spam protection.
- ⚡ **Price Alerts & Volatility Monitoring**: Real-time notifications for breaking upper resistance, falling below stop-loss, or sharp intraday swings—no need to stare at charts all day.
- 🔍 **Smart Chinese & Pinyin Fuzzy Search**: Search stocks directly by name (e.g., "贵州茅台", "腾讯") or Pinyin acronym ("GZMT", "TC") without memorizing numeric codes.
- 🖱️ **Multi-Select Batch Drag & Drop & Multi-Dimensional Sorting**: Hold `Shift` or `Ctrl` / `Cmd` to reorder items in batches, and sort groups by change %, price, or Pinyin with one click.
- 🏷️ **Custom Aliases & Granular Status Bar Controls**: Assign custom nicknames/disguises to any asset, and independently toggle whether each individual item appears on the status bar.
- 🕶️ **Ultimate Stealth & Safety**: Equipped with one-click Boss Key hiding, disguised compilation terminal logs, Color-Neutral Mode, and closed-market auto collapsing & throttling.
- 📊 **Smooth Status Bar Carousel**: Bottom status bar ticker scrolls smoothly on demand, with per-section & per-symbol toggle controls and space-saving compact mode.
- 🧹 **Active-Set Pruning & Ultra-Low Memory Usage**: Automatically reclaims dead cache and aligns memory. Incremental heap usage stays stably below 15MB~25MB with zero memory leaks.
- 🛡️ **Enterprise Privacy & Security**: Direct connections to compliant domestic financial sources, with mandatory local proxy routing for Web3 requests to avoid company gateway logs.

---

## ✨ Key Features & Capabilities

### 1. 🌐 6-in-1 Unified Multi-Market Coverage

- 📈 **Funds & ETFs Section (Exchange-Traded Funds & Feeder Index Funds)**:
    - Dedicated top-level group and independent settings panel;
    - Intelligent parsing of ETF and index codes such as STAR 50 ETF, ChiNext ETF, Nasdaq ETF, Gold ETF, etc.;
    - Full support for closed-market pause, status bar carousel, and independent sorting memory.
- 🇨🇳 **A-Shares (SSE / SZSE / BSE)**:
    - Direct connection to legitimate financial quote APIs with zero latency;
    - Full coverage of Shanghai, Shenzhen, and Beijing Stock Exchanges, including major market indices (SSE Composite, CSI 300, etc.);
    - Smart trading hour detection: polls only during weekday trading sessions; auto-hibernates and throttles after market close and on weekends.
- 🇭🇰 **Hong Kong Stocks (HKEX)**:
    - Covers Hang Seng Index, Tencent, Meituan, Alibaba, Xiaomi, and other core blue chips;
    - Recognizes standard 5-digit symbols (`00700`, `03690`) with multi-currency HKD (`HK$`) pricing.
- 🇺🇸 **US Stocks (NASDAQ / S&P 500 / NYSE)**:
    - Comprehensive coverage of Nasdaq, S&P 500, and Dow Jones benchmarks;
    - Real-time tracking of Apple (`AAPL`), Nvidia (`NVDA`), Tesla (`TSLA`), Microsoft (`MSFT`), Nasdaq Composite (`.IXIC`), etc.;
    - Timezone-aware handling of US trading sessions and after-hours displays.
- 🟡 **Binance Mainstream Crypto**:
    - Real-time prices for BTC, ETH, SOL, BNB, DOGE, Uniswap, and altcoins;
    - 24/7 round-the-clock price tracking and intraday volatility stats.
- 🦄 **Alpha On-Chain DEX Aggregation (All-Chain New Tokens)**:
    - Powered by DexScreener global decentralized exchange aggregation;
    - Supports Solana, BSC, Base, Ethereum, Arbitrum, and other major chains;
    - Paste any token contract address to instantly fetch token names, prices, 24h changes, and liquidity pool depth.

---

### 2. 🎯 Trading Day IPO & Subscription Calendar (A-Shares / Convertible Bonds / HK IPOs)

A specialized companion for A-share and HK market participants—no more manually browsing financial sites for IPO dates:

- **Smart Time-Window Auto-Detection**:
    - Automatically checks for new subscriptions only during trading day hours (09:15 ~ 15:00 Beijing Time);
    - Aggregates official A-share IPOs, A-share convertible bond placements, and Hong Kong public offerings;
    - **Single-Alert Anti-Distraction**: Triggers at most once per trading day. If there are no active offerings today, the plugin stays completely silent.
- **One-Click QuickPick Copy**:
    - Click "View Details" on the bottom-right toast to bring up a persistent QuickPick dropdown at the top center of the editor;
    - Displays asset type, security code, **online subscription code**, issue price, allocation limits, and underlying stock;
    - Press `Enter` or click on any offering to **instantly copy formatted subscription info to your clipboard** for seamless pasting into your trading terminal;
- **Stealth Guard Suppression**:
    - During Boss Key stealth mode or disguise mode, IPO notifications are completely silenced to prevent accidental exposure.

---

### 3. ⚡ Price Threshold & Volatility Alert System

Stay focused on your code without watching tickers constantly. Receive accurate, timely alerts when assets hit key levels:

- **Three Flexible Alert Rules**:
    - **`Price Ceiling Alert (Break Above)`**: Triggers when current price >= target value (e.g., Kweichow Moutai >= 1800, BTC >= 75000);
    - **`Price Floor Alert (Drop Below)`**: Triggers when current price <= target value (e.g., Kweichow Moutai <= 1500, SOL <= 110);
    - **`Intraday Volatility Alert`**: Triggers when absolute percentage change exceeds the set threshold (e.g., daily move > 10%).
- **Dual Notification Channels**:
    - **VS Code Notification Toast**: Lightweight popup at the bottom right corner with quick dismiss actions;
    - **Status Bar Highlight Flash**: Bottom bar silently blinks and switches colors without interrupting thought flow;
    - **Dual Co-existence**: Both toast and status bar highlights trigger simultaneously.
- **15-Minute Anti-Spam Cooldown (Customizable)**:
    - Automatically silences repeated triggers on the same asset (default 15 minutes, configurable 1~1440 min) to prevent popup flooding during range-bound volatility.
- **Boss Key Veto Guard**:
    - When the Boss Key is active, all alert toasts are completely suppressed to guarantee privacy.
- **Persistent `🔔` Indicator & Tooltip Preview**:
    - Any asset with an active alert displays a permanent `🔔` icon in the sidebar;
    - Hovering over the item reveals the configured threshold values in the tooltip.
- **Graphical Alert Matrix**:
    - Centralized management table under the Settings Panel's "⚡ Price Alerts" tab for fast target price adjustments;
    - **0ms Bi-directional Sync** between sidebar and settings panel.

---

### 4. 💾 One-Click Configuration Export & Import (Backup & Sharing)

- **📤 One-Click Backup Export (JSON)**:
    - Export all active watchlist symbols (Funds, A-Shares, HK Stocks, US Stocks, Binance, Alpha), custom aliases, reordered positions, price alert rules, and personal preferences into a standard JSON backup file;
    - Ideal for offline backups, intranet migrations without cloud sync, and sharing your watchlist with peers.
- **📥 One-Click Restore Import (JSON)**:
    - Restore your entire watchlist and configuration in seconds with strict schema validation and modal confirmation protection;
    - Immediately refreshes the sidebar watchlist, status bar, and settings panel without requiring a VS Code reload.
- **🎮 Dual Access Channels**:
    - Accessible via the Command Palette (`MarketLens: Export Settings (Backup JSON)...` / `MarketLens: Import Settings (Restore JSON)...`) or dedicated buttons in the Graphical Settings Panel.

---

### 5. 🔀 Flexible Reordering, Multi-Dimensional Sorting & Custom Aliases

- **Multi-Select Batch Drag & Drop**:
    - Hold `Shift` (range selection) or `Ctrl` / `Cmd` (discrete selection) to select multiple symbols;
    - Drag and drop them together to a new position while preserving relative order;
    - **Strict Group Boundary Isolation**: Items can only be reordered within their own group, preventing accidental cross-market misplacement;
    - **Atomic Persistence**: Batch operations trigger disk write only once, eliminating high-frequency I/O races.
- **Group Multi-Dimensional Sorting (`sortGroup`)**:
    - Click the sort icon on any group header to switch between 6 sorting modes: **Default custom drag-and-drop order, Daily Change % Descending, Change % Ascending, Price Descending, Price Ascending, and Alphabetical/Pinyin Ascending**;
    - Each group remembers its sort mode independently.
- **Custom Display Aliases (`setAlias`)**:
    - Right-click any asset and select "Set Display Alias..." to assign a personalized label;
    - Synchronized across the sidebar tree, tooltip cards, and the status bar ticker (e.g., shorten long crypto token names or disguise assets as development modules at work).
- **Auto-Collapse Closed Groups (`autoCollapseClosedGroups`)**:
    - Automatically collapses A-Share, HK Stock, and US Stock groups during non-trading hours and weekends, keeping your sidebar clean and focused on active 24/7 markets.
- **Pin to Top**: Right-click any asset or run **🔝 Pin to Top** to move it to the top of its section;
- **Quick Alerts & Deletion**: Hover to click the **`🔔` Alert** button or the **`🗑️` Delete** icon;
- **Clear All Watchlist Assets**: Clear pre-populated default symbols in one click while preserving group structure;
- **Restore Factory Defaults**: Reset the watchlist to initial default assets and clear all alerts at any time.

---

### 6. 💼 Portfolio Cost & Real-Time Floating P&L

- **Cost Price & Holding Quantity Entry**:
    - Configure holding cost price and position quantity for any watched asset (supports share counts, token balances, and fractional decimals);
    - Wizard-style setup via right-click context menu "Set Holding Cost & Quantity", or inline editing with bidirectional auto-persistence in the "⚡ Price Alerts" tab of the Settings Webview.
- **Real-Time Sidebar P&L Labels**:
    - Watchlist tree item descriptions dynamically calculate and display cumulative floating P&L and return rates (e.g., `[+¥2.00万 (+12.5%)]` / `[-$27.00 (-3.00%)]`);
    - Intelligent comma formatting and adaptive Chinese/Western high-value unit abbreviations.
- **Hover Reconciliation Tooltip Card**:
    - Hovering over any held asset expands a dedicated **"💼 Portfolio P&L Summary"** card section:
    - Clearly breaks down holding average price, position quantity, current market value, principal invested, today's P&L (intraday market-to-market), and all-time cumulative floating profit/loss.
- **Stealth & Privacy Guardrails**:
    - When disguise stealth mode (`Ctrl+Alt+K`) or boss key (`Ctrl+Alt+M`) is activated, sidebar floating P&L labels are instantly replaced with `[***]` privacy masks, and hover details are safely suppressed.

---

### 7. 📈 One-Click Global Market Benchmark Indices Import

- **One-Click Benchmark Aggregation**:
    - Aggregates core benchmarks across A-Shares (SSE Index `sh000001`, SZSE Component `sz399001`, ChiNext `sz399006`), HK Stocks (Hang Seng Index `hkHSI`, Hang Seng TECH `hkHSTECH`), US Stocks (Nasdaq `.IXIC`, S&P 500 `.INX`, Dow Jones `.DJI`), and Crypto (Bitcoin `BTCUSDT`);
    - Idempotent deduplication prevents repeated entries, allowing safe one-click importing regardless of existing watchlist contents.
- **Empty-State Sidebar Guidance & Settings Access**:
    - When the watchlist is empty or recently cleared, an actionable "📈 Import Global Core Benchmark Indices" button appears directly in the sidebar tree view;
    - Also readily accessible under "General Settings" in the Webview panel.

---

### 8. 📊 Smooth Status Bar Carousel

- **Seamless Scrolling**: Quote fetching is decoupled from the carousel timer, preventing stuttering and resets;
- **Global Status Bar Switch**: Toggle the status bar ticker on or off globally under General Settings;
- **Independent Section Toggles**:
    - Choose which sections participate in the status bar ticker (`Funds`, `A-Shares`, `HK Stocks`, `US Stocks`, `Binance`, `Alpha`);
    - Example: View all assets in the sidebar, but cycle only US stocks or crypto in the status bar.
- **Per-Symbol Independent Status Bar Toggle (`toggleStatusBarItem`)**:
    - Right-click any individual asset and select "Show / Hide in Status Bar" to precisely control whether that single asset appears in the carousel;
    - Items in the sidebar display an `👁️` indicator to clearly show their status bar visibility.
- **Status Bar Compact Mode (`statusBar.compact`)**:
    - Toggle compact mode in Settings to omit the live price and display only the asset name and change percentage (e.g., `Tencent +1.85%`);
    - Saves up to 50% of horizontal status bar space in VS Code.
- **💼 Dedicated Portfolio Floating P&L Carousel Ticker**:
    - Dedicated position ticker item positioned to the right of market quotes (priority 99), supporting smart hybrid cycling (Frame 0: account-wide total equity & aggregate P&L summary + Frame 1..N: per-asset real-time floating P&L rotation);
    - Hovering reveals the full Markdown portfolio reconciliation card, clicking brings up the Settings center;
    - **Mode B Privacy Guard**: Fully hidden with carousel timers immediately destroyed under stealth disguise mode or boss key;
    - **Customizable Interval**: Enable/disable portfolio rotation and configure cycling interval between 1~60 seconds (default 3s) in Settings.
- **🌐 Portfolio Summary (Cross-Market Unified Valuation)**:
    - **Prerequisite**: set both **Cost Price** and **Share Quantity** on a watchlist item via its right-click menu first; only items with both values are included. With no holdings recorded, `Alt + P` shows the setup guidance and the sidebar group / status-bar Frame 0 show no summary data.
    - A-share / HK / US / fund / crypto holdings are consolidated into a single base currency (CNY or USD, selectable) via live FX rates (auto-refreshed roughly every 30 minutes) — total assets, today's P&L and cumulative P&L at a glance. When fetching fails, the data is malformed, or the snapshot is older than 24 hours, built-in static reference rates are used (USDT pegged to USD; may differ from live rates). The effective rates and their source are always shown in the HUD / tooltip rather than hard-coded in the docs;
    - Frame 0 upgraded to the unified valuation scope: covers all enabled holdings across sections; closed-market assets keep their last cached closing price, so positions no longer vanish from the summary overnight. Today's P&L rate uses previous-close market value as denominator, while cumulative P&L rate uses cost basis;
    - **Three entry points**: `Alt + P` HUD (total assets / today's P&L / per-section breakdown), the pinned "💼 Portfolio" summary group atop the sidebar (toggleable in Settings), and Frame 0 of the status-bar holding ticker (also shows today's P&L amount unless compact mode is on);
    - Fully masked or silently rejected under boss key / stealth disguise mode; an already-open HUD is closed automatically when either mode is activated. The summary tooltip / HUD always labels the FX source (live rates with update time, or static-reference fallback).

---

### 9. 🕶️ Stealth Productivity & Privacy Features

- 🕶️ **Boss Key Instant Hide / Restore (`Ctrl + Alt + M` / `Alt + M`)**:
    - Instantly hides the sidebar watchlist, empties the status bar ticker, and closes the settings panel;
    - Press the shortcut again to restore everything with millisecond response;
    - Reopening the watchlist on your own (clicking the MarketLens icon in the activity bar) also exits focus mode automatically, so display switches such as `Alt + K` take effect immediately instead of being silently overridden by the hidden state;
    - **The extension stays completely silent while focus mode is active**: no status bar messages, notifications or info popups are emitted; the settings panel lists every watchlist symbol and is therefore silently refused while focus mode is active, so nothing can reveal your intent.
- 🎭 **Disguise Stealth Mode (`Ctrl + Alt + K` / `Alt + K`)**:
    - Disguises status bar tickers as realistic build logs or Git branch info (e.g., `git:(main) build: 65.2k`);
    - Also applies to the sidebar watchlist: prices and change percentages are replaced with `****`, so the panel never exposes live quotes;
    - Pressing `Alt + K` while focus mode is active automatically exits focus mode first and then disables the disguise, so the display switch can never be silently overridden.
- ⚪ **Color-Neutral Mode (`Ctrl + Alt + L` / `Alt + L`)**:
    - Replaces eye-catching red/green colors with the editor's neutral foreground color.
- 💤 **Smart Market Hour Throttling**:
    - Automatically stops polling closed markets on weekends and holidays, minimizing CPU and network usage.

---

### 10. 🧹 Active-Set Pruning & Dynamic Memory Reclamation

- **Zero Memory Leaks**:
    - Traditional extensions often retain dead cache entries and active timers after symbols are deleted;
    - MarketLens implements **Active-Set Pruning**: deleting an asset immediately cleans up its quote cache, timers, and alert rules;
    - Host process heap memory remains lean and stable (< 15MB~25MB) even when running 24/7.

---

### 11. 🛡️ Network Architecture, Sources & Privacy

Designed for corporate network environments with firewall audits, DPI, and DNS logging:

#### 📡 Transparent Quote Sources (Open, Free, Zero Credentials)

| Market Section                 | Upstream Open Source          | Domain                | Protocol & Auth          | Default Policy         |
| :----------------------------- | :---------------------------- | :-------------------- | :----------------------- | :--------------------- |
| **Funds** (ETFs & Feeder)      | Tencent Financial Open API    | `qt.gtimg.cn`         | HTTPS / HTTP (Stateless) | Direct (Zero latency)  |
| **A-Shares** (SSE / SZSE / BSE)| Tencent Financial Open API    | `qt.gtimg.cn`         | HTTPS / HTTP (Stateless) | Direct (Zero latency)  |
| **HK Stocks** (HKEX)           | Tencent Financial Open API    | `qt.gtimg.cn`         | HTTPS / HTTP (Stateless) | Direct (Zero latency)  |
| **US Stocks** (Indices/Stocks) | Tencent Financial Open API    | `qt.gtimg.cn`         | HTTPS / HTTP (Stateless) | Direct (Zero latency)  |
| **Binance** (Crypto)           | Binance Spot Public API       | `api.binance.com`     | HTTPS (Public read-only) | Mandatory proxy recommended |
| **Alpha** (All-Chain DEX)      | DexScreener Official API      | `api.dexscreener.com` | HTTPS (Public read-only) | Mandatory proxy recommended |

#### 🔒 Privacy & Defense Mechanisms

1. **Zero Credentials & Zero Data Collection**:
    - **Requires no API key, token, or account credentials**;
    - Never collects, logs, or uploads user code, workspace info, device fingerprints, or watchlists. All data remains local in VS Code's `settings.json`.
2. **Mandatory Proxy Physical Blocker (No Direct Fallback)**:
    - When forced proxy is enabled for Web3 sections (Binance, Alpha), packets are dispatched strictly to the local loopback proxy port (e.g., `127.0.0.1:10808` or `7890`);
    - **Never silently falls back to direct connection**: If the proxy is down, the request fails safely rather than leaking requests to corporate gateways.
3. **One-Click Proxy Auto-Detection**:
    - Settings panel includes a `⚡ Detect Proxy` button that automatically tests common local ports (Clash `7890`/`7897`, v2rayN `10808`/`10809`, sing-box `2080`, etc.);
    - Features a 30-second cooldown to prevent request storms when the proxy is offline.
4. **Trading Hour Throttling**:
    - Automatically stops polling stock and fund markets during closed hours to reduce unnecessary network footprints.

---

### 12. ⚙️ Dedicated Graphical Settings Panel

Click the **`⚙️`** gear icon at the top of the watchlist sidebar to open the modern Webview configuration panel:

- **General Settings**: Backup export & import restoration, factory reset, clear all symbols, auto-refresh toggles, refresh interval (ms precision), stealth modes, color neutrality, and global carousel control;
- **🔔 IPO & Subscription Reminders**: Automated alerts for today's A-share IPOs, convertible bonds, and HK IPOs during trading hours (09:15-15:00), or check anytime via `MarketLens: Check Today's IPO & Subscription Calendar`;
- **⚡ Price Alerts**: Centralized alert management matrix for all market symbols with threshold adjustments and cooldown timers;
- **Dedicated Section Tabs**: Independent control for Funds, A-Shares, HK Stocks, US Stocks, Binance, and Alpha;
- **About & Help**: Check version numbers, view keyboard shortcut cheatsheets, file GitHub issues, or join the community.

---

## ⌨️ Keyboard Shortcuts

| Feature                       | Windows Shortcut  | Alternate Shortcut | macOS Shortcut    | Description                                     |
| :---------------------------- | :---------------- | :----------------- | :---------------- | :---------------------------------------------- |
| **Boss Key (Hide / Restore)** | `Ctrl + Alt + M`  | `Alt + M`          | `Cmd + Alt + M`   | Instantly hide or restore all sidebars and tickers |
| **Disguise Stealth Mode**     | `Ctrl + Alt + K`  | `Alt + K`          | `Cmd + Alt + K`   | Disguise ticker as build logs / Git branch info |
| **Color-Neutral Mode**        | `Ctrl + Alt + L`  | `Alt + L`          | `Cmd + Alt + L`   | Remove red/green indicators for neutral colors   |
| **Portfolio Summary HUD**     | `Alt + P`         | -                  | `Alt + P`         | Cross-market total assets, today's P&L and per-section breakdown |
| **Configure Shortcuts**       | -                 | -                  | -                 | Click `[⌨️ Configure Shortcuts]` in Settings     |

---

## 🚀 Quick Start

### 1. Adding Watchlist Assets

Click the **`+`** icon at the top of the sidebar. The input box intelligently parses multiple formats and supports live Smartbox fuzzy suggestions:

- **🔍 Smart Chinese & Pinyin Fuzzy Search (Smartbox)**: No need to remember 6-digit stock codes. Type Chinese company names directly (e.g., `贵州茅台`, `宁德时代`, `招商银行`) or Pinyin acronyms (e.g., `GZMT`, `NDSD`, `ZSYH`), and an instant dropdown list with live suggestions will appear—select with arrow keys and press `Enter` to add;
- **Funds / ETFs**: Enter 6-digit codes (e.g., `510050` SSE 50 ETF, `159915` ChiNext ETF, `588000` STAR 50 ETF, `161725` Baijiu LOF) with or without prefixes (`sh510050`, `sz159915`);
- **A-Shares**: Enter 6 digits (e.g., `600519` Kweichow Moutai, `sh600519`, `sz000001`);
- **Hong Kong Stocks**: Enter 5 digits or prefixes (e.g., `00700` Tencent, `hk03690` Meituan);
- **US Stocks**: Enter US stock tickers (e.g., `AAPL`, `NVDA`, `TSLA`, index `.IXIC`);
- **Mainstream Crypto**: Enter trading pair names (e.g., `BTCUSDT`, `ETHUSDT`, `SOLUSDT`);
- **On-Chain DEX Tokens**: Paste EVM contract addresses (`0x...` 42 chars) or Solana Mint addresses (32~44 chars).

### 2. Multi-Select Batch Drag & Drop

- **Single Drag**: Click and hold any asset to move it up or down;
- **Batch Drag**: Hold `Ctrl` / `Cmd` or `Shift` to select multiple items, then drag them together to the target position;
- **Pin to Top**: Hover over an item and click `🔝` to immediately place it at the top of the group.

### 3. Setting Up Alerts & Volatility Monitoring

- **Sidebar Quick Setup**: Click the **`🔔`** icon on any asset to open the step-by-step wizard;
- **Matrix Management**: Open Settings, switch to the "⚡ Price Alerts" tab, and adjust multiple thresholds simultaneously.

### 4. Rich Hover Tooltip Details & One-Click Copy

Hover over any asset to view professional market metrics with one-click copy support:

- **A-Share Depth Metrics**: Turnover rate, P/E (TTM), P/B ratio, intraday amplitude, circulating market cap, total market cap, price limits (limit up/down), volume ratio, and VWAP;
- **Basic Quotes**: Open, Previous Close, High, Low; Volume, Turnover (stocks & indices);
- **On-chain DEX Metrics**: DEX liquidity pool depth, 24H volume, and FDV;
- **One-Click Code & Contract Copy**: Click `[📋 Copy]` directly within the hover tooltip card or right-click to choose "Copy Ticker / Contract Code".

### 5. 🖱️ Right-Click Context Menu Operations

Right-click any item in the watchlist sidebar to access a full suite of productivity operations:

| Menu Item | Command ID | Description |
| :--- | :--- | :--- |
| **🔝 Pin to Top** | `marketlens.pinToTop` | Instantly move the symbol to row 1 of its group |
| **🔔 Set Price Alert...** | `marketlens.setAlert` | Wizard-style configuration for price ceiling, floor, or daily move alerts |
| **💼 Set Holding Cost and Shares...** | `marketlens.setHolding` | Record holding cost basis & shares for floating P&L and portfolio summary |
| **🏷️ Set Display Alias...** | `marketlens.setAlias` | Set custom alias across tree, tooltips, and status bar ticker |
| **👁️ Show / Hide in Status Bar** | `marketlens.toggleStatusBarItem` | Independently toggle whether this asset scrolls on the status bar |
| **📋 Copy Symbol / Contract Address** | `marketlens.copyCode` | Copy ticker code or contract address directly to clipboard |
| **🗑️ Remove** | `marketlens.removeItem` | Safely remove the symbol and clean up memory cache & alert rules |

---

## 💬 Feedback & Open Source Contributions

MarketLens is completely open source! If you encounter bugs, parsing anomalies, or have new feature ideas:

- **🐛 Report Issues & Suggestions**: [GitHub Issues](https://github.com/DevQQQQQ/marketLens/issues)
- **🌟 GitHub Repository**: [DevQQQQQ/marketLens](https://github.com/DevQQQQQ/marketLens)
- **✈️ Official Telegram Group**: [Join the MarketLens Telegram Group](https://t.me/+-eZR0R--jyUwN2Nl)
- **💬 Contact Author**: [Author Telegram (@Dev_QQQQQ)](https://t.me/Dev_QQQQQ)

Feel free to star ⭐️ the repository to support development!

---

## 📄 Disclaimer

- All market data is retrieved from open, legitimate public data endpoints. Data transmission may experience network latency. All quotes are strictly for developer productivity, learning, and reference;
- This extension does not provide financial trading functionality and does not constitute investment advice.
