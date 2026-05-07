use keyring::Entry;

const SERVICE: &str = "cc.altron.mark2.cloud";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cloud_keyring_set(account: String, secret: String) -> Result<(), String> {
    entry(&account)?
        .set_password(&secret)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cloud_keyring_get(account: String) -> Result<Option<String>, String> {
    match entry(&account)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn cloud_keyring_delete(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
