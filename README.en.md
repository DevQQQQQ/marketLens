# MarketLens is a financial market ticker, crypto watchlist, and stealth productivity tool for developers. It unifies Funds, A-Shares, Hong Kong Stocks, US Stocks, Binance Crypto, and on-chain DEX tokens, keeping you informed of market fluctuations while coding.

<p align="center">
  <b>📊 Professional real-time market dashboard and stealth productivity tool built for developers</b><br>
  Real-time tracking of Exchange-Traded Funds (ETFs) & Feeder Funds, A-Shares (SSE / SZSE / BSE), Hong Kong Stocks (HKEX), US Stocks (NASDAQ / S&P 500 / NYSE), Binance mainstream crypto, and all-chain DEX tokens (Solana / BSC / Base / Ethereum, etc.).
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS_Code-^1.85.0-007ACC?logo=visualstudiocode" alt="VS Code Version">
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/Release-v1.2.5-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-orange" alt="Platform">
</p>

---

## 🌟 Why Choose MarketLens?

As developers, while focusing on writing code, we often need to keep an eye on our investments (funds, stocks, market indices, crypto, and on-chain tokens). Constantly switching between desktop trading applications breaks your coding flow and easily attracts unwanted attention.

**MarketLens** deeply integrates multi-market tickers and productivity alerts directly into VS Code:

- 🌲 **6-in-1 Unified Market Coverage**: On-field ETFs/funds, A-Shares, HK stocks, US stocks, Binance crypto, and Alpha DEX tokens all in one place—say goodbye to multi-app switching.
- ⚡ **Price Alerts & Volatility Monitoring**: Real-time notifications for breaking upper resistance, falling below stop-loss, or sharp intraday swings—no need to stare at charts all day.
- 🖱️ **Multi-Select Batch Drag & Drop Reordering**: Hold `Shift` or `Ctrl` / `Cmd` to select multiple assets and reorder them in a single batch move.
- 🕶️ **Ultimate Stealth & Safety**: Equipped with one-click Boss Key hiding, disguised compilation terminal logs, Color-Neutral Mode, and closed-market auto throttling.
- 📊 **Smooth Status Bar Carousel**: Bottom status bar ticker scrolls smoothly on demand, with independent section toggle controls.
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

### 2. ⚡ Price Threshold & Volatility Alert System

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

### 3. 💾 One-Click Configuration Export & Import (Backup & Sharing)

- **📤 One-Click Backup Export (JSON)**:
    - Export all active watchlist symbols (Funds, A-Shares, HK Stocks, US Stocks, Binance, Alpha), custom aliases, reordered positions, price alert rules, and personal preferences into a standard JSON backup file;
    - Ideal for offline backups, intranet migrations without cloud sync, and sharing your watchlist with peers.
- **📥 One-Click Restore Import (JSON)**:
    - Restore your entire watchlist and configuration in seconds with strict schema validation and modal confirmation protection;
    - Immediately refreshes the sidebar watchlist, status bar, and settings panel without requiring a VS Code reload.
- **🎮 Dual Access Channels**:
    - Accessible via the Command Palette (`MarketLens: Export Settings (Backup JSON)...` / `MarketLens: Import Settings (Restore JSON)...`) or dedicated buttons in the Graphical Settings Panel.

---

### 4. 🖱️ Watchlist Management & Batch Reordering

- **Multi-Select Batch Drag & Drop**:
    - Hold `Shift` (range selection) or `Ctrl` / `Cmd` (discrete selection) to select multiple symbols;
    - Drag and drop them together to a new position while preserving relative order;
    - **Strict Group Boundary Isolation**: Items can only be reordered within their own group, preventing accidental cross-market misplacement;
    - **Atomic Persistence**: Batch operations trigger disk write only once, eliminating high-frequency I/O races.
- **Pin to Top**: Right-click any asset or run **🔝 Pin to Top** to move it to the top of its section;
- **Quick Alerts & Deletion**: Hover to click the **`🔔` Alert** button or the **`🗑️` Delete** icon;
- **Clear All Watchlist Assets**: Clear pre-populated default symbols in one click while preserving group structure;
- **Restore Factory Defaults**: Reset the watchlist to initial default assets and clear all alerts at any time.

---

### 5. 📊 Smooth Status Bar Carousel

- **Seamless Scrolling**: Quote fetching is decoupled from the carousel timer, preventing stuttering and resets;
- **Global Status Bar Switch**: Toggle the status bar ticker on or off globally under General Settings;
- **Independent Section Toggles**:
    - Choose which sections participate in the status bar ticker (`Funds`, `A-Shares`, `HK Stocks`, `US Stocks`, `Binance`, `Alpha`);
    - Example: View all assets in the sidebar, but cycle only US stocks or crypto in the status bar.

---

### 6. 🕶️ Stealth Productivity & Privacy Features

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

### 7. 🧹 Active-Set Pruning & Dynamic Memory Reclamation

- **Zero Memory Leaks**:
    - Traditional extensions often retain dead cache entries and active timers after symbols are deleted;
    - MarketLens implements **Active-Set Pruning**: deleting an asset immediately cleans up its quote cache, timers, and alert rules;
    - Host process heap memory remains lean and stable (< 15MB~25MB) even when running 24/7.

---

### 8. 🛡️ Network Architecture, Sources & Privacy

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

### 9. ⚙️ Dedicated Graphical Settings Panel

Click the **`⚙️`** gear icon at the top of the watchlist sidebar to open the modern Webview configuration panel:

- **General Settings**: Backup export & import restoration, factory reset, clear all symbols, auto-refresh toggles, refresh interval (ms precision), stealth modes, color neutrality, and global carousel control;
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
| **Configure Shortcuts**       | -                 | -                  | -                 | Click `[⌨️ Configure Shortcuts]` in Settings     |

---

## 🚀 Quick Start

### 1. Adding Watchlist Assets

Click the **`+`** icon at the top of the sidebar. The input box intelligently parses multiple formats:

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
