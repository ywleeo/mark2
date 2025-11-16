export function createDocumentSessionManager() {
    let activeSession = null;
    let sessionCounter = 0;

    function beginSession(filePath) {
        const id = ++sessionCounter;
        if (activeSession && !activeSession.closed) {
            activeSession.closed = true;
            activeSession.state = 'closed';
        }
        const session = {
            id,
            filePath,
            state: 'loading',
            closed: false,
            createdAt: Date.now(),
        };
        activeSession = session;
        return session;
    }

    function getActiveSession() {
        return activeSession && !activeSession.closed ? activeSession : null;
    }

    function isSessionActive(sessionId) {
        if (!sessionId || !activeSession || activeSession.closed) {
            return false;
        }
        return activeSession.id === sessionId;
    }

    function markSessionReady(sessionId) {
        if (isSessionActive(sessionId)) {
            activeSession.state = 'ready';
        }
    }

    function closeSession(sessionId) {
        if (!sessionId) {
            return;
        }
        if (activeSession && activeSession.id === sessionId) {
            activeSession.closed = true;
            activeSession.state = 'closed';
            activeSession = null;
        }
    }

    function closeActiveSession() {
        if (activeSession && !activeSession.closed) {
            closeSession(activeSession.id);
        }
    }

    function closeSessionForPath(filePath) {
        if (!filePath || !activeSession || activeSession.closed) {
            return;
        }
        if (activeSession.filePath === filePath) {
            closeSession(activeSession.id);
        }
    }

    function updateSessionPath(oldPath, nextPath) {
        if (!oldPath || !nextPath || !activeSession || activeSession.closed) {
            return;
        }
        if (activeSession.filePath === oldPath) {
            activeSession.filePath = nextPath;
        }
    }

    return {
        beginSession,
        getActiveSession,
        isSessionActive,
        markSessionReady,
        closeSession,
        closeActiveSession,
        closeSessionForPath,
        updateSessionPath,
    };
}
