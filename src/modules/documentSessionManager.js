export function createDocumentSessionManager() {
    let activeSession = null;
    let sessionCounter = 0;
    const LOCAL_WRITE_SUPPRESSION_MS = 800;
    const localWriteSuppressions = new Map();

    const normalizePathKey = (filePath) => {
        if (!filePath) {
            return null;
        }
        if (typeof filePath === 'string') {
            return filePath;
        }
        try {
            return String(filePath);
        } catch (_error) {
            return null;
        }
    };

    const getSuppressionDeadline = (durationMs = LOCAL_WRITE_SUPPRESSION_MS) => {
        const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : LOCAL_WRITE_SUPPRESSION_MS;
        return Date.now() + safeDuration;
    };

    function markLocalWrite(filePath, options = {}) {
        const key = normalizePathKey(filePath);
        if (!key) {
            return;
        }
        const deadline = getSuppressionDeadline(options.suppressWatcherMs);
        localWriteSuppressions.set(key, deadline);
    }

    function clearLocalWriteSuppression(filePath = null) {
        if (!filePath) {
            localWriteSuppressions.clear();
            return;
        }
        const key = normalizePathKey(filePath);
        if (!key) {
            return;
        }
        localWriteSuppressions.delete(key);
    }

    function shouldIgnoreWatcherEvent(filePath) {
        const key = normalizePathKey(filePath);
        if (!key) {
            return false;
        }
        const deadline = localWriteSuppressions.get(key);
        if (!deadline) {
            return false;
        }
        if (deadline >= Date.now()) {
            return true;
        }
        localWriteSuppressions.delete(key);
        return false;
    }

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
            const path = activeSession.filePath;
            activeSession.closed = true;
            activeSession.state = 'closed';
            activeSession = null;
            if (path) {
                clearLocalWriteSuppression(path);
            }
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
            const deadline = localWriteSuppressions.get(oldPath);
            if (deadline) {
                localWriteSuppressions.set(nextPath, deadline);
                localWriteSuppressions.delete(oldPath);
            }
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
        markLocalWrite,
        clearLocalWriteSuppression,
        shouldIgnoreWatcherEvent,
    };
}
