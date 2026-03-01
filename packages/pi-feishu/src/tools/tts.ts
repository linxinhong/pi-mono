import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import * as log from "../log.js";

/**
 * TTS (Text-to-Speech) Tool
 * Uses Alibaba Qwen3-TTS API to convert text to speech
 * API Docs: https://help.aliyun.com/zh/model-studio/developer-reference/qwen-tts
 */

const TTS_API_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const TTS_MODEL = "qwen3-tts-instruct-flash";

interface TTSConfig {
	tts?: {
		defaultVoice?: string;
	};
}

interface ModelsConfig {
	providers?: {
		dashscope?: {
			apiKey?: string;
		};
		bailian?: {
			apiKey?: string;
		};
		aliyun?: {
			apiKey?: string;
			baseUrl?: string;
		};
	};
}

const ttsSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're converting (shown to user)" }),
	text: Type.String({ description: "The text to convert to speech (max 60 seconds)" }),
	voice: Type.Optional(Type.String({ description: "Voice name (default: from config or Cherry)" })),
});

// Scratch directory for saving generated audio files
let scratchDir = "/workspace/scratch";

// Callback to automatically send voice after generating audio
let sendVoiceCallback: ((audioPath: string) => Promise<string>) | null = null;

export function setTtsScratchDir(dir: string): void {
	scratchDir = dir;
}

export function setSendVoiceCallback(fn: (audioPath: string) => Promise<string>): void {
	sendVoiceCallback = fn;
}

/**
 * Get API key for TTS service
 * Priority: env vars > models.json
 */
function getApiKey(): string | null {
	// 1. Try DASHSCOPE_API_KEY env var
	const envKey = process.env.DASHSCOPE_API_KEY;
	if (envKey) {
		return envKey;
	}

	// 2. Try ALIYUN_API_KEY env var
	const aliyunEnvKey = process.env.ALIYUN_API_KEY;
	if (aliyunEnvKey) {
		return aliyunEnvKey;
	}

	// 3. Try models.json
	try {
		const modelsPath = join(homedir(), ".pi", "agent", "models.json");
		if (existsSync(modelsPath)) {
			const content = readFileSync(modelsPath, "utf-8");
			const config = JSON.parse(content) as ModelsConfig;

			// Try dashscope provider first
			const dashscopeKey = config?.providers?.dashscope?.apiKey;
			if (dashscopeKey) {
				return dashscopeKey;
			}

			// Fallback to aliyun provider
			const aliyunKey = config?.providers?.aliyun?.apiKey;
			if (aliyunKey) {
				return aliyunKey;
			}

			// Fallback to bailian provider
			const bailianKey = config?.providers?.bailian?.apiKey;
			if (bailianKey) {
				return bailianKey;
			}
		}
	} catch (error) {
		log.logWarning("[TTS] Failed to read models.json", error instanceof Error ? error.message : String(error));
	}

	return null;
}

/**
 * Get default voice from feishu.json config
 */
function getDefaultVoice(): string {
	try {
		const configPath = join(homedir(), ".pi", "feishu", "feishu.json");
		if (existsSync(configPath)) {
			const content = readFileSync(configPath, "utf-8");
			const config = JSON.parse(content) as TTSConfig;
			return config?.tts?.defaultVoice || "Cherry";
		}
	} catch (error) {
		log.logWarning("[TTS] Failed to read feishu.json", error instanceof Error ? error.message : String(error));
	}
	return "Cherry";
}

/**
 * Ensure scratch directory exists
 */
function ensureScratchDir(): void {
	try {
		if (!existsSync(scratchDir)) {
			mkdirSync(scratchDir, { recursive: true });
		}
	} catch (error) {
		log.logWarning(
			"[TTS] Failed to create scratch directory",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export const ttsTool: AgentTool<typeof ttsSchema> = {
	name: "tts",
	label: "tts",
	description:
		"Convert text to speech and send as voice message. This is the ONLY way to generate voice messages. NEVER use bash/edge-tts/espeak/pip - ALWAYS use this tool. The voice message is sent automatically.",
	parameters: ttsSchema,
	execute: async (
		_toolCallId: string,
		{ text, voice }: { label: string; text: string; voice?: string },
		signal?: AbortSignal,
	) => {
		if (signal?.aborted) {
			throw new Error("Operation aborted");
		}

		const apiKey = getApiKey();
		if (!apiKey) {
			throw new Error("No API key found for TTS. Set DASHSCOPE_API_KEY or configure models.json");
		}

		const selectedVoice = voice || getDefaultVoice();
		log.logInfo(`[TTS] Converting text to speech with voice: ${selectedVoice}`);

		// Call TTS API
		const response = await fetch(TTS_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: TTS_MODEL,
				input: {
					text: text,
				},
				parameters: {
					voice: selectedVoice,
					format: "wav",
					instructions: "语速正常，自然流畅",
					optimize_instructions: true,
				},
			}),
			signal,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`TTS API error (${response.status}): ${errorText}`);
		}

		const result = (await response.json()) as {
			output?: {
				audio?: string | { url: string };
			};
			message?: string;
		};

		// Extract audio from response (can be URL or base64)
		const audioData = result?.output?.audio;
		if (!audioData) {
			throw new Error(`TTS API returned no audio: ${result?.message || "Unknown error"}`);
		}

		// Determine if audio is a URL object or base64 string
		const audioUrl = typeof audioData === "string" ? null : audioData.url;
		const audioBase64 = typeof audioData === "string" ? audioData : null;

		// Prepare file path
		ensureScratchDir();
		const timestamp = Date.now();
		const audioPath = join(scratchDir, `tts_${timestamp}.wav`);

		let audioBuffer: Buffer;

		if (audioUrl) {
			// Download from URL
			log.logInfo(`[TTS] Downloading audio from URL: ${audioUrl}`);
			const audioResponse = await fetch(audioUrl, { signal });
			if (!audioResponse.ok) {
				throw new Error(`Failed to download audio: ${audioResponse.status}`);
			}
			audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
		} else if (audioBase64) {
			// Decode base64
			audioBuffer = Buffer.from(audioBase64, "base64");
		} else {
			throw new Error("TTS API returned audio in unexpected format");
		}

		writeFileSync(audioPath, audioBuffer);

		log.logInfo(`[TTS] Audio saved to: ${audioPath} (${audioBuffer.length} bytes)`);

		// Auto-send voice message if callback is configured
		if (sendVoiceCallback) {
			const messageId = await sendVoiceCallback(audioPath);
			log.logInfo(`[TTS] Voice message sent, messageId: ${messageId}`);
			return {
				content: [{ type: "text" as const, text: `Sent voice message` }],
				details: { messageId, path: audioPath, size: audioBuffer.length, voice: selectedVoice },
			};
		}

		return {
			content: [{ type: "text" as const, text: `Generated audio: ${audioPath}` }],
			details: { path: audioPath, size: audioBuffer.length, voice: selectedVoice },
		};
	},
};
