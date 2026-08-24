// 使用操作系统凭据存储读写 Vault 主密钥，避免把明文密钥和数据放在同一目录。

use super::crypto::random_key;

const SERVICE: &str = "cc.altron.mark2.vault";
const ACCOUNT: &str = "master-key";

#[cfg(target_os = "macos")]
/// 从 macOS Keychain 读取主密钥；首次使用时创建并持久化。
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

#[cfg(target_os = "windows")]
/// 把 Rust 字符串转换为 Windows API 使用的 UTF-16 空字符结尾字符串。
fn to_wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(target_os = "windows")]
/// 从 Windows Credential Manager 读取主密钥；不存在时创建本机持久凭据。
pub fn get_or_create_master_key() -> Result<[u8; 32], String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
    use windows_sys::Win32::Security::Credentials::{
        CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let mut target = to_wide(SERVICE);
    let mut credential_ptr: *mut CREDENTIALW = ptr::null_mut();
    let read_ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential_ptr) };

    if read_ok != 0 {
        let result = unsafe {
            if credential_ptr.is_null() {
                Err("credential manager returned an empty credential".to_string())
            } else {
                let credential = &*credential_ptr;
                if credential.CredentialBlobSize != 32 || credential.CredentialBlob.is_null() {
                    Err(format!(
                        "credential manager master key length invalid: {}",
                        credential.CredentialBlobSize
                    ))
                } else {
                    let bytes = std::slice::from_raw_parts(credential.CredentialBlob, 32);
                    let mut key = [0u8; 32];
                    key.copy_from_slice(bytes);
                    Ok(key)
                }
            }
        };
        if !credential_ptr.is_null() {
            unsafe { CredFree(credential_ptr.cast()) };
        }
        return result;
    }

    let read_error = unsafe { GetLastError() };
    if read_error != ERROR_NOT_FOUND {
        return Err(format!(
            "credential manager read failed with error code {read_error}"
        ));
    }

    let key = random_key();
    let mut account = to_wide(ACCOUNT);
    let mut credential: CREDENTIALW = unsafe { std::mem::zeroed() };
    credential.Type = CRED_TYPE_GENERIC;
    credential.TargetName = target.as_mut_ptr();
    credential.CredentialBlobSize = key.len() as u32;
    credential.CredentialBlob = key.as_ptr() as *mut u8;
    credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
    credential.UserName = account.as_mut_ptr();

    let write_ok = unsafe { CredWriteW(&credential, 0) };
    if write_ok == 0 {
        let write_error = unsafe { GetLastError() };
        return Err(format!(
            "credential manager write failed with error code {write_error}"
        ));
    }

    Ok(key)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
/// 在尚未接入系统凭据存储的平台上明确拒绝启用 Vault。
pub fn get_or_create_master_key() -> Result<[u8; 32], String> {
    Err("vault 当前仅支持 macOS 和 Windows".to_string())
}
