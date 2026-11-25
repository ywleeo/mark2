//! 按发行渠道生成权限，商店版不包含站外更新能力。
/// 构建期阻止渠道混用，并只加载当前渠道可用的 IPC 权限。
fn main() {
    let mas = std::env::var_os("CARGO_FEATURE_MAS").is_some();
    let github = std::env::var_os("CARGO_FEATURE_GITHUB").is_some();
    assert!(
        mas != github,
        "请选择且仅选择一个渠道 feature：github 或 mas"
    );
    assert!(
        !mas || std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos"),
        "MAS 仅支持 macOS"
    );
    println!("cargo:rerun-if-env-changed=MARK2_DISTRIBUTION");
    if let Ok(channel) = std::env::var("MARK2_DISTRIBUTION") {
        assert_eq!(
            channel,
            if mas { "mas" } else { "github" },
            "前端与 Rust 构建渠道不一致"
        );
    }
    println!("cargo:rerun-if-changed=capabilities");
    let pattern = if mas {
        "capabilities/default.json"
    } else {
        "capabilities/*.json"
    };
    tauri_build::try_build(tauri_build::Attributes::new().capabilities_path_pattern(pattern))
        .expect("生成渠道权限失败");
}
