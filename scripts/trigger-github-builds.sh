#!/usr/bin/env bash

set -euo pipefail

# 本脚本用于执行 GitHub-only 发版：
# 1. 更新版本号文件
# 2. 自动提交、打 tag、push
# 3. 创建或复用 GitHub Release
# 4. 依赖 release.published 自动触发 Windows 和 macOS 打包
# 5. 只有显式传入 --tag 时，才手动 workflow_dispatch 重跑

usage() {
    cat <<'EOF'
Usage: trigger-github-builds.sh [options]

GitHub-only release flow:
  - sync version files
  - commit and tag
  - push branch/tag
  - create GitHub release
  - release event triggers build-windows.yml
  - release event triggers build-macos-dmg.yml

Options:
  --ver VERSION   Perform a GitHub-only release for VERSION
  --tag TAG       Re-trigger workflows for an existing release tag (e.g. v1.6.19)
  -h, --help      Show this help text
EOF
}

# 统一日志输出，方便在本地确认 GitHub-only 发版过程。
log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

# 校验依赖命令是否存在。
require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Required command '$1' not found in PATH." >&2
        exit 1
    fi
}

# 读取 package.json 当前版本。
get_package_version() {
    node -p "require('./package.json').version"
}

# 校验 GitHub CLI 登录状态。
ensure_gh_auth() {
    gh auth status >/dev/null
}

# 更新 package.json 版本。
update_package_version() {
    local version="$1"
    python3 - "${REPO_ROOT}/package.json" "${version}" <<'PY'
import json
import sys
path = sys.argv[1]
version = sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)
data['version'] = version
with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(f"Updated {path} version to {version}")
PY
}

# 更新 tauri.conf.json 版本。
update_tauri_version() {
    local version="$1"
    python3 - "${REPO_ROOT}/src-tauri/tauri.conf.json" "${version}" <<'PY'
import json
import sys
path = sys.argv[1]
version = sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)
data['version'] = version
with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(f"Updated {path} version to {version}")
PY
}

# 更新 Cargo.toml 版本。
update_cargo_version() {
    local version="$1"
    sed -i '' "s/^version = \".*\"/version = \"${version}\"/" "${REPO_ROOT}/src-tauri/Cargo.toml"
    log "Updated ${REPO_ROOT}/src-tauri/Cargo.toml version to ${version}"
    # 同步 Cargo.lock，确保版本号一致
    (cd "${REPO_ROOT}/src-tauri" && cargo update --workspace)
    log "Updated Cargo.lock"
}

# 更新 macOS Info.plist 版本，保持仓库版本源一致。
update_info_plist_version() {
    local version="$1"
    /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${version}" "${REPO_ROOT}/src-tauri/macos/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${version}" "${REPO_ROOT}/src-tauri/macos/Info.plist"
    log "Updated ${REPO_ROOT}/src-tauri/macos/Info.plist version to ${version}"
}

# 校验三个核心版本文件和目标版本一致。
validate_version_files() {
    local expected_version="$1"
    python3 - "${REPO_ROOT}" "${expected_version}" <<'PY'
import json
import re
import sys
from pathlib import Path

repo_root = Path(sys.argv[1])
expected = sys.argv[2]

with (repo_root / "package.json").open("r", encoding="utf-8") as f:
    package_version = json.load(f)["version"]
with (repo_root / "src-tauri" / "tauri.conf.json").open("r", encoding="utf-8") as f:
    tauri_version = json.load(f)["version"]
cargo_text = (repo_root / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8")
match = re.search(r'^version = "([^"]+)"', cargo_text, re.MULTILINE)
if not match:
    raise SystemExit("Unable to read Cargo.toml version")
cargo_version = match.group(1)

versions = {
    "package.json": package_version,
    "tauri.conf.json": tauri_version,
    "Cargo.toml": cargo_version,
}
bad = {name: value for name, value in versions.items() if value != expected}
if bad:
    for name, value in bad.items():
        print(f"{name} version is {value}, expected {expected}", file=sys.stderr)
    raise SystemExit(1)
PY
}

# GitHub-only 发版时阻止未跟踪文件混入正式版本。
ensure_no_untracked_release_files() {
    local status_output file
    status_output="$(git -C "${REPO_ROOT}" status --porcelain)"
    if [[ -z "${status_output}" ]]; then
        return 0
    fi

    while IFS= read -r line; do
        [[ -z "${line}" ]] && continue
        if [[ "${line:0:2}" == "??" ]]; then
            file="${line:3}"
            echo "GitHub release aborted because untracked files exist: ${file}" >&2
            echo "Please add or remove untracked files before running release:github." >&2
            return 1
        fi
    done <<< "${status_output}"
}

# 提交、打 tag 并推送到远端，保证 GitHub workflow 基于正确 tag 构建。
sync_github_release_ref() {
    local version="$1"
    local tag_name="v${version}"
    local branch_name head_sha tag_sha

    ensure_no_untracked_release_files
    validate_version_files "${version}"

    branch_name="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD)"
    if [[ "${branch_name}" == "HEAD" ]]; then
        echo "GitHub release sync requires a named branch, not detached HEAD." >&2
        return 1
    fi

    git -C "${REPO_ROOT}" add -u
    if ! git -C "${REPO_ROOT}" diff --cached --quiet; then
        log "Creating GitHub release commit for version ${version}"
        git -C "${REPO_ROOT}" commit -m "v${version}"
    else
        log "Tracked changes already committed for ${version}"
    fi

    head_sha="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
    if git -C "${REPO_ROOT}" rev-parse -q --verify "refs/tags/${tag_name}" >/dev/null 2>&1; then
        tag_sha="$(git -C "${REPO_ROOT}" rev-list -n 1 "${tag_name}")"
        if [[ "${tag_sha}" != "${head_sha}" ]]; then
            echo "Tag ${tag_name} already exists but does not point to HEAD (${head_sha})." >&2
            return 1
        fi
        log "GitHub release tag ${tag_name} already points to HEAD"
    else
        log "Creating GitHub release tag ${tag_name}"
        git -C "${REPO_ROOT}" tag -a "${tag_name}" -m "${tag_name}"
    fi

    log "Pushing branch ${branch_name} to origin"
    git -C "${REPO_ROOT}" push origin "${branch_name}"
    log "Pushing tag ${tag_name} to origin"
    git -C "${REPO_ROOT}" push origin "${tag_name}"
}

# 确保 GitHub Release 存在，便于 workflow 上传产物。
ensure_release_exists() {
    local tag_name="$1"
    local version="${tag_name#v}"
    if gh release view "${tag_name}" >/dev/null 2>&1; then
        log "GitHub release ${tag_name} already exists"
        return 0
    fi

    log "Creating GitHub release ${tag_name}"
    gh release create "${tag_name}" --title "Mark2 ${version}" --notes "Automated GitHub release for ${tag_name}."
}

# 手动重跑两个 GitHub workflow。
# 这里故意固定使用最新 main 作为 workflow ref，
# 避免旧 tag 里的 workflow 配置把历史 runner 问题一并带回来。
trigger_build_workflows() {
    local tag_name="$1"
    local workflow_ref="main"

    log "Triggering build-windows.yml for ${tag_name} using workflow ref ${workflow_ref}"
    gh workflow run build-windows.yml --ref "${workflow_ref}" -f tag="${tag_name}"

    log "Triggering build-macos-dmg.yml for ${tag_name} using workflow ref ${workflow_ref}"
    gh workflow run build-macos-dmg.yml --ref "${workflow_ref}" -f tag="${tag_name}"

    log "Triggered GitHub builds for ${tag_name} using workflow ref ${workflow_ref}"
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

require_cmd gh
require_cmd git
require_cmd node
require_cmd python3

TAG_NAME=""
VERSION=""
EXPLICIT_TAG=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --ver)
            VERSION="$2"
            TAG_NAME="v$2"
            shift 2
            ;;
        --tag)
            TAG_NAME="$2"
            EXPLICIT_TAG=1
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

if [[ -z "${TAG_NAME}" ]]; then
    VERSION="$(get_package_version)"
    TAG_NAME="v${VERSION}"
fi

ensure_gh_auth

if [[ "${EXPLICIT_TAG}" -eq 0 ]]; then
    if [[ -z "${VERSION}" ]]; then
        VERSION="${TAG_NAME#v}"
    fi
    log "Preparing GitHub-only release ${TAG_NAME}"
    update_package_version "${VERSION}"
    update_tauri_version "${VERSION}"
    update_cargo_version "${VERSION}"
    update_info_plist_version "${VERSION}"
    sync_github_release_ref "${VERSION}"
    ensure_release_exists "${TAG_NAME}"
    log "Created/updated GitHub release ${TAG_NAME}; release workflows will start automatically"
else
    if ! git ls-remote --exit-code --tags origin "refs/tags/${TAG_NAME}" >/dev/null 2>&1; then
        echo "Remote tag ${TAG_NAME} not found. Create/push it first or use --ver VERSION." >&2
        exit 1
    fi
    ensure_release_exists "${TAG_NAME}"
    trigger_build_workflows "${TAG_NAME}"
fi
