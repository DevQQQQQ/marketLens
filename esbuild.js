// @ts-check
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const isProduction = process.argv.includes("--production");
const isWatch     = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],   // vscode 由宿主环境提供，不打包
  format: "cjs",          // VS Code 扩展必须使用 CommonJS
  platform: "node",
  target: "node18",
  sourcemap: !isProduction,
  minify: isProduction,
  treeShaking: true,
  minifyWhitespace: isProduction,
  minifyIdentifiers: isProduction,
  minifySyntax: isProduction,
  logLevel: "info",
};

async function main() {
  if (isProduction) {
    const mapPath = path.join(__dirname, "dist", "extension.js.map");
    if (fs.existsSync(mapPath)) {
      try {
        fs.unlinkSync(mapPath);
      } catch (_) {}
    }
  }

  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("[MarketLens] watching for changes...");
  } else {
    await esbuild.build(buildOptions);
    console.log(`[MarketLens] build complete (${isProduction ? "production" : "development"})`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
