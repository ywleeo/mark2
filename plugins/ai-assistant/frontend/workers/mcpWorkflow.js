export async function executeMcpWorkflow({
    toolAgent,
    prompt,
    history = [],
    documentContext = null,
    workspaceContext = null,
    force = false,
}) {
    if (!toolAgent || typeof toolAgent.run !== 'function') {
        throw new Error('MCP tool agent 不可用');
    }

    try {
        const result = await toolAgent.run({
            prompt,
            history,
            documentContext,
            workspaceContext,
        });

        if (!result?.success) {
            return { handled: false };
        }

        if (!result.usedTools && !force) {
            return { handled: false };
        }

        return {
            handled: true,
            finalAnswer: result.finalAnswer || '',
            calls: result.calls || [],
        };
    } catch (error) {
        console.warn('[mcpWorkflow] 执行失败', error);
        return { handled: false, error };
    }
}
