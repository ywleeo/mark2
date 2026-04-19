// 从 macOS Keychain 读写 vault 主密钥。非 macOS 返回错误。

use super::crypto::random_key;

const SERVICE: &str = "cc.altron.mark2.vault";
const ACCOUNT: &str = "master-key";

#[cfg(target_os = "macos")]
pub fn get_or_create_master_key() -> Result<[u8; 32], String> {
    use security_framework::passwords::{get_generic_password, set_generic_password};

    match get_generic_password(SERVICE, ACCOUNT) {
        Ok(data) => {
            if data.len() != 32 {
                return Err(format!(
                    "keychain master key length invalid: {}",
                    data.len()
                ));
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&data);
            Ok(key)
        }
        Err(_) => {
            let key = random_key();
            set_generic_password(SERVICE, ACCOUNT, &key)
                .map_err(|err| format!("keychain write failed: {err}"))?;
            Ok(key)
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn get_or_create_master_key() -> Result<[u8; 32], String> {
    Err("vault 仅在 macOS 支持".to_string())
}
