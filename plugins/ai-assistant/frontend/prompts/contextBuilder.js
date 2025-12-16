/**
 * Context Builder - 分析文档类型和写作风格
 */

export class ContextBuilder {
    constructor(documentContent) {
        this.content = documentContent || '';
    }

    /**
     * 检测文档类型
     */
    detectDocumentType() {
        if (!this.content) return 'general';

        const content = this.content.toLowerCase();

        // 基于内容特征判断
        const patterns = {
            novel: [
                /第[一二三四五六七八九十\d]+章/,
                /[""].*?[""].*?(说|道|问|答)/,
                /(他|她|它).*?(想|觉得|心里|暗想)/,
            ],
            marketing: [
                /(购买|优惠|限时|抢购|下单|立即|马上)/,
                /[!！]{2,}/, // 多个感叹号
                /(种草|测评|好物|推荐|必买)/,
                /(下载|使用|选择|注册|特别火|用的人多|很火|超级火)/,
            ],
            academic: [
                /(摘要|关键词|引言|结论|参考文献)/,
                /(研究|分析|实验|数据|结果)/,
                /(因此|综上所述|由此可见)/,
            ],
            business: [
                /(报告|方案|总结|计划|议程)/,
                /(尊敬的|谨此|特此|敬请)/,
                /(附件|抄送|会议纪要)/,
            ]
        };

        // 计算每种类型的匹配分数
        const scores = {};
        for (const [type, regs] of Object.entries(patterns)) {
            scores[type] = regs.filter(reg => reg.test(content)).length;
        }

        // 返回得分最高的类型
        const maxType = Object.entries(scores).reduce((a, b) =>
            b[1] > a[1] ? b : a
        );

        return maxType[1] > 0 ? maxType[0] : 'general';
    }

    /**
     * 分析写作风格
     */
    analyzeStyle() {
        if (!this.content) {
            return this.getDefaultStyle();
        }

        const sentences = this.content.split(/[。！？\n]/).filter(s => s.trim());

        if (sentences.length === 0) {
            return this.getDefaultStyle();
        }

        return {
            person: this.detectPerson(),
            tone: this.detectTone(),
            avgSentenceLength: this.calcAvgSentenceLength(sentences),
            vocabulary: this.detectVocabularyLevel(),
        };
    }

    /**
     * 检测人称
     */
    detectPerson() {
        const firstPerson = (this.content.match(/[我咱俺]/g) || []).length;
        const thirdPerson = (this.content.match(/[他她它]们?/g) || []).length;

        if (firstPerson > thirdPerson * 1.5) return '第一人称';
        if (thirdPerson > firstPerson * 1.5) return '第三人称';
        return '混合人称';
    }

    /**
     * 检测语气
     */
    detectTone() {
        const exclamations = (this.content.match(/[！!]/g) || []).length;
        const questions = (this.content.match(/[？?]/g) || []).length;
        const total = this.content.length;

        if (!total) return '平和';

        const exclamationRatio = exclamations / total;
        const questionRatio = questions / total;

        if (exclamationRatio > 0.01) return '激昂';
        if (questionRatio > 0.01) return '疑问/对话';
        return '平和';
    }

    /**
     * 计算平均句长
     */
    calcAvgSentenceLength(sentences) {
        if (!sentences || sentences.length === 0) return 20;

        const totalLength = sentences.reduce((sum, s) => sum + s.length, 0);
        return Math.round(totalLength / sentences.length);
    }

    /**
     * 检测用词水平
     */
    detectVocabularyLevel() {
        const formalWords = /(因此|故而|鉴于|基于|综上|然而|况且)/;
        const casualWords = /(挺|蛮|特别|超级|有点|好像|可能)/;

        const hasFormal = formalWords.test(this.content);
        const hasCasual = casualWords.test(this.content);

        if (hasFormal && !hasCasual) return '书面语';
        if (hasCasual && !hasFormal) return '口语化';
        return '中性';
    }

    /**
     * 提取选中内容的前后文
     */
    extractSurrounding(selection, beforeChars = 500, afterChars = 300) {
        if (!this.content || !selection) {
            return { before: '', after: '' };
        }

        const selectionStart = this.content.indexOf(selection);
        if (selectionStart === -1) {
            return { before: '', after: '' };
        }

        const beforeStart = Math.max(0, selectionStart - beforeChars);
        const before = this.content.slice(beforeStart, selectionStart).trim();

        const afterEnd = Math.min(
            this.content.length,
            selectionStart + selection.length + afterChars
        );
        const after = this.content.slice(
            selectionStart + selection.length,
            afterEnd
        ).trim();

        return { before, after };
    }

    /**
     * 默认风格
     */
    getDefaultStyle() {
        return {
            person: '混合人称',
            tone: '平和',
            avgSentenceLength: 20,
            vocabulary: '中性',
        };
    }
}
