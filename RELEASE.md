# 📦 MarketLens 打包与发布指南 (Packaging & Release)

本文档面向开发者，说明如何进行生产环境构建、打包生成 `.vsix` 离线扩展安装包、本地安装测试以及发布至微软 VS Code 插件市场。

---

## 🛠️ 1. 环境准备与生产构建

本项目使用 `esbuild` 进行极致体积优化与单文件编译。

```powershell
# 1. 安装依赖
npm install

# 2. 执行生产环境构建 (产物输出至 dist/extension.js)
npm run build
```

---

## 📦 2. 生成 `.vsix` 离线安装包

本项目通过官方 `@vscode/vsce` 工具打包。

### 方式一：npm 脚本一键打包（最便捷）
```powershell
npm run package
```

### 方式二：指定输出版本文件名
```powershell
npx @vscode/vsce package -o marketlens-1.3.2.vsix --allow-missing-repository --no-dependencies
```

> **参数解析**：
> - `--allow-missing-repository`：允许私有仓库或自建仓库跳过代码仓库强制检测；
> - `--no-dependencies`：配合 esbuild 打包，避免将整个庞大的 `node_modules` 重复打进安装包，使得最终生成的 `.vsix` 仅约 **150KB**，轻量便携秒安装。

---

## 💻 3. 本地安装与测试 `.vsix`

生成的 `.vsix` 文件可直接在内网机器、朋友电脑或本地环境中离线安装：

### 终端一键强制安装
```powershell
code --install-extension marketlens-1.3.2.vsix --force
```

### VS Code 图形界面安装
1. 打开 VS Code，按下 `Ctrl + Shift + P`（Mac: `Cmd + Shift + P`）；
2. 输入并选择：`Extensions: Install from VSIX...`（从 VSIX 安装...）；
3. 选中生成的 `marketlens-*.vsix` 文件即可完成安装；
4. 按 `Ctrl + Shift + P` 执行 `Developer: Reload Window` 重载窗口使其立即生效。

---

## 🚀 4. 双平台发布 (VS Code Marketplace & Open VSX)

### 1. VS Code Marketplace（**本平台手动发布**）
- **管理后台上传**：访问 [Marketplace Portal](https://marketplace.visualstudio.com/manage) 上传 `.vsix`；
- **命令行发布**：
  ```powershell
  npx @vscode/vsce publish -p <YOUR_VSCE_PAT> --no-dependencies
  ```

### 2. Open VSX Registry (面向 VSCodium / Gitpod)（**本平台由 CI 自动发布**）
- **管理后台上传**：访问 [Open VSX Registry](https://open-vsx.org/)；
- **命令行发布**（与 CI 同一版本、同一产物）：
  ```powershell
  npx --yes ovsx@1.3.0 publish --packagePath marketlens-<version>.vsix -p <YOUR_OVSX_PAT>
  ```

> 💡 **GitHub Actions 自动化**：推送版本 tag（如 `git tag v1.3.2 && git push origin v1.3.2`）后，`.github/workflows/release.yml` 会自动跑四道发版守卫 → 打包 → 建 GitHub Release 并挂 `.vsix` → **发布 Open VSX**（需仓库 secret `OVSX_PAT`）。
> **Marketplace 不在 CI 里发**：未配置 `VSCE_PAT` 时该步骤自动跳过（只出 `::warning::`），请按上面第 1 节从 GitHub Release 下载同一个 `.vsix` 手动发布。两个 secret 都没配时流水线才会判红。

---

## 🏷️ 5. 版本号管理与规范

- 发布新版本前，请确保在 `package.json` 中递增 `version`（遵循 [SemVer 语义化版本](https://semver.org/lang/zh-CN/)，如 `1.1.5` -> `1.1.6`）；
- 同步在 `CHANGELOG.md` 中记录新版本的更新项；
- MarketLens 设置中心的【关于与帮助】面板会自动读取运行时的最新版本号展示给用户。

---

## 📅 6. 年度法定节假日日历复核门禁 (Annual Holiday Gate)

- **维护源文件**：`src/utils/marketHours.ts` 中的 `A_SHARE_HOLIDAYS`、`HK_HOLIDAYS`、`US_HOLIDAYS` 及 `MAX_COVERED_HOLIDAY_YEAR` 常量；
- **周期与时间窗**：**每年 1 月**由维护者本人专项检查上一年度官方终版排班并授权补录；**未来年份一律不提前预置**（不追踪 11~12 月公布的次年安排，也不为此上调护栏上限）。缺次年日历对当年判定**零影响**：查表键是 `YYYY-MM-DD` 全等匹配。
- **补录核验 Checklist（同一次改动内四件齐做）**：
  1. **A股**：核对中国政府网 / 上交所 / 深交所发布的该年度休市及调休排班；
  2. **港股**：核对香港交易所（HKEX）公布的耶稣受难节、复活节、圣诞节及香港公众假期（**只录全日休市**，半日市不得写入）；
  3. **美股**：核对纽约证券交易所（NYSE）/ 纳斯达克（NASDAQ）公布的马丁路德金日、总统日、六月节等全休市日历；
  4. **护栏与标记**：将 `MAX_COVERED_HOLIDAY_YEAR` 递增至该年度，并把该年从 `FORECAST_HOLIDAY_YEARS` 移除（避免预测告警永久刷日志）；
  5. **单测守卫**：补齐该年度的数量断言（美股每年严格 10 天 / 港股平日数量 / 三市场全域不含周末），运行 `npm test` 确保节假日离线日历单元测试 100% PASS。


