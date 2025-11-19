export const conf = {
    wordPattern: /(-?\d*\.\d\w*)|([^\s,\"]+)/g,
    comments: {
        lineComment: '#',
    },
    brackets: [],
    autoClosingPairs: [
        { open: '"', close: '"', notIn: ['string'] },
    ],
};

export const language = {
    defaultToken: '',
    tokenPostfix: '.csv',

    tokenizer: {
        root: [
            // 引号包裹的字段（支持内部的逗号和换行）
            [/"(?:[^"\\]|\\.)*"/, 'string.quoted'],
            // 逗号分隔符
            [/,/, 'delimiter.csv'],
            // 注释（可选）
            [/#.*$/, 'comment'],
            // 日期格式
            [/\d{4}-\d{2}-\d{2}/, 'constant.numeric.date'],
            // 数字（整数和浮点数）
            [/-?\d+\.\d+/, 'constant.numeric.float'],
            [/-?\d+/, 'constant.numeric.integer'],
            // 普通文本
            [/[^,\n\r"]+/, 'identifier'],
        ],
    },
};

// CSV 的颜色主题定制
export const themeRules = [
    { token: 'delimiter.csv', foreground: '6A737D', fontStyle: 'bold' },
    { token: 'string.quoted', foreground: '032F62' },
    { token: 'constant.numeric.date', foreground: '005CC5' },
    { token: 'constant.numeric.float', foreground: '005CC5' },
    { token: 'constant.numeric.integer', foreground: '005CC5' },
    { token: 'identifier', foreground: '24292E' },
];
