export function splitThinkAndAnswer(text, options = {}) {
    if (typeof text !== 'string' || text.length === 0) {
        return { think: '', answer: '' };
    }

    const shouldTrim = options.trim !== false;
    const THINK_START = '<think>';
    const THINK_END = '</think>';
    const startIndex = text.indexOf(THINK_START);
    const endIndex = text.indexOf(THINK_END);

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        const thinkRaw = text.slice(startIndex + THINK_START.length, endIndex);
        const answerRaw = text.slice(endIndex + THINK_END.length);
        return {
            think: shouldTrim ? thinkRaw.trim() : thinkRaw,
            answer: shouldTrim ? answerRaw.trim() : answerRaw,
        };
    }

    return {
        think: '',
        answer: shouldTrim ? text.trim() : text,
    };
}
