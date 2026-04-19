// 密码生成器：长度 + 字符集可选

use rand::seq::SliceRandom;
use rand::Rng;
use serde::Deserialize;

const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const UPPER: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &[u8] = b"0123456789";
const SYMBOLS: &[u8] = b"!@#$%^&*()-_=+[]{};:,.<>?/";

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GenerateOptions {
    #[serde(default = "default_length")]
    pub length: usize,
    #[serde(default = "t")]
    pub lowercase: bool,
    #[serde(default = "t")]
    pub uppercase: bool,
    #[serde(default = "t")]
    pub digits: bool,
    #[serde(default)]
    pub symbols: bool,
}

fn default_length() -> usize {
    20
}
fn t() -> bool {
    true
}

impl Default for GenerateOptions {
    fn default() -> Self {
        Self {
            length: default_length(),
            lowercase: true,
            uppercase: true,
            digits: true,
            symbols: false,
        }
    }
}

pub fn generate(opts: &GenerateOptions) -> Result<String, String> {
    let length = opts.length.clamp(4, 128);

    let mut buckets: Vec<&[u8]> = Vec::new();
    if opts.lowercase {
        buckets.push(LOWER);
    }
    if opts.uppercase {
        buckets.push(UPPER);
    }
    if opts.digits {
        buckets.push(DIGITS);
    }
    if opts.symbols {
        buckets.push(SYMBOLS);
    }
    if buckets.is_empty() {
        return Err("至少选择一种字符类型".to_string());
    }

    let mut rng = rand::thread_rng();
    let mut out: Vec<u8> = Vec::with_capacity(length);

    // 每种选中的字符集至少来一个，保证多样性
    for bucket in &buckets {
        let idx = rng.gen_range(0..bucket.len());
        out.push(bucket[idx]);
    }

    // 合并所有字符集作为剩余位的取样池
    let pool: Vec<u8> = buckets.iter().flat_map(|b| b.iter().copied()).collect();
    while out.len() < length {
        let idx = rng.gen_range(0..pool.len());
        out.push(pool[idx]);
    }

    // 打乱顺序，避免前几位固定来自每个字符集
    out.shuffle(&mut rng);

    String::from_utf8(out).map_err(|err| format!("generator utf8 failed: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_length_twenty() {
        let pw = generate(&GenerateOptions::default()).unwrap();
        assert_eq!(pw.len(), 20);
    }

    #[test]
    fn respects_length() {
        let opts = GenerateOptions {
            length: 32,
            ..Default::default()
        };
        let pw = generate(&opts).unwrap();
        assert_eq!(pw.len(), 32);
    }

    #[test]
    fn clamps_short_length() {
        let opts = GenerateOptions {
            length: 1,
            ..Default::default()
        };
        let pw = generate(&opts).unwrap();
        assert!(pw.len() >= 4);
    }

    #[test]
    fn no_charset_fails() {
        let opts = GenerateOptions {
            length: 12,
            lowercase: false,
            uppercase: false,
            digits: false,
            symbols: false,
        };
        assert!(generate(&opts).is_err());
    }

    #[test]
    fn only_digits() {
        let opts = GenerateOptions {
            length: 16,
            lowercase: false,
            uppercase: false,
            digits: true,
            symbols: false,
        };
        let pw = generate(&opts).unwrap();
        assert!(pw.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn includes_each_selected_charset() {
        let opts = GenerateOptions {
            length: 64,
            lowercase: true,
            uppercase: true,
            digits: true,
            symbols: true,
        };
        // 多跑几次避免偶发
        for _ in 0..20 {
            let pw = generate(&opts).unwrap();
            assert!(pw.chars().any(|c| c.is_ascii_lowercase()));
            assert!(pw.chars().any(|c| c.is_ascii_uppercase()));
            assert!(pw.chars().any(|c| c.is_ascii_digit()));
            assert!(pw.chars().any(|c| !c.is_ascii_alphanumeric()));
        }
    }

    #[test]
    fn two_generations_differ() {
        let opts = GenerateOptions::default();
        let a = generate(&opts).unwrap();
        let b = generate(&opts).unwrap();
        assert_ne!(a, b);
    }
}
