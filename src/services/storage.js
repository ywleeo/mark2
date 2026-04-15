/**
 * 统一的 localStorage 访问层。
 *
 * 设计目标:
 * 1. 命名空间:所有 key 走 `mark2:<feature>:<name>` 前缀,避免散落的裸 key。
 * 2. JSON 编解码:读写默认走 JSON,读失败回落到 fallback(不抛异常)。
 * 3. 版本号:可选的 schema 版本;读到低版本时调用 migrator 升级,
 *    不提供 migrator 则视为无效、返回 fallback。
 * 4. 老 key 迁移:`migrateFrom` 把历史裸 key 一次性搬进命名空间。
 *
 * 使用:
 *     const store = createStore('terminal', { version: 1 });
 *     store.set('height', 320);
 *     const h = store.get('height', 240);
 *
 *     // 从老 key 迁移(只在新 key 不存在时执行)
 *     store.migrateFrom('mark2_terminal_height', 'height', { parse: Number });
 */

const PREFIX = 'mark2';

function fullKey(feature, name) {
    return `${PREFIX}:${feature}:${name}`;
}

function safeGetItem(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeSetItem(key, value) {
    try {
        window.localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

function safeRemoveItem(key) {
    try {
        window.localStorage.removeItem(key);
    } catch {
        // ignore
    }
}

/**
 * 创建一个命名空间存储。
 * @param {string} feature  业务命名空间,如 'terminal' / 'ai' / 'toolbar'
 * @param {object} [options]
 * @param {number} [options.version]  schema 版本号。设置后数据以 `{v,d}` 信封存储。
 */
export function createStore(feature, options = {}) {
    const version = Number.isInteger(options.version) ? options.version : null;

    function wrap(value) {
        return version == null ? value : { v: version, d: value };
    }

    function unwrap(parsed, migrate) {
        if (version == null) return parsed;
        if (parsed && typeof parsed === 'object' && 'v' in parsed && 'd' in parsed) {
            if (parsed.v === version) return parsed.d;
            if (typeof migrate === 'function') {
                try {
                    return migrate(parsed.d, parsed.v);
                } catch {
                    return undefined;
                }
            }
            return undefined;
        }
        // 没有信封(旧数据),交给 migrate 或视为无效
        if (typeof migrate === 'function') {
            try {
                return migrate(parsed, 0);
            } catch {
                return undefined;
            }
        }
        return undefined;
    }

    return {
        /**
         * 读取 JSON。读失败、解析失败、版本不匹配且未提供 migrate 时返回 fallback。
         * @param {string} name
         * @param {*} [fallback]
         * @param {object} [opts]
         * @param {(data:any, oldVersion:number)=>any} [opts.migrate]
         */
        get(name, fallback = null, opts = {}) {
            const raw = safeGetItem(fullKey(feature, name));
            if (raw == null) return fallback;
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch {
                return fallback;
            }
            const unwrapped = unwrap(parsed, opts.migrate);
            return unwrapped === undefined ? fallback : unwrapped;
        },

        set(name, value) {
            return safeSetItem(fullKey(feature, name), JSON.stringify(wrap(value)));
        },

        remove(name) {
            safeRemoveItem(fullKey(feature, name));
        },

        has(name) {
            return safeGetItem(fullKey(feature, name)) != null;
        },

        /**
         * 返回命名空间 + 版本化后的完整 key(调试/老代码互操作用)。
         */
        fullKey(name) {
            return fullKey(feature, name);
        },

        /**
         * 一次性从老裸 key 搬迁到命名空间。只在新 key 不存在时执行,
         * 迁移后删除老 key。失败安静跳过。
         *
         * @param {string} legacyKey      历史裸 key
         * @param {string} name           新 key(不含前缀)
         * @param {object} [opts]
         * @param {'json'|'raw'|((raw:string)=>any)} [opts.parse='json']
         *        老数据解析方式。'json' 解析 JSON;'raw' 原样字符串;函数自定义。
         */
        migrateFrom(legacyKey, name, opts = {}) {
            const newK = fullKey(feature, name);
            if (safeGetItem(newK) != null) return false;
            const raw = safeGetItem(legacyKey);
            if (raw == null) return false;

            const mode = opts.parse ?? 'json';
            let value;
            try {
                if (mode === 'raw') {
                    value = raw;
                } else if (typeof mode === 'function') {
                    value = mode(raw);
                } else {
                    value = JSON.parse(raw);
                }
            } catch {
                safeRemoveItem(legacyKey);
                return false;
            }

            const ok = safeSetItem(newK, JSON.stringify(wrap(value)));
            if (ok) safeRemoveItem(legacyKey);
            return ok;
        },
    };
}
