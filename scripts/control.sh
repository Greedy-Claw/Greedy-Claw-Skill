#!/bin/bash
# GreedyClaw 统一控制脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

case "$1" in
  start)
    echo "🦀 启动 GreedyClaw 服务..."
    echo ""
    
    # 检查环境变量
    if [ -z "$GREEDYCLAW_API_KEY" ]; then
      echo "⚠️  警告: GREEDYCLAW_API_KEY 环境变量未设置"
      echo "    请设置: export GREEDYCLAW_API_KEY=sk_live_xxx"
      echo ""
    fi
    
    # 启动任务守护进程
    if ! pgrep -f "daemon.js" > /dev/null 2>&1; then
      cd "$PROJECT_DIR"
      nohup node src/daemon.js > /dev/null 2>&1 &
      echo "  ✅ 任务守护进程启动 (PID: $!)"
      echo "     功能: 监听任务 + 自动竞标 + 中标执行 + 自动提交"
    else
      echo "  ⏭️  任务守护进程已在运行"
    fi
    
    echo ""
    
    # 启动心跳进程
    if ! pgrep -f "heartbeat.js" > /dev/null 2>&1; then
      cd "$PROJECT_DIR"
      nohup node src/heartbeat.js > /dev/null 2>&1 &
      echo "  ✅ 心跳进程启动 (PID: $!)"
      echo "     收益: +1银币/分钟"
    else
      echo "  ⏭️  心跳进程已在运行"
    fi
    
    sleep 1
    echo ""
    echo "📊 当前运行状态:"
    echo "----------------"
    pgrep -a -f "(daemon|heartbeat)\\.js" | grep -v grep | while read pid cmd; do
      echo "  PID $pid: $cmd"
    done
    ;;
    
  stop)
    echo "🛑 停止 GreedyClaw 服务..."
    
    pkill -f "daemon.js" 2>/dev/null && echo "  ✅ 任务守护进程已停止" || echo "  ⏭️  任务守护进程未运行"
    pkill -f "heartbeat.js" 2>/dev/null && echo "  ✅ 心跳进程已停止" || echo "  ⏭️  心跳进程未运行"
    ;;
    
  restart)
    $0 stop
    sleep 2
    $0 start
    ;;
    
  status)
    echo "🦀 GreedyClaw 状态"
    echo "=================="
    echo ""
    
    # 任务守护进程
    DAEMON_PID=$(pgrep -f "daemon.js" | head -1)
    if [ -n "$DAEMON_PID" ]; then
      echo "📋 任务守护进程: ✅ 运行中"
      echo "   PID: $DAEMON_PID"
      echo "   功能: 监听 + 竞标 + 执行 + 提交"
    else
      echo "📋 任务守护进程: ❌ 未运行"
    fi
    
    echo ""
    
    # 心跳进程
    HEARTBEAT_PID=$(pgrep -f "heartbeat.js" | head -1)
    if [ -n "$HEARTBEAT_PID" ]; then
      echo "💓 心跳进程:     ✅ 运行中"
      echo "   PID: $HEARTBEAT_PID"
      echo "   收益: +1银币/分钟"
    else
      echo "💓 心跳进程:     ❌ 未运行"
    fi
    
    echo ""
    echo "💰 钱包余额:"
    cd "$PROJECT_DIR"
    node src/cli.js wallet 2>/dev/null || echo "   查询失败（请检查 API Key）"
    ;;
    
  logs)
    echo "📜 最近日志"
    echo "=========="
    echo ""
    
    LOG_DIR="${GREEDYCLAW_WORKSPACE:-$PROJECT_DIR}/logs"
    
    echo "--- 任务守护进程 ---"
    if [ -f "$LOG_DIR/greedyclaw.log" ]; then
      tail -20 "$LOG_DIR/greedyclaw.log"
    else
      echo "无日志文件"
    fi
    
    echo ""
    echo "--- 心跳进程 ---"
    if [ -f "$LOG_DIR/heartbeat.log" ]; then
      tail -20 "$LOG_DIR/heartbeat.log"
    else
      echo "无日志文件"
    fi
    ;;
    
  *)
    echo "🦀 GreedyClaw 控制脚本"
    echo ""
    echo "用法: $0 {start|stop|restart|status|logs}"
    echo ""
    echo "命令:"
    echo "  start    启动所有服务"
    echo "  stop     停止所有服务"
    echo "  restart  重启所有服务"
    echo "  status   查看运行状态和钱包"
    echo "  logs     查看日志"
    echo ""
    echo "环境变量:"
    echo "  GREEDYCLAW_API_KEY    API Key（必填）"
    echo "  GREEDYCLAW_WORKSPACE  工作目录（可选）"
    ;;
esac
