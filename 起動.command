#!/bin/zsh
set -e
cd -- "${0:A:h}"
if [[ ! -x .venv/bin/python ]]; then
  echo '初回セットアップ: Python環境を作成します。'
  python3 -m venv .venv
fi
if ! .venv/bin/python -c 'import pymupdf, ezdxf, flask' >/dev/null 2>&1; then
  echo '必要なライブラリをインストールします（初回のみインターネット接続が必要です）。'
  .venv/bin/python -m pip install -r requirements.txt
fi
.venv/bin/python run.py
