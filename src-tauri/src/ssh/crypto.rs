// src-tauri/src/ssh/crypto.rs

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::RngCore;

/// 加密密钥（实际应用中应该从安全存储获取）
fn get_encryption_key() -> [u8; 32] {
    // 使用固定密钥（生产环境应该使用密钥派生）
    let key_str = "dev-toolkit-ssh-encryption-key-32b";
    let mut key = [0u8; 32];
    key[..key_str.len().min(32)].copy_from_slice(&key_str.as_bytes()[..key_str.len().min(32)]);
    key
}

/// 加密密码
pub fn encrypt_password(password: &str) -> Result<String, String> {
    if password.is_empty() {
        return Ok(String::new());
    }

    let key = get_encryption_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("初始化加密器失败: {}", e))?;

    // 生成随机nonce
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // 加密
    let ciphertext = cipher
        .encrypt(nonce, password.as_bytes())
        .map_err(|e| format!("加密失败: {}", e))?;

    // 组合: nonce || ciphertext，然后base64编码
    let mut combined = nonce_bytes.to_vec();
    combined.extend(ciphertext);

    Ok(STANDARD.encode(&combined))
}

/// 解密密码
pub fn decrypt_password(encrypted: &str) -> Result<String, String> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }

    let combined = STANDARD
        .decode(encrypted)
        .map_err(|e| format!("Base64解码失败: {}", e))?;

    if combined.len() < 12 {
        return Err("加密数据格式错误".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let key = get_encryption_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("初始化解密器失败: {}", e))?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("解密失败: {}", e))?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8解码失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let password = "test_password_123";
        let encrypted = encrypt_password(password).unwrap();
        let decrypted = decrypt_password(&encrypted).unwrap();
        assert_eq!(password, decrypted);
    }

    #[test]
    fn test_empty_password() {
        let encrypted = encrypt_password("").unwrap();
        assert!(encrypted.is_empty());
        let decrypted = decrypt_password(&encrypted).unwrap();
        assert!(decrypted.is_empty());
    }
}
