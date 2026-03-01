import { existsSync } from "node:fs";
import { basename, extname } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { SpeechRecognizer } from "../speech.js";

// 支持的音频格式
const SUPPORTED_FORMATS = [".opus", ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".webm", ".aac"];

const transcribeSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're transcribing (shown to user)" }),
	path: Type.String({ description: "Path to the audio file to transcribe" }),
	language: Type.Optional(Type.String({ description: "Language code (e.g., 'zh', 'en'). Defaults to 'zh'" })),
});

// 单例 SpeechRecognizer
let speechRecognizer: SpeechRecognizer | null = null;

function getSpeechRecognizer(): SpeechRecognizer {
	if (!speechRecognizer) {
		speechRecognizer = new SpeechRecognizer();
	}
	return speechRecognizer;
}

/**
 * 检查文件格式是否支持
 */
function isSupportedFormat(filePath: string): boolean {
	const ext = extname(filePath).toLowerCase();
	return SUPPORTED_FORMATS.includes(ext);
}

export const transcribeTool: AgentTool<typeof transcribeSchema> = {
	name: "transcribe",
	label: "transcribe",
	description: `Transcribe an audio file to text using speech recognition. Supports formats: ${SUPPORTED_FORMATS.join(", ")}. Returns the transcribed text content.`,
	parameters: transcribeSchema,
	execute: async (
		_toolCallId: string,
		{ path, language }: { label: string; path: string; language?: string },
		signal?: AbortSignal,
	) => {
		if (signal?.aborted) {
			throw new Error("Operation aborted");
		}

		// 检查文件是否存在
		if (!existsSync(path)) {
			throw new Error(`Audio file not found: ${path}`);
		}

		// 检查文件格式
		if (!isSupportedFormat(path)) {
			const ext = extname(path);
			throw new Error(`Unsupported audio format: ${ext}. Supported formats: ${SUPPORTED_FORMATS.join(", ")}`);
		}

		const recognizer = getSpeechRecognizer();
		const fileName = basename(path);

		try {
			const transcript = await recognizer.recognize(path);

			if (!transcript) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No speech detected in audio file: ${fileName}`,
						},
					],
					details: undefined,
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: transcript,
					},
				],
				details: {
					fileName,
					language: language || "zh",
					format: extname(path).toLowerCase(),
				},
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to transcribe audio file ${fileName}: ${errorMessage}`);
		}
	},
};
