#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

if ! command -v wasm-pack &>/dev/null; then
  echo "[error] wasm-pack not found — install with: cargo install wasm-pack"
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "[error] node not found — install Node.js 18+"
  exit 1
fi

echo "[1/4] building wasm (web target)..."
cd "$ROOT/wasm"
wasm-pack build --target web --out-dir ../server/public/wasm --release

echo "[2/4] building wasm (node target)..."
wasm-pack build --target nodejs --out-dir ../server/wasm-node --release

echo "[3/4] installing npm dependencies..."
cd "$ROOT/server"
npm install

mkdir -p "$ROOT/maps"
mkdir -p "$ROOT/materials"

echo "[4/4] starting server..."
exec node src/index.js