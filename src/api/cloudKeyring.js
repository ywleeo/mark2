import { invoke } from '@tauri-apps/api/core';

export async function cloudKeyringSet(account, secret) {
    return await invoke('cloud_keyring_set', { account, secret });
}

export async function cloudKeyringGet(account) {
    return await invoke('cloud_keyring_get', { account });
}

export async function cloudKeyringDelete(account) {
    return await invoke('cloud_keyring_delete', { account });
}
