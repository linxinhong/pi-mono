/**
 * MMR (Maximal Marginal Relevance) 选择器
 * 在相关性和多样性之间取得平衡
 */

import { getMemoryConfig } from "./config.js";

/**
 * MMR 条目接口
 */
export interface MMREntry {
	/** 条目 ID */
	id: string;
	/** 内容文本 */
	content: string;
	/** 相似度/相关性分数 [0, 1] */
	score: number;
	/** 嵌入向量（可选，用于精确相似度计算） */
	embedding?: number[];
	/** 元数据 */
	metadata?: Record<string, unknown>;
}

/**
 * MMR 结果
 */
export interface MMRResult extends MMREntry {
	/** MMR 分数 */
	mmrScore: number;
}

/**
 * 计算两个向量之间的余弦相似度
 *
 * @param a 向量 A
 * @param b 向量 B
 * @returns 余弦相似度 [-1, 1]
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) {
		throw new Error("Vectors must have the same length");
	}

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	if (normA === 0 || normB === 0) {
		return 0;
	}

	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 计算文本之间的简单相似度（基于词汇重叠）
 * 当嵌入向量不可用时的备选方案
 *
 * @param textA 文本 A
 * @param textB 文本 B
 * @returns 相似度 [0, 1]
 */
export function textSimilarity(textA: string, textB: string): number {
	const tokenize = (text: string): Set<string> => {
		return new Set(
			text
				.toLowerCase()
				.split(/\s+/)
				.filter((t) => t.length > 1),
		);
	};

	const tokensA = tokenize(textA);
	const tokensB = tokenize(textB);

	if (tokensA.size === 0 || tokensB.size === 0) {
		return 0;
	}

	// Jaccard 相似度
	let intersection = 0;
	for (const token of Array.from(tokensA)) {
		if (tokensB.has(token)) {
			intersection++;
		}
	}

	const union = tokensA.size + tokensB.size - intersection;
	return intersection / union;
}

/**
 * 计算 MMR 分数
 *
 * MMR = λ * Sim(q, d) - (1 - λ) * max[Sim(d, d') for d' in S]
 *
 * 其中:
 * - q: 查询
 * - d: 候选文档
 * - S: 已选择的文档集合
 * - λ: 平衡参数
 *
 * @param entry 候选条目
 * @param queryRelevance 与查询的相关性
 * @param selected 已选择的条目
 * @param lambda 平衡参数
 * @returns MMR 分数
 */
export function calculateMMR(
	entry: MMREntry,
	queryRelevance: number,
	selected: MMREntry[],
	lambda: number,
): number {
	// 如果没有已选择的条目，MMR 就是相关性分数
	if (selected.length === 0) {
		return lambda * queryRelevance;
	}

	// 计算与已选择条目的最大相似度
	let maxSimilarity = 0;

	for (const selectedEntry of selected) {
		let similarity: number;

		// 优先使用嵌入向量计算相似度
		if (entry.embedding && selectedEntry.embedding) {
			similarity = cosineSimilarity(entry.embedding, selectedEntry.embedding);
		} else {
			// 回退到文本相似度
			similarity = textSimilarity(entry.content, selectedEntry.content);
		}

		maxSimilarity = Math.max(maxSimilarity, similarity);
	}

	// MMR 公式
	return lambda * queryRelevance - (1 - lambda) * maxSimilarity;
}

/**
 * 使用 MMR 选择多样化的结果
 *
 * @param candidates 候选条目
 * @param topK 要选择的数量
 * @param lambda 平衡参数 (0=最大多样性, 1=最大相关性)
 * @returns MMR 选择结果
 */
export function selectMMR(candidates: MMREntry[], topK: number, lambda?: number): MMRResult[] {
	const config = getMemoryConfig();
	const lambdaValue = lambda ?? config.mmr.lambda;

	if (candidates.length <= topK) {
		return candidates.map((c) => ({ ...c, mmrScore: c.score }));
	}

	const selected: MMRResult[] = [];
	const remaining = [...candidates];

	while (selected.length < topK && remaining.length > 0) {
		let bestIndex = 0;
		let bestMMR = -Infinity;

		// 找到具有最高 MMR 分数的候选
		for (let i = 0; i < remaining.length; i++) {
			const mmr = calculateMMR(remaining[i], remaining[i].score, selected, lambdaValue);

			if (mmr > bestMMR) {
				bestMMR = mmr;
				bestIndex = i;
			}
		}

		// 将最佳候选移到已选择集合
		const best = remaining.splice(bestIndex, 1)[0];
		selected.push({
			...best,
			mmrScore: bestMMR,
		});
	}

	return selected;
}

/**
 * 使用 MMR 从搜索结果中选择多样化结果
 *
 * @param searchResults 搜索结果（已按相关性排序）
 * @param topK 要选择的数量
 * @returns MMR 选择结果
 */
export function selectDiverseResults(
	searchResults: Array<{ id: string; content: string; combinedScore: number; embedding?: number[]; metadata?: Record<string, unknown> }>,
	topK: number,
): MMRResult[] {
	const candidates: MMREntry[] = searchResults.map((r) => ({
		id: r.id,
		content: r.content,
		score: r.combinedScore,
		embedding: r.embedding,
		metadata: r.metadata,
	}));

	return selectMMR(candidates, topK);
}
