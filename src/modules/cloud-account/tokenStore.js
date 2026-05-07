import {
    cloudKeyringDelete,
    cloudKeyringGet,
    cloudKeyringSet,
} from '../../api/cloudKeyring.js';

const ACCOUNT = 'access_token';

export async function loadToken() {
    try {
        return await cloudKeyringGet(ACCOUNT);
    } catch (e) {
        console.warn('[cloud-account] keyring get failed:', e);
        return null;
    }
}

export async function saveToken(token) {
    if (!token) {
        await clearToken();
        return;
    }
    await cloudKeyringSet(ACCOUNT, token);
}

export async function clearToken() {
    try {
        await cloudKeyringDelete(ACCOUNT);
    } catch (e) {
        console.warn('[cloud-account] keyring delete failed:', e);
    }
}
