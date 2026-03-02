/**
 * 混合搜索架构
 * 结合向量搜索和关键词搜索的结果
 */

import { getMemoryConfig } from "./config.js";

/**
 * 搜索结果条目
 */
export interface SearchResult {
	/** 条目 ID */
	id: string;
	/** 内容文本 */
	content: string;
	/** 向量相似度分数 [0, 1] */
	vectorScore: number;
	/** 关键词匹配分数 [0, 1] */
	keywordScore: number;
	/** 综合分数 */
	combinedScore: number;
	/** 元数据 */
	metadata?: Record<string, unknown>;
}

/**
 * 向量搜索函数类型
 */
export type VectorSearchFn = (query: string, topK: number) => Promise<Pick<SearchResult, "id" | "content" | "vectorScore" | "metadata">[]>;

/**
 * 关键词搜索函数类型
 */
export type KeywordSearchFn = (query: string, topK: number) => Promise<Pick<SearchResult, "id" | "content" | "keywordScore" | "metadata">[]>;

/**
 * 默认关键词搜索实现 (BM25-like 简化版)
 */
export function simpleKeywordSearch(
	query: string,
	documents: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>,
	topK: number,
): Pick<SearchResult, "id" | "content" | "keywordScore" | "metadata">[] {
	const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);

	const results = documents.map((doc) => {
		const content = doc.content.toLowerCase();
		let score = 0;

		for (const term of queryTerms) {
			// 精确匹配
			const exactMatches = (content.match(new RegExp(term, "g")) || []).length;
			// 部分匹配
			const partialMatches = (content.match(new RegExp(term.slice(0, -1), "g")) || []).length;

			score += exactMatches * 1.0 + partialMatches * 0.3;
		}

		// 归一化分数
		const normalizedScore = Math.min(score / Math.max(queryTerms.length, 1), 1.0);

		return {
			id: doc.id,
			content: doc.content,
			keywordScore: normalizedScore,
			metadata: doc.metadata,
		};
	});

	// 按分数排序并返回 topK
	return results.sort((a, b) => b.keywordScore - a.keywordScore).slice(0, topK);
}

/**
 * 混合搜索引擎
 */
export class HybridSearchEngine {
	private vectorSearchFn: VectorSearchFn | null = null;
	private keywordSearchFn: KeywordSearchFn;
	private documents: Array<{ id: string; content: string; metadata?: Record<string, unknown> }> = [];

	constructor() {
		// 默认使用简单关键词搜索
		this.keywordSearchFn = async (query: string, topK: number) => {
			return simpleKeywordSearch(query, this.documents, topK);
		};
	}

	/**
	 * 设置向量搜索函数
	 */
	setVectorSearch(fn: VectorSearchFn): void {
		this.vectorSearchFn = fn;
	}

	/**
	 * 设置关键词搜索函数
	 */
	setKeywordSearch(fn: KeywordSearchFn): void {
		this.keywordSearchFn = fn;
	}

	/**
	 * 设置文档库（用于默认关键词搜索）
	 */
	setDocuments(documents: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>): void {
		this.documents = documents;
	}

	/**
	 * 执行混合搜索
	 *
	 * @param query 查询字符串
	 * @returns 搜索结果
	 */
	async search(query: string): Promise<SearchResult[]> {
		const config = getMemoryConfig();
		const { vectorWeight, keywordWeight, topK } = config.hybridSearch;

		// 并行执行向量搜索和关键词搜索
		const [vectorResults, keywordResults] = await Promise.all([
			this.vectorSearchFn ? this.vectorSearchFn(query, topK * 2) : Promise.resolve([]),
			this.keywordSearchFn(query, topK * 2),
		]);

		// 合并结果
		const mergedMap = new Map<string, SearchResult>();

		// 添加向量搜索结果
		for (const result of vectorResults) {
			mergedMap.set(result.id, {
				id: result.id,
				content: result.content,
				vectorScore: result.vectorScore,
				keywordScore: 0,
				combinedScore: 0,
				metadata: result.metadata,
			});
		}

		// 合并关键词搜索结果
		for (const result of keywordResults) {
			const existing = mergedMap.get(result.id);
			if (existing) {
				existing.keywordScore = result.keywordScore;
			} else {
				mergedMap.set(result.id, {
					id: result.id,
					content: result.content,
					vectorScore: 0,
					keywordScore: result.keywordScore,
					combinedScore: 0,
					metadata: result.metadata,
				});
			}
		}

		// 计算综合分数
		for (const result of Array.from(mergedMap.values())) {
			result.combinedScore = result.vectorScore * vectorWeight + result.keywordScore * keywordWeight;
		}

		// 排序并返回 topK
		return Array.from(mergedMap.values())
			.sort((a, b) => b.combinedScore - a.combinedScore)
			.slice(0, topK);
	}

	/**
	 * 仅使用关键词搜索
	 */
	async keywordOnlySearch(query: string, topK?: number): Promise<Pick<SearchResult, "id" | "content" | "keywordScore" | "metadata">[]> {
		return this.keywordSearchFn(query, topK ?? getMemoryConfig().hybridSearch.topK);
	}
}

/**
 * 创建混合搜索引擎实例
 */
export function createHybridSearchEngine(): HybridSearchEngine {
	return new HybridSearchEngine();
}
