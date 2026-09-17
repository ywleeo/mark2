/**
 * 把一行搜索结果裁成包含命中的短片段。
 * 后端位置按 Unicode 字符计数，因此这里使用 Array.from 而不是 UTF-16 下标。
 * @param {Object} match - 后端返回的匹配项。
 * @param {number} contextCharacters - 命中前后最多保留的字符数。
 * @returns {{before: string, hit: string, after: string, leading: boolean, trailing: boolean}}
 */
export function createSearchSnippet(match, contextCharacters = 72) {
    const characters = Array.from(match?.lineText || '');
    const start = Math.max(0, Math.min(Number(match?.matchStart) || 0, characters.length));
    const end = Math.max(start, Math.min(Number(match?.matchEnd) || start, characters.length));
    const sliceStart = Math.max(0, start - contextCharacters);
    const sliceEnd = Math.min(characters.length, end + contextCharacters);
    return {
        before: characters.slice(sliceStart, start).join(''),
        hit: characters.slice(start, end).join(''),
        after: characters.slice(end, sliceEnd).join(''),
        leading: sliceStart > 0,
        trailing: sliceEnd < characters.length,
    };
}

/**
 * 从后端的 Unicode 字符区间中还原精确命中文本。
 * @param {Object} match - 后端返回的匹配项。
 * @returns {string} 实际命中的文本。
 */
export function getWorkspaceSearchMatchText(match) {
    const characters = Array.from(match?.lineText || '');
    const start = Math.max(0, Math.min(Number(match?.matchStart) || 0, characters.length));
    const end = Math.max(start, Math.min(Number(match?.matchEnd) || start, characters.length));
    return characters.slice(start, end).join('');
}
