import { invoke } from '@tauri-apps/api/core';

/**
 * @typedef {Object} VaultFieldView
 * @property {string} label
 * @property {string} value      // secret=true 时为空串
 * @property {boolean} secret
 * @property {boolean} hasValue  // 原始 value 是否非空
 *
 * @typedef {Object} VaultEntryView
 * @property {string} id
 * @property {string} name
 * @property {string} kind
 * @property {VaultFieldView[]} fields
 * @property {string[]} tags
 * @property {string} notes
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {number|null} lastUsedAt
 *
 * @typedef {Object} VaultFieldInput
 * @property {string} label
 * @property {string} value
 * @property {boolean} [secret]
 *
 * @typedef {Object} VaultEntryInput
 * @property {string} name
 * @property {string} kind
 * @property {VaultFieldInput[]} fields
 * @property {string[]} [tags]
 * @property {string} [notes]
 *
 * @typedef {Object} GenerateOptions
 * @property {number} [length]
 * @property {boolean} [lowercase]
 * @property {boolean} [uppercase]
 * @property {boolean} [digits]
 * @property {boolean} [symbols]
 */

export async function vaultList() {
    return invoke('vault_list');
}

export async function vaultGetValue(id, label) {
    return invoke('vault_get_value', { id, label });
}

export async function vaultAdd(input) {
    return invoke('vault_add', { input });
}

export async function vaultUpdate(id, input) {
    return invoke('vault_update', { id, input });
}

export async function vaultDelete(id) {
    return invoke('vault_delete', { id });
}

export async function vaultMarkUsed(id) {
    return invoke('vault_mark_used', { id });
}

export async function vaultGeneratePassword(opts) {
    return invoke('vault_generate_password', { opts: opts ?? null });
}

export async function vaultCopyToClipboard(id, label) {
    return invoke('vault_copy_to_clipboard', { id, label });
}
