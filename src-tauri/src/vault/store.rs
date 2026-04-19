// vault 数据模型 + 文件读写（加密落盘）

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::crypto::{decrypt, encrypt};

pub const CURRENT_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VaultField {
    pub label: String,
    pub value: String,
    pub secret: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub fields: Vec<VaultField>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub last_used_at: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VaultData {
    pub version: u32,
    pub entries: Vec<VaultEntry>,
}

impl Default for VaultData {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            entries: Vec::new(),
        }
    }
}

pub fn load(path: &Path, key: &[u8; 32]) -> Result<VaultData, String> {
    if !path.exists() {
        return Ok(VaultData::default());
    }
    let blob = fs::read(path).map_err(|err| format!("vault read failed: {err}"))?;
    if blob.is_empty() {
        return Ok(VaultData::default());
    }
    let plaintext = decrypt(key, &blob)?;
    let data: VaultData = serde_json::from_slice(&plaintext)
        .map_err(|err| format!("vault parse failed: {err}"))?;
    Ok(data)
}

pub fn save(path: &Path, key: &[u8; 32], data: &VaultData) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("vault mkdir failed: {err}"))?;
    }
    let plaintext = serde_json::to_vec(data)
        .map_err(|err| format!("vault serialize failed: {err}"))?;
    let blob = encrypt(key, &plaintext)?;

    // 原子写：先写 .tmp 再 rename
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, &blob).map_err(|err| format!("vault write failed: {err}"))?;
    fs::rename(&tmp_path, path).map_err(|err| format!("vault rename failed: {err}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::crypto::random_key;
    use std::env;

    fn tmp_path(name: &str) -> std::path::PathBuf {
        let mut p = env::temp_dir();
        p.push(format!(
            "mark2-vault-test-{}-{}.bin",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        p
    }

    fn sample_entry() -> VaultEntry {
        VaultEntry {
            id: "id-1".into(),
            name: "OpenAI".into(),
            kind: "api-key".into(),
            fields: vec![VaultField {
                label: "Key".into(),
                value: "sk-test-xxx".into(),
                secret: true,
            }],
            tags: vec!["ai".into()],
            notes: "".into(),
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            last_used_at: None,
        }
    }

    #[test]
    fn load_missing_returns_default() {
        let key = random_key();
        let p = tmp_path("missing");
        let data = load(&p, &key).unwrap();
        assert_eq!(data.version, CURRENT_VERSION);
        assert!(data.entries.is_empty());
    }

    #[test]
    fn save_then_load_roundtrip() {
        let key = random_key();
        let p = tmp_path("roundtrip");
        let data = VaultData {
            version: CURRENT_VERSION,
            entries: vec![sample_entry()],
        };
        save(&p, &key, &data).unwrap();
        assert!(p.exists());

        let got = load(&p, &key).unwrap();
        assert_eq!(got.entries.len(), 1);
        assert_eq!(got.entries[0].id, "id-1");
        assert_eq!(got.entries[0].fields[0].value, "sk-test-xxx");
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn file_on_disk_is_encrypted() {
        let key = random_key();
        let p = tmp_path("encrypted");
        let data = VaultData {
            version: CURRENT_VERSION,
            entries: vec![sample_entry()],
        };
        save(&p, &key, &data).unwrap();
        let raw = fs::read(&p).unwrap();
        // 明文 "sk-test-xxx" 不应出现在磁盘字节中
        let needle = b"sk-test-xxx";
        assert!(
            raw.windows(needle.len()).all(|w| w != needle),
            "密文里不应能搜到明文"
        );
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn wrong_key_cannot_load() {
        let key = random_key();
        let other = random_key();
        let p = tmp_path("wrongkey");
        let data = VaultData {
            version: CURRENT_VERSION,
            entries: vec![sample_entry()],
        };
        save(&p, &key, &data).unwrap();
        assert!(load(&p, &other).is_err());
        let _ = fs::remove_file(&p);
    }
}
