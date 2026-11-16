/**
 * MarketLens Automated README.en.md Synchronization Tool
 * 
 * 实际行为（与现实严格对齐，请勿据历史注释推断）：
 * 1. 读取 README.md，提取其中的 Release 徽章 URL（img.shields.io/badge/Release-vX.Y.Z-blue.svg）；
 * 2. 若 README.en.md 中的同名徽章与之不一致则就地改写；一致时不触碰该文件；
 * 3. 计算 README.md 的 SHA-256 并写入 scripts/.readme-hash（当前仅供人工比对，无消费方）；
 * 4. 全程纯离线：不发起任何网络请求、不做任何翻译，README.en.md 的正文由人工维护。
 *
 * 历史说明：本脚本曾依赖公共机翻 API 并发翻译正文，该链路已移除
 * （原因：用户文档数据外发 + 构建非确定性 + CI 硬依赖外部服务）。
 * 现存下列导出仅为历史契约，请勿据其推断生产行为：
 * - `computeHash`：生产路径仍在调用（上述第 3 步）；
 * - `_force` 形参、`GLOSSARY_MAP`、`protectMarkdown`、`restoreMarkdown`：
 *   生产路径无调用方，仅被 test/unit.test.ts 引用。删除需同步调整测试，故保留原样。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HASH_FILE_NAME = '.readme-hash';

// 专有名词精准映射表（翻译前优先替换，确保专业术语一致性）
const GLOSSARY_MAP = [
	[/MarketLens 是一款面向开发者的股票看板 \/ 加密货币行情 \/ 摸鱼盯盘效率工具/g, 'MarketLens is a real-time financial market ticker, crypto watchlist, and stealth productivity tool for developers'],
	[/专为开发者打造的专业行情看板与极致效率工具/g, 'Professional real-time market dashboard and stealth productivity tool built for developers'],
	[/实时盯盘/g, 'Real-time tracking of'],
	[/老板键一键隐藏 \/ 恢复/g, 'Boss Key Instant Hide / Restore'],
	[/老板键/g, 'Boss Key'],
	[/摸鱼盯盘/g, 'stealth portfolio tracking'],
	[/摸鱼模式/g, 'disguise mode'],
	[/伪装摸鱼模式/g, 'Disguise Stealth Mode'],
	[/颜色脱敏模式/g, 'Color-Neutral Mode'],
	[/颜色脱敏/g, 'Color Neutrality'],
	[/活跃集修剪/g, 'Active-Set Pruning'],
	[/活跃集动态对齐/g, 'Active-Set Dynamic Alignment'],
	[/六合一全能行情/g, '6-in-1 Unified Market Coverage'],
	[/全市场资产六合一覆盖/g, '6-in-1 Unified Multi-Market Coverage'],
	[/场内 ETF \/ 联接指数基金/g, 'Exchange-Traded Funds (ETFs) & Feeder Index Funds'],
	[/场内 ETF/g, 'Exchange-Traded Funds (ETFs)'],
	[/联接基金/g, 'Feeder Funds'],
	[/基金板块/g, 'Funds & ETFs Section'],
	[/A股市场 \(沪深京\)/g, 'A-Shares (SSE / SZSE / BSE)'],
	[/港股市场 \(HK Stocks\)/g, 'Hong Kong Stocks (HKEX)'],
	[/美股市场 \(US Stocks\)/g, 'US Stocks (NASDAQ / S&P 500 / NYSE)'],
	[/Binance 币安主流代币/g, 'Binance Mainstream Crypto'],
	[/Alpha 链上 DEX 聚合 \(全链新币\)/g, 'Alpha On-Chain DEX Tokens'],
	[/到价预警/g, 'Price Alerts'],
	[/突破上限预警 \(高于目标价\)/g, 'Price Ceiling Alert (Break Above)'],
	[/跌破下限预警 \(低于目标价\)/g, 'Price Floor Alert (Drop Below)'],
	[/单日剧烈波动预警 \(涨跌幅突破\)/g, 'Intraday Volatility Alert'],
	[/状态栏平滑轮播系统/g, 'Smooth Status Bar Carousel'],
	[/各板块独立轮播开关/g, 'Independent Section Ticker Toggles'],
	[/交易时段休眠节流/g, 'Trading Hour Throttle & Idle Sleep'],
	[/专属图形化设置中心/g, 'Dedicated Graphical Settings Panel'],
	[/快捷键速查/g, 'Keyboard Shortcuts'],
	[/快速上手/g, 'Quick Start Guide'],
	[/添加自选资产/g, 'Add Watchlist Assets'],
	[/批量多选与拖拽重排/g, 'Batch Multi-Select & Drag-and-Drop Reorder'],
	[/一键置顶/g, 'Pin to Top'],
	[/一键恢复出厂预设/g, 'Restore Factory Defaults'],
	[/一键清空自选标的/g, 'Clear All Watchlist Assets'],
	[/问题反馈与开源贡献/g, 'Feedback & Open Source Contribution'],
	[/免责声明/g, 'Disclaimer'],
	[/为什么选择 MarketLens？/g, 'Why Choose MarketLens?'],
	[/核心功能与特性/g, 'Key Features & Capabilities'],
	[/持仓总资产总账（跨市场统一折算）/g, 'Portfolio Summary (Cross-Market Unified Valuation)'],
	[/前置条件/g, 'Prerequisite'],
	[/成本价 \+ 持股数量/g, 'Cost Price + Share Quantity'],
];

/**
 * 计算字符串的 SHA-256 哈希
 */
function computeHash(content) {
	return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * 保护 Markdown 语法（代码块、内联代码、图片徽章、链接URL、HTML等）为临时 Token
 */
function protectMarkdown(text) {
	const tokens = [];
	const createToken = (val) => {
		const id = `__ML_TOKEN_${tokens.length}__`;
		tokens.push({ id, val });
		return id;
	};

	let processed = text;

	// 1. 保护代码块 (``` ... ```)
	processed = processed.replace(/```[\s\S]*?```/g, (match) => createToken(match));

	// 2. 保护内联代码 (`...`)
	processed = processed.replace(/`[^`\n]+`/g, (match) => createToken(match));

	// 3. 保护 HTML 标签 (<...>)
	processed = processed.replace(/<[^>]+>/g, (match) => createToken(match));

	// 4. 保护图片及徽章 (![alt](url))
	processed = processed.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match) => createToken(match));

	// 5. 保护链接 URL，保留链接文字可被翻译 ([text](url) -> [text](__ML_TOKEN_n__))
	processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, linkUrl) => {
		const urlToken = createToken(linkUrl);
		return `[${linkText}](${urlToken})`;
	});

	// 6. 保护表格对齐分隔线 (如 | :--- | :--- |)
	processed = processed.replace(/\|\s*[:-]+[-| :]*\|/g, (match) => createToken(match));

	return { processed, tokens };
}

/**
 * 还原占位 Token
 */
function restoreMarkdown(text, tokens) {
	let restored = text;
	for (let i = tokens.length - 1; i >= 0; i--) {
		const { id, val } = tokens[i];
		const regex = new RegExp(`__\\s*ML_TOKEN_${i}\\s*__`, 'gi');
		restored = restored.replace(regex, val);
		restored = restored.replace(new RegExp(id, 'g'), val);
	}
	return restored;
}

/**
 * 同步 README.md 到 README.en.md 的离线同步逻辑（同步徽章版本与哈希，杜绝外部 API 依赖）
 */
async function syncReadmeEn(rootDir = path.resolve(__dirname, '..'), _force = false) {
	const readmeZhPath = path.join(rootDir, 'README.md');
	const readmeEnPath = path.join(rootDir, 'README.en.md');
	const hashPath = path.join(rootDir, 'scripts', HASH_FILE_NAME);

	if (!fs.existsSync(readmeZhPath)) {
		console.warn(`[MarketLens] README.md not found at ${readmeZhPath}`);
		return false;
	}

	const contentZh = fs.readFileSync(readmeZhPath, 'utf8');
	const currentHash = computeHash(contentZh);

	if (fs.existsSync(readmeEnPath)) {
		const contentEn = fs.readFileSync(readmeEnPath, 'utf8');
		const badgePattern = /https:\/\/img\.shields\.io\/badge\/Release-v[0-9A-Za-z_.-]+-blue\.svg/;
		const zhMatch = contentZh.match(badgePattern);
		if (zhMatch && zhMatch[0]) {
			const targetBadge = zhMatch[0];
			const updatedEn = contentEn.replace(badgePattern, targetBadge);
			if (updatedEn !== contentEn) {
				fs.writeFileSync(readmeEnPath, updatedEn, 'utf8');
				console.log(`[MarketLens] ✅ README.en.md version badge synchronized to ${targetBadge}`);
			}
		}
	}

	try {
		fs.writeFileSync(hashPath, currentHash, 'utf8');
		return true;
	} catch (err) {
		console.warn(`[MarketLens] ⚠️ Notice: Failed to write .readme-hash: ${err.message}. Continuing.`);
		return false;
	}
}

// 命令行直接执行逻辑
if (require.main === module) {
	const force = process.argv.includes('--force');
	syncReadmeEn(path.resolve(__dirname, '..'), force)
		.then(() => process.exit(0))
		.catch((err) => {
			console.warn(`[MarketLens] ⚠️ README.en sync notice: ${err.message}. Continuing.`);
			process.exit(0);
		});
}

module.exports = {
	syncReadmeEn,
	computeHash,
	protectMarkdown,
	restoreMarkdown,
	GLOSSARY_MAP
};
