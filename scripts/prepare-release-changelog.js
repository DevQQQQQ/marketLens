// @ts-check
/**
 * scripts/prepare-release-changelog.js
 * 打包发布优化脚本：仅截取最近 3 个正式版本的更新日志打包进 .vsix，
 * 避免膨胀至 80KB+ 的历史旧账拖慢安装包体积。
 * 
 * 用法：
 *   node scripts/prepare-release-changelog.js           # 切片并生成轻量 CHANGELOG.md（备份原文件）
 *   node scripts/prepare-release-changelog.js --restore # 恢复原有的全量 CHANGELOG.md
 */

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const changelogPath = path.join(rootDir, 'CHANGELOG.md');
const backupPath = path.join(rootDir, '.CHANGELOG.full.bak');

const isRestore = process.argv.includes('--restore');

function restoreChangelog() {
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, changelogPath);
    fs.unlinkSync(backupPath);
    console.log('[MarketLens] ✅ 已成功恢复全量 CHANGELOG.md');
  } else {
    console.log('[MarketLens] ℹ 未发现全量备份文件，无需恢复。');
  }
}

function sliceChangelog(keepVersionCount = 3) {
  if (!fs.existsSync(changelogPath)) {
    console.warn('[MarketLens] ⚠ 未找到 CHANGELOG.md，跳过切片。');
    return;
  }

  // 若已存在备份，先还原确保基于全量切片
  if (fs.existsSync(backupPath)) {
    restoreChangelog();
  }

  const content = fs.readFileSync(changelogPath, 'utf8');

  // 1. 备份全量文件
  fs.writeFileSync(backupPath, content, 'utf8');

  // 2. 正则查找版本标题段落：形如 `## [x.y.z]` 或 `## [Unreleased]`
  // 注意：不要把 `## [Unreleased]` 算作消耗 keepVersionCount 的版本
  const lines = content.split('\n');
  const slicedLines = [];
  let versionCount = 0;
  let stopping = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^##\s+\[([0-9A-Za-z_.-]+)\]/);

    if (match) {
      const verName = match[1];
      if (verName.toLowerCase() !== 'unreleased') {
        versionCount++;
        if (versionCount > keepVersionCount) {
          stopping = true;
          break;
        }
      }
    }

    slicedLines.push(line);
  }

  // 3. 补充尾部友好的全量回溯说明
  slicedLines.push(
    '',
    '---',
    '',
    '> 💡 **更早历史版本更新日志**：为保持 VS Code 扩展安装包极致轻量，安装包内置文档仅收录最近 3 个版本的更新详情。若需查阅项目完整历史变更，请移步 [GitHub Releases 页面](https://github.com/) 查阅。',
    ''
  );

  const slicedContent = slicedLines.join('\n');
  fs.writeFileSync(changelogPath, slicedContent, 'utf8');

  const origSize = Buffer.byteLength(content, 'utf8');
  const newSize = Buffer.byteLength(slicedContent, 'utf8');
  console.log(
    `[MarketLens] 🚀 CHANGELOG.md 已按最近 ${keepVersionCount} 版切片：` +
    `${Math.round(origSize / 1024)} KB -> ${Math.round(newSize / 1024)} KB (立减 ${Math.round((origSize - newSize) / 1024)} KB)`
  );
}

if (isRestore) {
  restoreChangelog();
} else {
  sliceChangelog(3);
}
