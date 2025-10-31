/**
 * Parse streaming chunk payload and extract answer/reasoning deltas.
 * @param {string} data - Raw JSON string from SSE stream (after `data: `)
 * @returns {{ answerDelta: string, reasoningDelta: string }}
 */
export function parseStreamData(data) {
    const parsed = JSON.parse(data);
    const choiceDelta = parsed.choices?.[0]?.delta || {};

    const { answerDelta, reasoningDelta } = extractDelta(choiceDelta);
    return { answerDelta, reasoningDelta };
}

function extractDelta(choiceDelta) {
    let answerDelta = '';
    let reasoningDelta = '';

    const contentNode = choiceDelta.content;
    if (Array.isArray(contentNode)) {
        contentNode.forEach((part) => {
            const text = part?.text ?? part?.content ?? '';
            if (!text) return;
            const type = part?.type || '';
            if (type.includes('reason') || type === 'thinking') {
                reasoningDelta += text;
            } else {
                answerDelta += text;
            }
        });
    } else if (typeof contentNode === 'string') {
        answerDelta = contentNode;
    } else if (contentNode?.text) {
        answerDelta = contentNode.text;
    }

    const reasoningNode = choiceDelta.reasoning;
    if (Array.isArray(reasoningNode)) {
        reasoningNode.forEach((part) => {
            if (typeof part?.text === 'string') {
                reasoningDelta += part.text;
            }
        });
    } else if (typeof reasoningNode?.text === 'string') {
        reasoningDelta += reasoningNode.text;
    }

    if (typeof choiceDelta.reasoning_content === 'string') {
        reasoningDelta += choiceDelta.reasoning_content;
    } else if (Array.isArray(choiceDelta.reasoning_content)) {
        choiceDelta.reasoning_content.forEach((part) => {
            if (typeof part === 'string') {
                reasoningDelta += part;
            } else if (part && typeof part.text === 'string') {
                reasoningDelta += part.text;
            }
        });
    }

    return { answerDelta, reasoningDelta };
}
