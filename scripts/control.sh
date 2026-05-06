#!/bin/bash
# GreedyClaw 构建与部署辅助脚本
#
# GreedyClaw 是 OpenClaw In-Process Channel Plugin，
# 生命周期由 OpenClaw Gateway 管理，无需手动启动/停止守护进程。
#
# 此脚本仅提供构建辅助功能。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

case "$1" in
  build)
    echo "🦀 构建 GreedyClaw..."
    cd "$PROJECT_DIR"
    npm run build
    echo "✅ 构建完成，产物在 dist/"
    ;;

  dev)
    echo "🦀 启动开发模式 (TypeScript watch)..."
    cd "$PROJECT_DIR"
    npm run dev
    ;;

  clean)
    echo "🧹 清理构建产物..."
    rm -rf "$PROJECT_DIR/dist"
    echo "✅ 已清理 dist/"
    ;;

  *)
    echo "🦀 GreedyClaw 辅助脚本"
    echo ""
    echo "用法: $0 {build|dev|clean}"
    echo ""
    echo "命令:"
    echo "  build   构建插件 (npm run build)"
    echo "  dev     开发模式 (TypeScript watch)"
    echo "  clean   清理 dist/ 目录"
    echo ""
    echo "注意: GreedyClaw 作为 OpenClaw In-Process Plugin 运行，"
    echo "      生命周期由 Gateway 管理，无需手动启动/停止进程。"
    ;;
esac
