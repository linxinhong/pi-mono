/**
 * 时间衰减计算
 * 基于指数衰减模型，记忆重要性随时间递减
 */

import { getMemoryConfig } from "./config.js";

/**
 * 记忆条目基础接口
 */
export interface MemoryEntry {
	/** 创建时间戳 (毫秒) */
	createdAt: number;
	/** 最后访问时间戳 (毫秒) */
	lastAccessedAt: number;
	/** 访问次数 */
	accessCount: number;
}

/**
 * 计算时间衰减因子
 * 使用指数衰减公式: decay = e^(-ln(2) * elapsed / halfLife)
 *
 * @param elapsedMs 经过的毫秒数
 * @param halfLifeMs 半衰期（毫秒），默认使用配置中的值
 * @returns 衰减因子 [0, 1]
 */
export function calculateDecayFactor(elapsedMs: number, halfLifeMs?: number): number {
	const config = getMemoryConfig();
	const halfLife = halfLifeMs ?? config.timeDecay.halfLifeMs;
	const minFactor = config.timeDecay.minDecayFactor;

	if (elapsedMs <= 0) {
		return 1.0;
	}

	// 指数衰减: e^(-ln(2) * t / halfLife)
	const decayConstant = Math.LN2 / halfLife;
	const decayFactor = Math.exp(-decayConstant * elapsedMs);

	// 确保不低于最小衰减因子
	return Math.max(decayFactor, minFactor);
}

/**
 * 计算记忆条目的衰减分数
 * 综合考虑创建时间和最后访问时间
 *
 * @param entry 记忆条目
 * @param currentTime 当前时间戳，默认 Date.now()
 * @returns 衰减分数 [0, 1]
 */
export function calculateEntryDecay(entry: MemoryEntry, currentTime: number = Date.now()): number {
	const config = getMemoryConfig();

	// 创建时间衰减
	const ageMs = currentTime - entry.createdAt;
	const ageDecay = calculateDecayFactor(ageMs);

	// 最后访问时间衰减
	const idleMs = currentTime - entry.lastAccessedAt;
	const idleDecay = calculateDecayFactor(idleMs);

	// 访问频率加成：访问次数越多，衰减越慢
	const accessBoost = Math.min(1 + entry.accessCount * 0.1, 2.0);

	// 综合衰减分数：年龄衰减 * 空闲衰减 * 访问加成
	const combinedDecay = (ageDecay * 0.6 + idleDecay * 0.4) * accessBoost;

	// 归一化到 [0, 1]
	return Math.min(combinedDecay, 1.0);
}

/**
 * 时间衰减函数类型
 */
export type DecayFunction = (elapsedMs: number) => number;

/**
 * 创建自定义衰减函数
 *
 * @param halfLifeMs 半衰期
 * @param minFactor 最小衰减因子
 * @returns 衰减函数
 */
export function createDecayFunction(halfLifeMs: number, minFactor: number = 0.1): DecayFunction {
	return (elapsedMs: number) => {
		if (elapsedMs <= 0) return 1.0;
		const decayConstant = Math.LN2 / halfLifeMs;
		return Math.max(Math.exp(-decayConstant * elapsedMs), minFactor);
	};
}

/**
 * 批量计算衰减分数
 *
 * @param entries 记忆条目数组
 * @param currentTime 当前时间戳
 * @returns 衰减分数数组，与输入顺序一致
 */
export function batchCalculateDecay(entries: MemoryEntry[], currentTime: number = Date.now()): number[] {
	return entries.map((entry) => calculateEntryDecay(entry, currentTime));
}

/**
 * 获取衰减等级描述
 *
 * @param decayFactor 衰减因子
 * @returns 等级描述
 */
export function getDecayLevel(decayFactor: number): "fresh" | "recent" | "aging" | "old" | "ancient" {
	if (decayFactor >= 0.8) return "fresh";
	if (decayFactor >= 0.5) return "recent";
	if (decayFactor >= 0.3) return "aging";
	if (decayFactor >= 0.15) return "old";
	return "ancient";
}
