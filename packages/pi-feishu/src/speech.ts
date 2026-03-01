import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import OpenAI from "openai";
import { homedir } from "os";
import { join } from "path";
import * as log from "./log.js";

/**
 * 阿里云 Qwen-ASR 语音识别服务（文件转写方式）
 * 文档：https://help.aliyun.com/zh/model-studio/developer-reference/qwen-asr
 */

interface ModelsConfig {
	providers?: {
		bailian?: {
			apiKey?: string;
		};
		aliyun?: {
			apiKey?: string;
			baseUrl?: string;
		};
	};
}

export class SpeechRecognizer {
	private apiKey: string;
	private baseUrl: string;

	constructor() {
		const config = this.getConfig();
		this.apiKey = config.apiKey;
		this.baseUrl = config.baseUrl;
		if (!this.apiKey) {
			log.logWarning(
				"No API key found for speech recognition (set DASHSCOPE_API_KEY/ALIYUN_API_KEY or configure aliyun/bailian in models.json)",
			);
		}
	}

	/**
	 * 获取配置
	 * 优先级：环境变量 > ~/.pi/agent/models.json 中的 aliyun provider > bailian provider
	 */
	private getConfig(): { apiKey: string; baseUrl: string } {
		// 1. 优先使用环境变量 DASHSCOPE_API_KEY
		const envKey = process.env.DASHSCOPE_API_KEY;
		if (envKey) {
			log.logInfo("[ASR] Using API key from DASHSCOPE_API_KEY environment variable");
			return {
				apiKey: envKey,
				baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			};
		}

		// 2. 使用环境变量 ALIYUN_API_KEY
		const aliyunEnvKey = process.env.ALIYUN_API_KEY;
		if (aliyunEnvKey) {
			log.logInfo("[ASR] Using API key from ALIYUN_API_KEY environment variable");
			return {
				apiKey: aliyunEnvKey,
				baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			};
		}

		// 3. 从 models.json 读取配置
		try {
			const modelsPath = join(homedir(), ".pi", "agent", "models.json");
			if (existsSync(modelsPath)) {
				const content = readFileSync(modelsPath, "utf-8");
				const config = JSON.parse(content) as ModelsConfig;

				// 优先使用 aliyun provider
				const aliyunConfig = config?.providers?.aliyun;
				if (aliyunConfig?.apiKey) {
					log.logInfo("[ASR] Using API key from models.json (aliyun provider)");
					return {
						apiKey: aliyunConfig.apiKey,
						baseUrl: aliyunConfig.baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1",
					};
				}

				// 回退到 bailian provider
				const bailianKey = config?.providers?.bailian?.apiKey;
				if (bailianKey) {
					log.logInfo("[ASR] Using API key from models.json (bailian provider)");
					return {
						apiKey: bailianKey,
						baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
					};
				}
			}
		} catch (error) {
			log.logWarning("[ASR] Failed to read models.json", error instanceof Error ? error.message : String(error));
		}

		return { apiKey: "", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" };
	}

	/**
	 * 将 OPUS 音频转换为 PCM 格式
	 * 需要 ffmpeg 安装在系统中
	 */
	private convertToPcm(opusPath: string, pcmPath: string): boolean {
		try {
			// 检查 ffmpeg 是否可用
			execSync("which ffmpeg", { stdio: "ignore" });

			// 转换为 PCM: 16kHz, 16bit, mono
			execSync(`ffmpeg -y -i "${opusPath}" -f s16le -acodec pcm_s16le -ar 16000 -ac 1 "${pcmPath}"`, {
				stdio: "ignore",
			});

			return existsSync(pcmPath);
		} catch (error) {
			log.logWarning("Failed to convert audio to PCM", error instanceof Error ? error.message : String(error));
			return false;
		}
	}

	/**
	 * 将音频文件编码为 base64
	 */
	private encodeToBase64(filePath: string): string {
		const buffer = readFileSync(filePath);
		return buffer.toString("base64");
	}

	/**
	 * 调用阿里云 Qwen-ASR API 识别语音（文件转写方式）
	 */
	async recognize(opusFilePath: string): Promise<string | null> {
		if (!this.apiKey) {
			log.logWarning("No API key configured, skipping speech recognition");
			return null;
		}

		// 生成 PCM 文件路径
		const pcmPath = opusFilePath.replace(/\.[^.]+$/, ".pcm");

		// 转换为 PCM
		if (!this.convertToPcm(opusFilePath, pcmPath)) {
			log.logWarning("Failed to convert audio to PCM format");
			return null;
		}

		try {
			// 将 PCM 文件转换为 WAV 格式（阿里云 ASR 需要 WAV 格式）
			const wavPath = opusFilePath.replace(/\.[^.]+$/, ".wav");
			execSync(`ffmpeg -y -f s16le -ar 16000 -ac 1 -i "${pcmPath}" -ar 16000 -ac 1 "${wavPath}"`, {
				stdio: "ignore",
			});

			if (!existsSync(wavPath)) {
				log.logWarning("Failed to create WAV file");
				return null;
			}

			// 使用 OpenAI 兼容 API 调用
			const client = new OpenAI({
				apiKey: this.apiKey,
				baseURL: this.baseUrl,
			});

			// 将音频文件编码为 base64
			const audioDataBase64 = this.encodeToBase64(wavPath);

			log.logInfo("[ASR] Sending audio to Qwen-ASR for transcription...");

			// 调用 ASR API
			const completion = await client.chat.completions.create({
				model: "qwen3-asr-flash",
				messages: [
					{
						role: "user",
						content: [
							{
								type: "input_audio",
								input_audio: {
									data: `data:audio/wav;base64,${audioDataBase64}`,
								},
							} as any,
						],
					},
				] as any,
				extra_body: {
					asr_options: {
						language: "zh",
						enable_itn: false,
					},
				},
			} as any);

			const transcript = completion.choices[0].message.content || "";

			if (transcript) {
				log.logInfo(`[ASR] Transcription result: ${transcript}`);
			} else {
				log.logWarning("[ASR] No transcription result");
			}

			return transcript || null;
		} catch (error) {
			log.logWarning("[ASR] Failed to transcribe audio", error instanceof Error ? error.message : String(error));
			return null;
		}
	}
}
