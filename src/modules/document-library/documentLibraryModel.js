/** 文档侧栏的数据投影：长期历史与当前未命名文档合并，支持搜索和未保存状态。 */
import { basename, dirname, getPathIdentityKey } from '../../utils/pathUtils.js';

/** 合并文档目录与工作区状态；关闭的临时文档不会从历史重新出现。 */
export function buildDocumentLibraryEntries({ records = [], openDocuments = [], activePath = null, titles = new Map(), query = '' }) {
    const openByPath = new Map(openDocuments.map(doc => [getPathIdentityKey(doc.path), doc]));
    const entries = records.map(record => {
        const doc = openByPath.get(getPathIdentityKey(record.path));
        return { ...record, label: titles.get(record.path) || record.title || basename(record.path), filename: basename(record.path),
            location: dirname(record.path), temporary: false, dirty: Boolean(doc?.dirty) };
    });
    for (const doc of openDocuments) {
        if (!doc.path?.startsWith('untitled://')) continue;
        entries.push({ path: doc.path, label: titles.get(doc.path) || doc.label || basename(doc.path), filename: doc.label || basename(doc.path),
            location: '', temporary: true, dirty: Boolean(doc.dirty) });
    }
    const needle = query.trim().toLocaleLowerCase();
    return entries
        .map(entry => ({ ...entry, active: getPathIdentityKey(entry.path) === getPathIdentityKey(activePath) }))
        .filter(entry => !needle || `${entry.label}\n${entry.filename}\n${entry.location}`.toLocaleLowerCase().includes(needle));
}
