/**
 * 嵌入向量接口
 * 提供文本嵌入向量生成的抽象接口
 */

/**
 * 嵌入向量生成器接口
 */
export interface EmbeddingProvider {
	/**
	 * 生成单个文本的嵌入向量
	 *
	 * @param text 输入文本
	 * @returns 嵌入向量
	 */
	embed(text: string): Promise<number[]>;

	/**
	 * 批量生成嵌入向量
	 *
	 * @param texts 输入文本列表
	 * @returns 嵌入向量列表
	 */
	embedBatch(texts: string[]): Promise<number[][]>;

	/**
	 * 获取嵌入向量的维度
	 */
	getDimension(): number;

	/**
	 * 获取提供者名称
	 */
	getName(): string;
}

/**
 * 空实现（占位）
 * 当没有配置嵌入提供者时使用
 */
export class NullEmbeddingProvider implements EmbeddingProvider {
	private dimension: number;

	constructor(dimension: number = 1536) {
		this.dimension = dimension;
	}

	async embed(_text: string): Promise<number[]> {
		// 返回零向量
		return new Array(this.dimension).fill(0);
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		return texts.map(() => new Array(this.dimension).fill(0));
	}

	getDimension(): number {
		return this.dimension;
	}

	getName(): string {
		return "null";
	}
}

/**
 * 简单哈希嵌入（占位实现）
 * 基于文本哈希生成伪嵌入向量，仅用于测试
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
	private dimension: number;

	constructor(dimension: number = 1536) {
		this.dimension = dimension;
	}

	async embed(text: string): Promise<number[]> {
		return this.hashToVector(text);
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		return texts.map((text) => this.hashToVector(text));
	}

	getDimension(): number {
		return this.dimension;
	}

	getName(): string {
		return "hash";
	}

	/**
	 * 将文本哈希为向量
	 * 注意：这不是真正的嵌入，仅用于测试目的
	 */
	private hashToVector(text: string): number[] {
		const vector = new Array(this.dimension).fill(0);

		// 简单的字符哈希
		for (let i = 0; i < text.length; i++) {
			const charCode = text.charCodeAt(i);
			const idx = i % this.dimension;
			vector[idx] = (vector[idx] + charCode) / 255;
		}

		// 归一化
		const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
		if (norm > 0) {
			for (let i = 0; i < vector.length; i++) {
				vector[i] /= norm;
			}
		}

		return vector;
	}
}

/**
 * OpenAI 嵌入提供者（示例实现）
 * 需要配置 OpenAI API Key
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
	private apiKey: string;
	private model: string;
	private dimension: number;

	constructor(apiKey: string, model: string = "text-embedding-3-small") {
		this.apiKey = apiKey;
		this.model = model;
		// text-embedding-3-small: 1536 维
		// text-embedding-3-large: 3072 维
		this.dimension = model.includes("large") ? 3072 : 1536;
	}

	async embed(text: string): Promise<number[]> {
		const response = await fetch("https://api.openai.com/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				input: text,
				model: this.model,
			}),
		});

		if (!response.ok) {
			throw new Error(`OpenAI API error: ${response.status}`);
		}

		const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
		return data.data[0].embedding;
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		const response = await fetch("https://api.openai.com/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				input: texts,
				model: this.model,
			}),
		});

		if (!response.ok) {
			throw new Error(`OpenAI API error: ${response.status}`);
		}

		const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
		return data.data.map((item) => item.embedding);
	}

	getDimension(): number {
		return this.dimension;
	}

	getName(): string {
		return `openai:${this.model}`;
	}
}

/**
 * 全局嵌入提供者实例
 */
let globalProvider: EmbeddingProvider = new NullEmbeddingProvider();

/**
 * 获取全局嵌入提供者
 */
export function getEmbeddingProvider(): EmbeddingProvider {
	return globalProvider;
}

/**
 * 设置全局嵌入提供者
 */
export function setEmbeddingProvider(provider: EmbeddingProvider): void {
	globalProvider = provider;
}

/**
 * 便捷函数：生成单个文本的嵌入向量
 */
export async function embedText(text: string): Promise<number[]> {
	return globalProvider.embed(text);
}

/**
 * 便捷函数：批量生成嵌入向量
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
	return globalProvider.embedBatch(texts);
}
