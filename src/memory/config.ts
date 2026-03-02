/**
 * 记忆系统配置
 */

/**
 * 时间衰减配置
 */
export interface TimeDecayConfig {
	/** 半衰期（毫秒）- 记忆重要性减半所需时间，默认 7 天 */
	halfLifeMs: number;
	/** 最小衰减因子 - 即使很旧的记忆也保留的最小权重，默认 0.1 */
	minDecayFactor: number;
}

/**
 * MMR 配置
 */
export interface MMRConfig {
	/** Lambda 参数 - 平衡相关性 vs 多样性，0=最大多样性，1=最大相关性，默认 0.7 */
	lambda: number;
	/** 候选池大小 - 从初始检索中选择 K 个候选，默认 20 */
	candidatePoolSize: number;
}

/**
 * 重要性评分配置
 */
export interface ImportanceScorerConfig {
	/** 用户反馈权重，默认 0.3 */
	feedbackWeight: number;
	/** 访问频率权重，默认 0.2 */
	accessWeight: number;
	/** 内容类型权重，默认 0.2 */
	contentTypeWeight: number;
	/** 时间衰减权重，默认 0.3 */
	decayWeight: number;
}

/**
 * 压缩器配置
 */
export interface CompressorConfig {
	/** 触发压缩的 token 阈值，默认 4000 */
	compressionThreshold: number;
	/** 压缩后目标 token 数，默认 1000 */
	targetTokens: number;
	/** 最小保留条目数，默认 10 */
	minRetainedEntries: number;
}

/**
 * 混合搜索配置
 */
export interface HybridSearchConfig {
	/** 向量搜索权重，默认 0.6 */
	vectorWeight: number;
	/** 关键词搜索权重，默认 0.4 */
	keywordWeight: number;
	/** 返回结果数量，默认 10 */
	topK: number;
}

/**
 * 记忆系统完整配置
 */
export interface MemoryConfig {
	/** 时间衰减配置 */
	timeDecay: TimeDecayConfig;
	/** MMR 配置 */
	mmr: MMRConfig;
	/** 重要性评分配置 */
	importance: ImportanceScorerConfig;
	/** 压缩器配置 */
	compressor: CompressorConfig;
	/** 混合搜索配置 */
	hybridSearch: HybridSearchConfig;
	/** 是否启用记忆压缩 */
	enableCompression: boolean;
	/** 是否启用 MMR 多样性选择 */
	enableMMR: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
	timeDecay: {
		halfLifeMs: 7 * 24 * 60 * 60 * 1000, // 7 天
		minDecayFactor: 0.1,
	},
	mmr: {
		lambda: 0.7,
		candidatePoolSize: 20,
	},
	importance: {
		feedbackWeight: 0.3,
		accessWeight: 0.2,
		contentTypeWeight: 0.2,
		decayWeight: 0.3,
	},
	compressor: {
		compressionThreshold: 4000,
		targetTokens: 1000,
		minRetainedEntries: 10,
	},
	hybridSearch: {
		vectorWeight: 0.6,
		keywordWeight: 0.4,
		topK: 10,
	},
	enableCompression: true,
	enableMMR: true,
};

/**
 * 全局配置实例
 */
let globalConfig: MemoryConfig = { ...DEFAULT_MEMORY_CONFIG };

/**
 * 获取当前配置
 */
export function getMemoryConfig(): MemoryConfig {
	return globalConfig;
}

/**
 * 设置配置
 */
export function setMemoryConfig(config: Partial<MemoryConfig>): void {
	globalConfig = {
		...globalConfig,
		...config,
		timeDecay: { ...globalConfig.timeDecay, ...config.timeDecay },
		mmr: { ...globalConfig.mmr, ...config.mmr },
		importance: { ...globalConfig.importance, ...config.importance },
		compressor: { ...globalConfig.compressor, ...config.compressor },
		hybridSearch: { ...globalConfig.hybridSearch, ...config.hybridSearch },
	};
}

/**
 * 重置为默认配置
 */
export function resetMemoryConfig(): void {
	globalConfig = { ...DEFAULT_MEMORY_CONFIG };
}
