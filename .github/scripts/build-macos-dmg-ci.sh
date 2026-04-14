#!/usr/bin/env bash

set -euo pipefail

# 本脚本用于 GitHub Actions 的 macOS DMG 构建链路。
# 它只包含可公开提交的逻辑：切换 entitlements、构建 app/dmg、公证、staple、复制产物。
# 所有敏感信息（签名身份、API key、team id）都通过 workflow 注入环境变量。

# 输出带时间戳的构建日志，方便在 GitHub Actions 中定位步骤。
log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

# 校验依赖命令是否存在，缺失时尽早失败。
require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Required command '$1' not found in PATH." >&2
        exit 1
    fi
}

# 自动查找签名证书，优先使用 Developer ID Application。
find_signing_identity() {
    local identity_type="$1"
    local pattern="$2"
    security find-identity -v -p "${identity_type}" 2>/dev/null | awk -F\" -v pat="${pattern}" '$0 ~ pat { print $2; exit }'
}

# 在给定目录列表中寻找最新生成的 DMG。
find_latest_dmg() {
    python3 - "$@" <<'PY'
import os
import sys

best = None
for root in sys.argv[1:]:
    if not root or not os.path.isdir(root):
        continue
    for name in os.listdir(root):
        if not name.endswith(".dmg"):
            continue
        path = os.path.join(root, name)
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            continue
        if not best or mtime > best[0]:
            best = (mtime, path)

if best:
    print(best[1])
PY
}

# 对 DMG 做 Gatekeeper 检查；部分场景会返回 Insufficient Context，这里视为非致命。
assess_dmg_with_spctl() {
    local dmg_path="$1"
    local output status
    if output="$(spctl --assess --type open "${dmg_path}" 2>&1)"; then
        return 0
    fi
    status=$?
    if printf '%s\n' "${output}" | grep -q "Insufficient Context"; then
        log "spctl reported 'Insufficient Context' for ${dmg_path}; treating as non-fatal."
        return 0
    fi
    printf '%s\n' "${output}" >&2
    return "${status}"
}

# 根据 target 生成稳定的架构标签，用于产物命名。
resolve_arch_label() {
    local target="$1"
    local prefix="${target%%-*}"
    case "${prefix}" in
        aarch64)
            printf 'arm64\n'
            ;;
        x86_64)
            printf 'x86_64\n'
            ;;
        universal)
            printf 'universal\n'
            ;;
        *)
            printf '%s\n' "${prefix}"
            ;;
    esac
}

# 主流程：构建指定 target 的 signed/notarized DMG。
main() {
    local script_dir repo_root app_name target output_dir
    local tauri_conf dmg_entitlements mas_entitlements dmg_primary_dir dmg_fallback_dir dmg_path
    local app_build_dir app_path dmg_basename dmg_name dmg_ext final_dmg_path arch_label
    local notary_key_path notary_key_id notary_issuer

    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    repo_root="$(cd "${script_dir}/../.." && pwd)"
    cd "${repo_root}"

    app_name="${APP_NAME:-Mark2}"
    target="${TARGET_TRIPLE:-}"
    output_dir="${OUTPUT_DIR:-${repo_root}/artifacts}"

    if [[ -z "${target}" ]]; then
        echo "TARGET_TRIPLE is required." >&2
        exit 1
    fi

    require_cmd npm
    require_cmd python3
    require_cmd xcrun
    require_cmd codesign
    require_cmd spctl
    require_cmd security

    tauri_conf="${repo_root}/src-tauri/tauri.conf.json"
    dmg_entitlements="macos/Mark2-dmg.entitlements"
    mas_entitlements="macos/Mark2.entitlements"

    if [[ -f "${tauri_conf}" ]]; then
        log "Switching entitlements to DMG version"
        sed -i '' "s|\"entitlements\": \"${mas_entitlements}\"|\"entitlements\": \"${dmg_entitlements}\"|" "${tauri_conf}"
        trap 'sed -i "" "s|\"entitlements\": \"'"${dmg_entitlements}"'\"|\"entitlements\": \"'"${mas_entitlements}"'\"|" "'"${tauri_conf}"'"; log "Restored entitlements to MAS version"' EXIT
    fi

    if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
        APPLE_SIGNING_IDENTITY="$(find_signing_identity codesigning 'Developer ID Application')"
        if [[ -z "${APPLE_SIGNING_IDENTITY}" ]]; then
            APPLE_SIGNING_IDENTITY="$(find_signing_identity codesigning 'Apple Distribution')"
            if [[ -n "${APPLE_SIGNING_IDENTITY}" ]]; then
                log "Warning: Using Apple Distribution for DMG. Developer ID Application is preferred."
            fi
        fi
    fi

    if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
        echo "DMG signing identity not found." >&2
        exit 1
    fi

    notary_key_path="${APP_STORE_CONNECT_KEY_PATH:-}"
    notary_key_id="${APP_STORE_CONNECT_API_KEY:-}"
    notary_issuer="${APP_STORE_CONNECT_API_ISSUER:-}"

    if [[ -z "${notary_key_path}" || -z "${notary_key_id}" || -z "${notary_issuer}" ]]; then
        echo "Notarization credentials missing: APP_STORE_CONNECT_KEY_PATH / APP_STORE_CONNECT_API_KEY / APP_STORE_CONNECT_API_ISSUER are required." >&2
        exit 1
    fi

    mkdir -p "${output_dir}"

    log "Building signed Tauri app and DMG for target ${target}"
    export APPLE_SIGNING_IDENTITY
    export TAURI_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY}"
    npm run tauri:build -- --target "${target}" --bundles app,dmg,updater

    app_build_dir="${repo_root}/src-tauri/target/${target}/release/bundle/macos"
    app_path="${app_build_dir}/${app_name}.app"
    if [[ ! -d "${app_path}" ]]; then
        echo "Expected .app bundle not found at ${app_path}" >&2
        exit 1
    fi

    dmg_primary_dir="${repo_root}/src-tauri/target/${target}/release/bundle/dmg"
    dmg_fallback_dir="${repo_root}/src-tauri/target/release/bundle/dmg"
    dmg_path="$(find_latest_dmg "${dmg_primary_dir}" "${dmg_fallback_dir}")"
    if [[ -z "${dmg_path}" || ! -f "${dmg_path}" ]]; then
        echo "Unable to locate generated DMG for target ${target}." >&2
        exit 1
    fi

    arch_label="$(resolve_arch_label "${target}")"
    dmg_basename="$(basename "${dmg_path}")"
    dmg_name="${dmg_basename%.*}"
    dmg_ext="${dmg_basename##*.}"
    final_dmg_path="${output_dir}/${dmg_name}-${arch_label}.${dmg_ext}"
    cp -f "${dmg_path}" "${final_dmg_path}"

    log "Running codesign verification on ${arch_label} app bundle"
    codesign --verify --deep --strict --verbose=2 "${app_path}"

    log "Assessing Gatekeeper for ${arch_label} app bundle"
    spctl --assess --type execute "${app_path}"

    log "Submitting ${arch_label} DMG for notarization"
    xcrun notarytool submit "${final_dmg_path}" --wait \
        --key "${notary_key_path}" \
        --key-id "${notary_key_id}" \
        --issuer "${notary_issuer}"

    log "Stapling notarization ticket for ${arch_label} DMG"
    xcrun stapler staple "${final_dmg_path}"

    log "Validating stapled ${arch_label} DMG"
    xcrun stapler validate "${final_dmg_path}"

    log "Assessing Gatekeeper for stapled ${arch_label} DMG"
    assess_dmg_with_spctl "${final_dmg_path}"

    log "DMG ready: ${final_dmg_path}"
}

main "$@"
