#!/usr/bin/env bash

set -euo pipefail

# GitHub 发版入口脚本。
# 统一代理 GitHub-only 发版与单平台 workflow 重跑，避免直接记底层脚本名。

usage() {
    cat <<'EOF'
Usage: release-github.sh [options]

GitHub-only release entrypoint:
  --ver VERSION              Create/update a GitHub release for VERSION.
  --tag TAG                  Re-run workflows for an existing release tag.
  --platform VALUE           Optional. all (default), mac, or win.
  -h, --help                 Show this help text.

Examples:
  ./scripts/release-github.sh --ver 1.6.22
  ./scripts/release-github.sh --tag v1.6.22
  ./scripts/release-github.sh --tag v1.6.22 --platform mac
EOF
}

# 统一日志输出，方便本地确认当前走的是哪个发布入口。
log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

VERSION=""
TAG_NAME=""
PLATFORM="all"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --ver)
            VERSION="$2"
            shift 2
            ;;
        --tag)
            TAG_NAME="$2"
            shift 2
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage
            exit 1
            ;;
    esac
done

if [[ -z "${VERSION}" && -z "${TAG_NAME}" ]]; then
    echo "Either --ver or --tag is required." >&2
    usage
    exit 1
fi

if [[ -n "${VERSION}" && -n "${TAG_NAME}" ]]; then
    echo "--ver and --tag cannot be used together." >&2
    exit 1
fi

case "${PLATFORM}" in
    all|mac|win)
        ;;
    *)
        echo "Unsupported --platform value: ${PLATFORM}" >&2
        exit 1
        ;;
esac

cd "${REPO_ROOT}"

if [[ -n "${VERSION}" ]]; then
    case "${PLATFORM}" in
        all)
            log "Running GitHub-only release for version ${VERSION}"
            bash "${SCRIPT_DIR}/trigger-github-builds.sh" --ver "${VERSION}"
            ;;
        mac)
            log "Running GitHub-only release for version ${VERSION}, then only re-triggering macOS workflow is not supported in one step."
            log "Creating release first, then use --tag with --platform mac if needed."
            bash "${SCRIPT_DIR}/trigger-github-builds.sh" --ver "${VERSION}"
            ;;
        win)
            log "Running GitHub-only release for version ${VERSION}, then only re-triggering Windows workflow is not supported in one step."
            log "Creating release first, then use --tag with --platform win if needed."
            bash "${SCRIPT_DIR}/trigger-github-builds.sh" --ver "${VERSION}"
            ;;
    esac
    exit 0
fi

case "${PLATFORM}" in
    all)
        log "Re-triggering all GitHub workflows for ${TAG_NAME}"
        bash "${SCRIPT_DIR}/trigger-github-builds.sh" --tag "${TAG_NAME}"
        ;;
    mac)
        log "Re-triggering macOS workflow for ${TAG_NAME}"
        bash "${SCRIPT_DIR}/trigger-single-workflow.sh" --workflow mac --tag "${TAG_NAME}"
        ;;
    win)
        log "Re-triggering Windows workflow for ${TAG_NAME}"
        bash "${SCRIPT_DIR}/trigger-single-workflow.sh" --workflow win --tag "${TAG_NAME}"
        ;;
esac
