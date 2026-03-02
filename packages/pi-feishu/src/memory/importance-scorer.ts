/**
 * 重要性评分器
 * 综合多种因素计算记忆条目的重要性分数
 */

import { getMemoryConfig } from "./config.js";
import { calculateEntryDecay, type MemoryEntry } from "./time-decay.js";

/**
 * 可评分条目接口
 */
export interface ScorableEntry extends MemoryEntry {
	/** 条目 ID */
	id: string;
	/** 内容文本 */
	content: string;
	/** 用户反馈分数 (点赞、收藏等)，默认 0 */
	feedbackScore?: number;
	/** 内容类型 */
	contentType?: ContentType;
	/** 元数据 */
	metadata?: Record<string, unknown>;
}

/**
 * 内容类型枚举
 */
export enum ContentType {
	/** 事实性信息 */
	FACT = "fact",
	/** 用户偏好 */
	PREFERENCE = "preference",
	/** 任务/待办 */
	TASK = "task",
	/** 对话历史 */
	CONVERSATION = "conversation",
	/** 系统配置 */
	CONFIG = "config",
	/** 其他 */
	OTHER = "other",
}

/**
 * 内容类型权重映射
 */
const CONTENT_TYPE_WEIGHTS: Record<ContentType, number> = {
	[ContentType.FACT]: 0.9, // 事实信息很重要
	[ContentType.PREFERENCE]: 0.85, // 用户偏好也很重要
	[ContentType.TASK]: 0.8, // 任务信息
	[ContentType.CONFIG]: 0.7, // 配置信息
	[ContentType.CONVERSATION]: 0.5, // 普通对话相对不重要
	[ContentType.OTHER]: 0.6, // 默认权重
};

/**
 * 重要性评分结果
 */
export interface ImportanceResult {
	/** 总分 [0, 1] */
	totalScore: number;
	/** 用户反馈分数 */
	feedbackScore: number;
	/** 访问频率分数 */
	accessScore: number;
	/** 内容类型分数 */
	contentTypeScore: number;
	/** 时间衰减分数 */
	decayScore: number;
}

/**
 * 检测内容类型
 * 基于内容特征自动推断
 *
 * @param content 内容文本
 * @returns 检测到的内容类型
 */
export function detectContentType(content: string): ContentType {
	const lowerContent = content.toLowerCase();

	// 检测任务/待办
	if (/(todo|task|待办|任务|remind|提醒|deadline)/.test(lowerContent)) {
		return ContentType.TASK;
	}

	// 检测用户偏好
	if (/(prefer|like|favorite|喜好|偏好|喜欢)/.test(lowerContent)) {
		return ContentType.PREFERENCE;
	}

	// 检测配置
	if (/(config|setting|配置|设置|install|安装)/.test(lowerContent)) {
		return ContentType.CONFIG;
	}

	// 检测事实性信息
	if (/(is|are|was|were|fact|是|有|位于|成立于)/.test(lowerContent)) {
		return ContentType.FACT;
	}

	// 默认为对话
	return ContentType.CONVERSATION;
}

/**
 * 计算用户反馈分数
 *
 * @param feedbackScore 原始反馈分数
 * @returns 归一化的反馈分数 [0, 1]
 */
function calculateFeedbackScore(feedbackScore?: number): number {
	if (feedbackScore === undefined || feedbackScore === null) {
		return 0.5; // 默认中等分数
	}
	// 假设反馈分数在 [-1, 1] 范围，归一化到 [0, 1]
	return Math.max(0, Math.min(1, (feedbackScore + 1) / 2));
}

/**
 * 计算访问频率分数
 * 使用对数缩放避免过度偏向频繁访问
 *
 * @param accessCount 访问次数
 * @returns 访问分数 [0, 1]
 */
function calculateAccessScore(accessCount: number): number {
	if (accessCount <= 0) return 0;
	// 使用对数缩放: log(1 + count) / log(1 + maxExpectedCount)
	// 假设最大预期访问次数为 100
	const maxExpected = 100;
	return Math.log(1 + accessCount) / Math.log(1 + maxExpected);
}

/**
 * 计算内容类型分数
 *
 * @param contentType 内容类型
 * @returns 类型分数 [0, 1]
 */
function calculateContentTypeScore(contentType?: ContentType): number {
	const type = contentType ?? ContentType.OTHER;
	return CONTENT_TYPE_WEIGHTS[type] ?? 0.6;
}

/**
 * 计算综合重要性分数
 *
 * @param entry 可评分条目
 * @param currentTime 当前时间戳
 * @returns 重要性评分结果
 */
export function calculateImportance(entry: ScorableEntry, currentTime: number = Date.now()): ImportanceResult {
	const config = getMemoryConfig();
	const { feedbackWeight, accessWeight, contentTypeWeight, decayWeight } = config.importance;

	// 计算各维度分数
	const feedbackScore = calculateFeedbackScore(entry.feedbackScore);
	const accessScore = calculateAccessScore(entry.accessCount);
	const contentTypeScore = calculateContentTypeScore(entry.contentType);
	const decayScore = calculateEntryDecay(entry, currentTime);

	// 加权求和
	const totalScore =
		feedbackScore * feedbackWeight +
		accessScore * accessWeight +
		contentTypeScore * contentTypeWeight +
		decayScore * decayWeight;

	return {
		totalScore,
		feedbackScore,
		accessScore,
		contentTypeScore,
		decayScore,
	};
}

/**
 * 批量计算重要性分数
 *
 * @param entries 条目列表
 * @param currentTime 当前时间戳
 * @returns 重要性分数数组
 */
export function batchCalculateImportance(
	entries: ScorableEntry[],
	currentTime: number = Date.now(),
): Array<{ id: string; importance: ImportanceResult }> {
	return entries.map((entry) => ({
		id: entry.id,
		importance: calculateImportance(entry, currentTime),
	}));
}

/**
 * 按重要性排序条目
 *
 * @param entries 条目列表
 * @param currentTime 当前时间戳
 * @param order 排序顺序
 * @returns 排序后的条目列表
 */
export function sortByImportance<T extends ScorableEntry>(
	entries: T[],
	currentTime: number = Date.now(),
	order: "desc" | "asc" = "desc",
): T[] {
	const scored = entries.map((entry) => ({
		entry,
		score: calculateImportance(entry, currentTime).totalScore,
	}));

	scored.sort((a, b) => (order === "desc" ? b.score - a.score : a.score - b.score));

	return scored.map((item) => item.entry);
}

/**
 * 过滤低重要性条目
 *
 * @param entries 条目列表
 * @param threshold 重要性阈值
 * @param currentTime 当前时间戳
 * @returns 过滤后的条目列表
 */
export function filterByImportance<T extends ScorableEntry>(
	entries: T[],
	threshold: number,
	currentTime: number = Date.now(),
): T[] {
	return entries.filter((entry) => {
		const score = calculateImportance(entry, currentTime).totalScore;
		return score >= threshold;
	});
}
