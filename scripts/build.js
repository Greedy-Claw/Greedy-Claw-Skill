/**
 * GreedyClaw 构建脚本
 * 
 * 功能：
 * 1. 清理 dist/ 目录
 * 2. TypeScript 编译
 * 3. 拷贝 SKILL.md 和 openclaw.plugin.json
 * 4. 生成 dist/package.json（添加 type: module）
 * 5. [可选] 创建 openclaw 符号链接（仅部署环境）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// 1. 清理 dist/
console.log('[build] 清理 dist/...');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// 2. TypeScript 编译
console.log('[build] TypeScript 编译...');
execSync('npx tsc', { cwd: ROOT, stdio: 'inherit' });

// 3. 拷贝静态文件
console.log('[build] 拷贝静态文件...');
fs.copyFileSync(path.join(ROOT, 'SKILL.md'), path.join(DIST, 'SKILL.md'));
fs.copyFileSync(path.join(ROOT, 'openclaw.plugin.json'), path.join(DIST, 'openclaw.plugin.json'));

// 4. 生成 dist/package.json
console.log('[build] 生成 dist/package.json...');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
delete pkg.type; // 移除根 package.json 的 type（如果有）
pkg.main = 'index.js';
pkg.types = 'index.d.ts';
if (pkg.openclaw) {
  pkg.openclaw.entry = 'index.js';
  pkg.openclaw.extensions = ['./index.js'];
  pkg.openclaw.setupEntry = './setup-entry.js';
}
pkg.type = 'module'; // dist 产物使用 ESM
fs.writeFileSync(
  path.join(DIST, 'package.json'),
  JSON.stringify(pkg, null, 2) + '\n',
);

// 5. [可选] 创建 openclaw 符号链接（仅部署环境）
const openclawTarget = process.env.OPENCLAW_PLUGIN_PATH;
if (openclawTarget) {
  const nodeModulesDir = path.join(DIST, 'node_modules');
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  const linkPath = path.join(nodeModulesDir, 'openclaw');
  if (fs.existsSync(linkPath)) {
    fs.rmSync(linkPath, { recursive: true, force: true });
  }
  fs.symlinkSync(openclawTarget, linkPath);
  console.log(`[build] 已创建 openclaw 符号链接 → ${openclawTarget}`);
} else {
  console.log('[build] 跳过 openclaw 符号链接（未设置 OPENCLAW_PLUGIN_PATH 环境变量）');
}

console.log('[build] 构建完成!');
