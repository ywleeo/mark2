#!/bin/bash
# Finder 双击入口：打开中文菜单，不自动构建、上传或提交审核。
set -euo pipefail

release_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${release_root}"

release_node="$(command -v node || true)"
if [[ -z "${release_node}" ]]; then
    for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
        if [[ -x "${candidate}" ]]; then
            release_node="${candidate}"
            break
        fi
    done
fi
if [[ -z "${release_node}" ]]; then
    echo "请先安装 Node.js 22 或更新版本，再打开发布工具。"
    read -r -p "按回车退出…"
    exit 1
fi
export PATH="${HOME}/.cargo/bin:$(dirname "${release_node}"):/opt/homebrew/bin:/usr/local/bin:${PATH}"
exec "${release_node}" "${release_root}/tools/release/mas.mjs"
