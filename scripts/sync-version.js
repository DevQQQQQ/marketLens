/**
 * MarketLens Version Synchronization Tool
 * 自动从 package.json 读取当前 version，并无损同步至：
 * 1. README.md & README.en.md 顶部的 Release Badge
 * 2. RELEASE.md 打包指南与命令行示例
 */

const fs = require('node:fs');
const path = require('node:path');

function syncVersion(rootDir = path.resolve(__dirname, '..'), cleanAll = false, dryRun = false) {
	const pkgPath = path.join(rootDir, 'package.json');
	if (!fs.existsSync(pkgPath)) {
		throw new Error(`package.json not found at ${pkgPath}`);
	}

	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
	const version = pkg.version;
	if (!version) {
		throw new Error('version field missing in package.json');
	}

	const modifiedFiles = [];

	// 1. 同步 README.md & README.en.md 的 Release Badge
	const badgePattern = /https:\/\/img\.shields\.io\/badge\/Release-v[0-9A-Za-z_.-]+-blue\.svg/g;
	const targetBadgeUrl = `https://img.shields.io/badge/Release-v${version}-blue.svg`;

	const readmes = ['README.md', 'README.en.md'];
	for (const filename of readmes) {
		const filePath = path.join(rootDir, filename);
		if (fs.existsSync(filePath)) {
			const original = fs.readFileSync(filePath, 'utf8');
			const updated = original.replace(badgePattern, targetBadgeUrl);
			if (updated !== original) {
				if (!dryRun) {
					fs.writeFileSync(filePath, updated, 'utf8');
				}
				modifiedFiles.push(filename);
			}
		}
	}

	// 2. 同步 RELEASE.md 的 vsix 文件名与示例
	const releaseMdPath = path.join(rootDir, 'RELEASE.md');
	if (fs.existsSync(releaseMdPath)) {
		const original = fs.readFileSync(releaseMdPath, 'utf8');
		let updated = original.replace(/marketlens-[0-9.]+\.vsix/g, `marketlens-${version}.vsix`);
		updated = updated.replace(/git tag v[0-9.]+ && git push origin v[0-9.]+/g, `git tag v${version} && git push origin v${version}`);
		if (updated !== original) {
			if (!dryRun) {
				fs.writeFileSync(releaseMdPath, updated, 'utf8');
			}
			modifiedFiles.push('RELEASE.md');
		}
	}

	// 2.5 同步 site/marketlens.html 的版本标签（若文件存在）
	const siteHtmlPath = path.join(rootDir, 'site', 'marketlens.html');
	if (fs.existsSync(siteHtmlPath)) {
		const original = fs.readFileSync(siteHtmlPath, 'utf8');
		const tagPattern = /<span class="tag">v[0-9A-Za-z_.-]+<\/span>/g;
		const targetTag = `<span class="tag">v${version}</span>`;
		const updated = original.replace(tagPattern, targetTag);
		if (updated !== original) {
			if (!dryRun) {
				fs.writeFileSync(siteHtmlPath, updated, 'utf8');
			}
			modifiedFiles.push(path.join('site', 'marketlens.html'));
		}
	}

	// 3. 检查并同步 CHANGELOG.md（方式 A：将 [Unreleased] 转化为当前版本并留空新 Unreleased）
	const changelogPath = path.join(rootDir, 'CHANGELOG.md');
	if (fs.existsSync(changelogPath)) {
		const original = fs.readFileSync(changelogPath, 'utf8');
		const versionHeaderPattern = new RegExp(`^## \\[(?:v)?${version.replace(/\./g, '\\.')}\\]`, 'm');
		const hasCurrentVersion = versionHeaderPattern.test(original);

		if (!hasCurrentVersion) {
			const unreleasedPattern = /^## \[(?:Unreleased|unreleased)\]/m;
			if (unreleasedPattern.test(original)) {
				const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
				const replacement = `## [Unreleased]\n\n## [${version}] - ${today}`;
				const updated = original.replace(unreleasedPattern, replacement);
				if (updated !== original) {
					if (!dryRun) {
						fs.writeFileSync(changelogPath, updated, 'utf8');
					}
					modifiedFiles.push('CHANGELOG.md');
				}
			} else {
				if (!dryRun) {
					console.warn(`[MarketLens] ⚠️ Warning: CHANGELOG.md missing entry for v${version} and no [Unreleased] section found.`);
				}
			}
		}
	}

	// 4. 自动扫描并清理 .vsix 安装包（cleanAll 为 true 时清空所有，否则只清空旧版本）
	const deletedVsix = cleanOldVsix(rootDir, version, cleanAll, dryRun);

	return {
		version,
		modifiedFiles,
		deletedVsix
	};
}

/**
 * 扫描并自动删除旧版本或所有历史 marketlens-*.vsix
 */
function cleanOldVsix(rootDir = path.resolve(__dirname, '..'), currentVersion, cleanAll = false, dryRun = false) {
	if (!currentVersion) {
		const pkgPath = path.join(rootDir, 'package.json');
		if (fs.existsSync(pkgPath)) {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
			currentVersion = pkg.version;
		}
	}
	if (!currentVersion) return [];

	const deletedFiles = [];
	const files = fs.readdirSync(rootDir);
	const vsixRegex = /^marketlens-([0-9A-Za-z_.-]+)\.vsix$/i;

	for (const file of files) {
		const match = file.match(vsixRegex);
		if (match) {
			const fileVer = match[1];
			if (cleanAll || fileVer !== currentVersion) {
				const fullPath = path.join(rootDir, file);
				try {
					if (!dryRun) {
						fs.unlinkSync(fullPath);
					}
					deletedFiles.push(file);
				} catch (err) {
					console.warn(`[MarketLens] ⚠️ Could not remove ${file}:`, err);
				}
			}
		}
	}
	return deletedFiles;
}

if (require.main === module) {
	try {
		const cleanAll = process.argv.includes('--clean-all');
		const dryRun = process.argv.includes('--dry-run');
		const result = syncVersion(undefined, cleanAll, dryRun);
		if (result.modifiedFiles.length > 0) {
			console.log(`[MarketLens] 🔄 Version synchronized to v${result.version} in: ${result.modifiedFiles.join(', ')}`);
		} else {
			console.log(`[MarketLens] ✅ All documentation and assets already in sync with v${result.version}`);
		}
		if (result.deletedVsix && result.deletedVsix.length > 0) {
			console.log(`[MarketLens] 🗑️ Cleaned up VSIX package(s): ${result.deletedVsix.join(', ')}`);
		}
	} catch (err) {
		console.error('[MarketLens] ❌ Failed to sync version:', err);
		process.exit(1);
	}
}

module.exports = { syncVersion, cleanOldVsix };

