/**
 * 记忆系统模块入口
 * 统一导出所有记忆相关功能
 */

// 配置
export {
	type MemoryConfig,
	type TimeDecayConfig,
	type MMRConfig,
	type ImportanceScorerConfig,
	type CompressorConfig,
	type HybridSearchConfig,
	DEFAULT_MEMORY_CONFIG,
	getMemoryConfig,
	setMemoryConfig,
	resetMemoryConfig,
} from "./config.js";

// 时间衰减
export {
	type MemoryEntry,
	type DecayFunction,
	calculateDecayFactor,
	calculateEntryDecay,
	createDecayFunction,
	batchCalculateDecay,
	getDecayLevel,
} from "./time-decay.js";

// 混合搜索
export {
	type SearchResult,
	type VectorSearchFn,
	type KeywordSearchFn,
	HybridSearchEngine,
	simpleKeywordSearch,
	createHybridSearchEngine,
} from "./hybrid-search.js";

// MMR
export {
	type MMREntry,
	type MMRResult,
	cosineSimilarity,
	textSimilarity,
	calculateMMR,
	selectMMR,
	selectDiverseResults,
} from "./mmr.js";

// 压缩器
export {
	type CompressibleEntry,
	type CompressionResult,
	type LLMCompressFn,
	MemoryCompressor,
	estimateTokens,
	createMemoryCompressor,
} from "./compressor.js";

// 重要性评分
export {
	type ScorableEntry,
	type ImportanceResult,
	ContentType,
	detectContentType,
	calculateImportance,
	batchCalculateImportance,
	sortByImportance,
	filterByImportance,
} from "./importance-scorer.js";

// 嵌入
export {
	type EmbeddingProvider,
	NullEmbeddingProvider,
	HashEmbeddingProvider,
	OpenAIEmbeddingProvider,
	getEmbeddingProvider,
	setEmbeddingProvider,
	embedText,
	embedTexts,
} from "./embeddings.js";
