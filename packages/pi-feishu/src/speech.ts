import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import * as log from "./log.js";

/**
 * 飞书语音识别 (ASR) 服务
 * 文档: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/speech_to_text-v1/speech/file_recognize
 */

export class SpeechRecognizer {
	private tenantAccessToken: string | null = null;
	private tokenExpiresAt: number = 0;

	constructor(
		private appId: string,
		private appSecret: string,
	) {}

	/**
	 * 获取 tenant_access_token
	 */
	private async getTenantAccessToken(): Promise<string> {
		if (this.tenantAccessToken && Date.now() < this.tokenExpiresAt) {
			return this.tenantAccessToken;
		}

		const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				app_id: this.appId,
				app_secret: this.appSecret,
			}),
		});

		const data = (await response.json()) as { tenant_access_token?: string; expire?: number };

		if (!data.tenant_access_token) {
			throw new Error("Failed to get tenant access token");
		}

		this.tenantAccessToken = data.tenant_access_token;
		this.tokenExpiresAt = Date.now() + ((data.expire || 7200) - 300) * 1000;

		return this.tenantAccessToken;
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
	 * 调用飞书 ASR API 识别语音
	 */
	async recognize(opusFilePath: string): Promise<string | null> {
		// 生成 PCM 文件路径
		const pcmPath = opusFilePath.replace(/\.[^.]+$/, ".pcm");

		// 转换为 PCM
		if (!this.convertToPcm(opusFilePath, pcmPath)) {
			log.logWarning("Failed to convert audio to PCM format");
			return null;
		}

		try {
			// 读取 PCM 文件并转为 base64
			const pcmBuffer = readFileSync(pcmPath);
			const base64Audio = pcmBuffer.toString("base64");

			// 生成 16 位文件 ID
			const fileId = Math.random().toString(36).substring(2, 18).padEnd(16, "0").slice(0, 16);

			const token = await this.getTenantAccessToken();

			// 调用飞书 ASR API
			const response = await fetch("https://open.feishu.cn/open-apis/speech_to_text/v1/speech/file_recognize", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json; charset=utf-8",
				},
				body: JSON.stringify({
					speech: {
						speech: base64Audio,
					},
					config: {
						file_id: fileId,
						format: "pcm",
						engine_type: "16k_auto",
					},
				}),
			});

			const data = (await response.json()) as {
				code: number;
				msg: string;
				data?: { recognition_text: string };
			};

			if (data.code !== 0) {
				log.logWarning("ASR API error", `${data.code}: ${data.msg}`);
				return null;
			}

			return data.data?.recognition_text || null;
		} catch (error) {
			log.logWarning("Speech recognition failed", error instanceof Error ? error.message : String(error));
			return null;
		}
	}
}
