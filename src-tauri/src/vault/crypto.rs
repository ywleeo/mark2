// AES-256-GCM 加解密。文件格式：[12B nonce][密文][16B auth tag]

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::RngCore;

const NONCE_LEN: usize = 12;

pub fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|err| format!("vault encrypt failed: {err}"))?;

    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decrypt(key: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>, String> {
    if blob.len() < NONCE_LEN + 16 {
        return Err("vault blob too short".to_string());
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|err| format!("vault decrypt failed: {err}"))
}

pub fn random_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_plain() {
        let key = random_key();
        let plaintext = b"hello vault";
        let blob = encrypt(&key, plaintext).unwrap();
        assert!(blob.len() >= NONCE_LEN + 16 + plaintext.len());
        let got = decrypt(&key, &blob).unwrap();
        assert_eq!(got, plaintext);
    }

    #[test]
    fn nonce_is_random() {
        let key = random_key();
        let a = encrypt(&key, b"x").unwrap();
        let b = encrypt(&key, b"x").unwrap();
        assert_ne!(a, b, "同一明文两次加密应产生不同密文（nonce 随机）");
    }

    #[test]
    fn wrong_key_fails() {
        let k1 = random_key();
        let k2 = random_key();
        let blob = encrypt(&k1, b"secret").unwrap();
        assert!(decrypt(&k2, &blob).is_err());
    }

    #[test]
    fn tamper_fails() {
        let key = random_key();
        let mut blob = encrypt(&key, b"secret").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0xFF;
        assert!(decrypt(&key, &blob).is_err());
    }

    #[test]
    fn short_blob_rejected() {
        let key = random_key();
        assert!(decrypt(&key, &[0u8; 10]).is_err());
    }
}
