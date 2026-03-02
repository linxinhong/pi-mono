/**
 * LLM 记忆压缩器
 * 使用 LLM 压缩旧记忆，保留关键信息
 */

import { getMemoryConfig } from "./config.js";
import type { MemoryEntry } from "./time-decay.js";

/**
 * 压缩器条目接口
 */
export interface CompressibleEntry extends MemoryEntry {
	/** 条目 ID */
	id: string;
	/** 内容文本 */
	content: string;
	/** 重要性分数 */
	importanceScore: number;
	/** 是否已压缩 */
	isCompressed?: boolean;
	/** 元数据 */
	metadata?: Record<string, unknown>;
}

/**
 * 压缩结果
 */
export interface CompressionResult {
	/** 原始条目数量 */
	originalCount: number;
	/** 压缩后条目数量 */
	compressedCount: number;
	/** 原始 token 估计 */
	originalTokens: number;
	/** 压缩后 token 估计 */
	compressedTokens: number;
	/** 压缩比 */
	compressionRatio: number;
	/** 压缩后的条目 */
	entries: CompressibleEntry[];
}

/**
 * LLM 压缩函数类型
 */
export type LLMCompressFn = (prompt: string) => Promise<string>;

/**
 * 压缩提示词模板
 */
const COMPRESSION_PROMPT = `You are a memory compression assistant. Your task is to summarize and compress multiple memory entries into a concise, unified summary while preserving all important information.

## Input Memory Entries
{{entries}}

## Instructions
1. Combine related information from multiple entries
2. Remove redundancy while preserving key facts
3. Maintain chronological order for events
4. Keep important context like names, dates, and decisions
5. Output a single compressed summary in markdown format

## Compressed Summary`;

/**
 * 估计文本的 token 数量
 * 使用简单的启发式方法：平均每 4 个字符 = 1 token
 *
 * @param text 文本
 * @returns 估计的 token 数
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * 将条目格式化为压缩提示词
 *
 * @param entries 条目列表
 * @returns 格式化的文本
 */
function formatEntriesForCompression(entries: CompressibleEntry[]): string {
	return entries
		.map((entry, index) => {
			const date = new Date(entry.createdAt).toISOString().split("T")[0];
			return `### Entry ${index + 1} (${date})\nImportance: ${entry.importanceScore.toFixed(2)}\n${entry.content}`;
		})
		.join("\n\n");
}

/**
 * 记忆压缩器
 */
export class MemoryCompressor {
	private llmCompressFn: LLMCompressFn | null = null;

	/**
	 * 设置 LLM 压缩函数
	 */
	setLLMCompress(fn: LLMCompressFn): void {
		this.llmCompressFn = fn;
	}

	/**
	 * 压缩记忆条目
	 *
	 * @param entries 要压缩的条目
	 * @param targetTokens 目标 token 数
	 * @returns 压缩结果
	 */
	async compress(entries: CompressibleEntry[], targetTokens?: number): Promise<CompressionResult> {
		const config = getMemoryConfig();
		const target = targetTokens ?? config.compressor.targetTokens;

		// 计算原始 token 数
		const originalTokens = entries.reduce((sum, e) => sum + estimateTokens(e.content), 0);

		// 如果已经足够小，不需要压缩
		if (originalTokens <= target) {
			return {
				originalCount: entries.length,
				compressedCount: entries.length,
				originalTokens,
				compressedTokens: originalTokens,
				compressionRatio: 1.0,
				entries,
			};
		}

		// 按重要性排序，保留最重要的条目
		const sortedEntries = [...entries].sort((a, b) => b.importanceScore - a.importanceScore);

		// 如果没有 LLM 压缩函数，使用简单的截断策略
		if (!this.llmCompressFn) {
			return this.truncateCompression(sortedEntries, target, originalTokens);
		}

		// 使用 LLM 压缩
		return this.llmCompression(sortedEntries, target, originalTokens);
	}

	/**
	 * 截断压缩（无 LLM 时的备选方案）
	 */
	private truncateCompression(
		entries: CompressibleEntry[],
		targetTokens: number,
		originalTokens: number,
	): CompressionResult {
		const config = getMemoryConfig();
		const retained: CompressibleEntry[] = [];
		let currentTokens = 0;

		for (const entry of entries) {
			const entryTokens = estimateTokens(entry.content);
			if (currentTokens + entryTokens <= targetTokens || retained.length < config.compressor.minRetainedEntries) {
				retained.push(entry);
				currentTokens += entryTokens;
			}
		}

		return {
			originalCount: entries.length,
			compressedCount: retained.length,
			originalTokens,
			compressedTokens: currentTokens,
			compressionRatio: currentTokens / originalTokens,
			entries: retained,
		};
	}

	/**
	 * LLM 压缩
	 */
	private async llmCompression(
		entries: CompressibleEntry[],
		targetTokens: number,
		originalTokens: number,
	): Promise<CompressionResult> {
		if (!this.llmCompressFn) {
			throw new Error("LLM compress function not set");
		}

		// 格式化条目
		const formattedEntries = formatEntriesForCompression(entries);
		const prompt = COMPRESSION_PROMPT.replace("{{entries}}", formattedEntries);

		// 调用 LLM 压缩
		const compressedContent = await this.llmCompressFn(prompt);
		const compressedTokens = estimateTokens(compressedContent);

		// 创建压缩后的条目
		const compressedEntry: CompressibleEntry = {
			id: `compressed-${Date.now()}`,
			content: compressedContent,
			createdAt: entries[0]?.createdAt ?? Date.now(),
			lastAccessedAt: Date.now(),
			accessCount: 1,
			importanceScore: Math.max(...entries.map((e) => e.importanceScore)),
			isCompressed: true,
			metadata: {
				originalEntryCount: entries.length,
				compressedAt: Date.now(),
				originalTokens,
			},
		};

		return {
			originalCount: entries.length,
			compressedCount: 1,
			originalTokens,
			compressedTokens,
			compressionRatio: compressedTokens / originalTokens,
			entries: [compressedEntry],
		};
	}

	/**
	 * 检查是否需要压缩
	 *
	 * @param entries 当前条目
	 * @returns 是否需要压缩
	 */
	needsCompression(entries: CompressibleEntry[]): boolean {
		const config = getMemoryConfig();
		const totalTokens = entries.reduce((sum, e) => sum + estimateTokens(e.content), 0);
		return totalTokens > config.compressor.compressionThreshold;
	}
}

/**
 * 创建记忆压缩器实例
 */
export function createMemoryCompressor(): MemoryCompressor {
	return new MemoryCompressor();
}
