#!/usr/bin/env node
// @ts-check
/**
 * scripts/release.js
 * MarketLens 自动化发版与 Git 工作流闭环脚本
 *
 * 流程：
 * 1. 自动从 package.json 读取当前版本 (如 1.3.8 -> v1.3.8)
 * 2. 校验所在分支必须是 dev
 * 3. 校验发版前置门禁 (sync-version:check, lint, typecheck, test)
 * 4. 提交 dev: git add . -> git commit -m "chore(release): vX.Y.Z" -> git push origin dev
 * 5. 合并 main: git checkout main -> git pull origin main --rebase -> git merge dev -> git push origin main
 * 6. 打 Tag 发布: git tag vX.Y.Z -> git push origin vX.Y.Z (触发 GitHub Actions Release CI)
 * 7. 切回 dev: git checkout dev，恢复日常开发状态
 *
 * 支持参数：
 *   --dry-run       只演练与预览将要执行的 Git 命令，不真正修改与推送
 *   --skip-checks   跳过前置门禁 (若刚刚已经手动跑过门禁)
 *   --yes, -y       跳过交互确认直接执行
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');

const isDryRun = process.argv.includes('--dry-run');
const skipChecks = process.argv.includes('--skip-checks');
const autoConfirm = process.argv.includes('--yes') || process.argv.includes('-y');

/**
 * @param {string} title
 */
function logStep(title) {
  console.log(`\n\x1b[34m========================================\x1b[0m`);
  console.log(`\x1b[1;36m▶ ${title}\x1b[0m`);
  console.log(`\x1b[34m========================================\x1b[0m`);
}

/**
 * @param {string} msg
 */
function logSuccess(msg) {
  console.log(`\x1b[32m✔ ${msg}\x1b[0m`);
}

/**
 * @param {string} msg
 */
function logWarn(msg) {
  console.log(`\x1b[33m⚠ ${msg}\x1b[0m`);
}

/**
 * @param {string} msg
 */
function logError(msg) {
  console.error(`\x1b[31m✖ ${msg}\x1b[0m`);
}

/**
 * @param {string} cmd
 * @param {import('node:child_process').ExecSyncOptions & { silent?: boolean }} [options]
 * @returns {Buffer | string}
 */
function run(cmd, options = {}) {
  console.log(`\x1b[90m$ ${cmd}\x1b[0m`);
  if (isDryRun) {
    console.log(`\x1b[33m[DRY-RUN] 跳过实际执行: ${cmd}\x1b[0m`);
    return '';
  }
  return execSync(cmd, { cwd: rootDir, stdio: options.silent ? 'pipe' : 'inherit', ...options });
}

/**
 * @param {string} cmd
 * @returns {string}
 */
function runOutput(cmd) {
  return execSync(cmd, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * @param {string} query
 * @returns {Promise<boolean>}
 */
async function askQuestion(query) {
  if (autoConfirm) return true;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      const lower = ans.trim().toLowerCase();
      resolve(lower === 'y' || lower === 'yes');
    });
  });
}

async function main() {
  logStep('1. 读取发版版本与 Git 分支检查');

  if (!fs.existsSync(pkgPath)) {
    logError('未找到 package.json 文件！');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = pkg.version;
  const tag = `v${version}`;

  console.log(`目标发布版本: \x1b[1;32m${tag}\x1b[0m`);

  // 检查是否在 git 仓库中
  try {
    runOutput('git rev-parse --is-inside-work-tree');
  } catch {
    logError('当前目录不是有效的 Git 仓库！');
    process.exit(1);
  }

  // 检查当前分支必须是 dev
  const currentBranch = runOutput('git rev-parse --abbrev-ref HEAD');
  if (currentBranch !== 'dev') {
    logError(`当前分支是 [${currentBranch}]，发版必须从 [dev] 分支发起！`);
    console.log('请先执行: git checkout dev');
    process.exit(1);
  }
  logSuccess(`当前处于 dev 分支`);

  // 检查 tag 是否已经存在
  try {
    const existingLocalTag = runOutput(`git tag -l ${tag}`);
    if (existingLocalTag === tag) {
      logError(`本地已存在标签 [${tag}]，不能重复发版！如需重新发布请更新 package.json 版本号。`);
      process.exit(1);
    }
  } catch {}

  logStep('2. 运行发版前置门禁核验');
  if (skipChecks) {
    logWarn('已通过 --skip-checks 参数跳过前置门禁');
  } else {
    try {
      console.log('正在核对版本一致性 (sync-version:check)...');
      run('npm run sync-version:check');

      console.log('正在执行 ESLint (npm run lint)...');
      run('npm run lint');

      console.log('正在执行类型检查 (npm run typecheck)...');
      run('npm run typecheck');

      console.log('正在运行全量自动化测试 (npm test)...');
      run('npm test');

      logSuccess('所有发版门禁均已 100% 验证通过！');
    } catch (err) {
      logError('发版前置门禁失败，已终止发版流程。请先修复报错后再试！');
      process.exit(1);
    }
  }

  // 检查工作区状态
  logStep('3. 检查待提交工作区');
  const statusOutput = runOutput('git status --short');
  if (statusOutput) {
    console.log('检测到以下待提交文件改动：');
    console.log(statusOutput);
  } else {
    console.log('当前工作区无未提交改动，将直接从已有提交推进合并与打 tag。');
  }

  console.log('\n即将执行的 Git 自动化流程：');
  console.log(`  1. git add .`);
  console.log(`  2. git commit -m "chore(release): ${tag}" (如果有未提交改动)`);
  console.log(`  3. git push origin dev`);
  console.log(`  4. git checkout main`);
  console.log(`  5. git pull origin main --rebase`);
  console.log(`  6. git merge dev -m "chore(merge): dev into main (${tag})"`);
  console.log(`  7. git push origin main`);
  console.log(`  8. git tag ${tag}`);
  console.log(`  9. git push origin ${tag}`);
  console.log(`  10. git checkout dev`);

  const confirmed = await askQuestion(`\n\x1b[1;33m确认执行上述发布流程吗？(y/N): \x1b[0m`);
  if (!confirmed) {
    console.log('已取消发布操作。');
    process.exit(0);
  }

  logStep(`4. 提交 dev 分支并推送`);
  if (statusOutput) {
    run('git add .');
    run(`git commit -m "chore(release): ${tag}"`);
  }
  run('git push origin dev');
  logSuccess(`dev 分支已成功推送`);

  logStep(`5. 切换到 main 并合并 dev`);
  run('git checkout main');
  try {
    run('git pull origin main --rebase');
  } catch (err) {
    logWarn('git pull origin main 遇到提醒（可能无 upstream 或首次同步），继续推进 merge');
  }
  run(`git merge dev -m "chore(merge): dev into main (${tag})"`);
  run('git push origin main');
  logSuccess(`main 分支已合入最新提交并推送到 GitHub`);

  logStep(`6. 创建并推送发布标签 ${tag}`);
  run(`git tag ${tag}`);
  run(`git push origin ${tag}`);
  logSuccess(`已推送标签 ${tag} 到 GitHub (将自动触发 GitHub Actions 发布 Release)`);

  logStep(`7. 自动恢复工作分支`);
  run('git checkout dev');
  logSuccess(`已成功切回 dev 分支`);

  console.log(`\n\x1b[1;32m🎉 [${tag}] 发布流程全部圆满完成！\x1b[0m\n`);
}

main().catch((err) => {
  logError(`发布过程中发生异常中断: ${err.message || err}`);
  process.exit(1);
});
