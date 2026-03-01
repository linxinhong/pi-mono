import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import WebSocket from "ws";
import * as log from "./log.js";

/**
 * 阿里云 Qwen-ASR 语音识别服务
 * 文档: https://help.aliyun.com/zh/model-studio/developer-reference/qwen-asr
 */

export class SpeechRecognizer {
	private apiKey: string;

	constructor() {
		this.apiKey = process.env.DASHSCOPE_API_KEY || "";
		if (!this.apiKey) {
			log.logWarning("DASHSCOPE_API_KEY not set, speech recognition will be disabled");
		}
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
	 * 调用阿里云 Qwen-ASR WebSocket API 识别语音
	 */
	async recognize(opusFilePath: string): Promise<string | null> {
		if (!this.apiKey) {
			log.logWarning("DASHSCOPE_API_KEY not configured, skipping speech recognition");
			return null;
		}

		// 生成 PCM 文件路径
		const pcmPath = opusFilePath.replace(/\.[^.]+$/, ".pcm");

		// 转换为 PCM
		if (!this.convertToPcm(opusFilePath, pcmPath)) {
			log.logWarning("Failed to convert audio to PCM format");
			return null;
		}

		return new Promise((resolve, reject) => {
			const model = "qwen3-asr-flash-realtime";
			const baseUrl = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
			const url = `${baseUrl}?model=${model}`;

			let transcript = "";
			let isFinished = false;

			const ws = new WebSocket(url, {
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"OpenAI-Beta": "realtime=v1",
				},
			});

			const cleanup = () => {
				if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
					ws.close(1000, "ASR finished");
				}
			};

			// 超时处理
			const timeout = setTimeout(() => {
				if (!isFinished) {
					log.logWarning("ASR WebSocket timeout");
					cleanup();
					resolve(transcript || null);
				}
			}, 30000);

			ws.on("open", () => {
				log.logInfo("[ASR] WebSocket connected");

				// 发送会话配置（VAD 模式）
				const sessionUpdate = {
					event_id: `event_${Date.now()}`,
					type: "session.update",
					session: {
						modalities: ["text"],
						input_audio_format: "pcm",
						sample_rate: 16000,
						input_audio_transcription: {
							language: "zh",
						},
						turn_detection: {
							type: "server_vad",
							threshold: 0.0,
							silence_duration_ms: 400,
						},
					},
				};
				ws.send(JSON.stringify(sessionUpdate));

				// 延迟后发送音频
				setTimeout(() => {
					this.sendAudioFile(ws, pcmPath);
				}, 1000);
			});

			ws.on("message", (message) => {
				try {
					const data = JSON.parse(message.toString());

					// 收到转录结果
					if (data.type === "input_audio_buffer.speech_started") {
						log.logInfo("[ASR] Speech started");
					} else if (data.type === "conversation.item.input_audio_transcription.completed") {
						const text = data.transcript || "";
						transcript += text;
						log.logInfo(`[ASR] Partial transcript: ${text}`);
					} else if (data.type === "session.finished") {
						isFinished = true;
						const finalTranscript = data.transcript || transcript;
						log.logInfo(`[ASR] Final transcript: ${finalTranscript}`);
						clearTimeout(timeout);
						cleanup();
						resolve(finalTranscript || null);
					}
				} catch (_e) {
					log.logWarning("[ASR] Failed to parse message", message.toString().substring(0, 200));
				}
			});

			ws.on("error", (err) => {
				log.logWarning("[ASR] WebSocket error", err.message);
				clearTimeout(timeout);
				cleanup();
				reject(err);
			});

			ws.on("close", (code, reason) => {
				log.logInfo(`[ASR] WebSocket closed: ${code} - ${reason}`);
				clearTimeout(timeout);
				if (!isFinished) {
					resolve(transcript || null);
				}
			});
		});
	}

	/**
	 * 发送音频文件流
	 */
	private sendAudioFile(ws: WebSocket, pcmPath: string): void {
		try {
			const buffer = readFileSync(pcmPath);
			let offset = 0;
			const chunkSize = 3200; // 约 0.1s 的 PCM16 音频

			const sendChunk = () => {
				if (ws.readyState !== WebSocket.OPEN) {
					return;
				}

				if (offset >= buffer.length) {
					// 发送完成事件
					const finishEvent = {
						event_id: `event_${Date.now()}`,
						type: "session.finish",
					};
					ws.send(JSON.stringify(finishEvent));
					log.logInfo("[ASR] Audio sent, waiting for transcription");
					return;
				}

				const chunk = buffer.slice(offset, offset + chunkSize);
				offset += chunkSize;

				const encoded = chunk.toString("base64");
				const appendEvent = {
					event_id: `event_${Date.now()}`,
					type: "input_audio_buffer.append",
					audio: encoded,
				};

				ws.send(JSON.stringify(appendEvent));

				// 模拟实时发送
				setTimeout(sendChunk, 100);
			};

			sendChunk();
		} catch (error) {
			log.logWarning("[ASR] Failed to read PCM file", error instanceof Error ? error.message : String(error));
		}
	}
}
