#!/bin/bash
# English Reader — 本地开发启动脚本 (Linux / Mac)
set -e

cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo ">>> 创建 Python 虚拟环境..."
    python3 -m venv venv
fi

source venv/bin/activate
pip install -r requirements.txt -q

echo ">>> 启动服务 http://127.0.0.1:8000"
uvicorn main:app --reload --port 8000
