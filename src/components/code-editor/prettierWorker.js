/**
 * Prettier Web Worker
 * 在独立线程中执行代码格式化，避免阻塞主线程
 */

import { format } from 'prettier/standalone';
import prettierBabel from 'prettier/plugins/babel';
import prettierEstree from 'prettier/plugins/estree';
import prettierTypescript from 'prettier/plugins/typescript';
import prettierPostcss from 'prettier/plugins/postcss';
import prettierHtml from 'prettier/plugins/html';
import prettierMarkdown from 'prettier/plugins/markdown';
import prettierYaml from 'prettier/plugins/yaml';
import prettierGraphql from 'prettier/plugins/graphql';

// parser → 所需插件
const PARSER_PLUGINS = {
    babel: [prettierBabel, prettierEstree],
    typescript: [prettierTypescript, prettierEstree],
    json: [prettierBabel, prettierEstree],
    css: [prettierPostcss],
    scss: [prettierPostcss],
    less: [prettierPostcss],
    html: [prettierHtml, prettierPostcss, prettierBabel, prettierEstree],
    markdown: [prettierMarkdown],
    yaml: [prettierYaml],
    graphql: [prettierGraphql],
};

self.onmessage = async (e) => {
    const { id, code, parser, options } = e.data;
    try {
        const plugins = PARSER_PLUGINS[parser];
        if (!plugins) {
            self.postMessage({ id, result: code });
            return;
        }
        const result = await format(code, {
            parser,
            plugins,
            tabWidth: 2,
            singleQuote: true,
            trailingComma: 'es5',
            printWidth: 100,
            ...options,
        });
        self.postMessage({ id, result });
    } catch (error) {
        self.postMessage({ id, error: error.message });
    }
};
