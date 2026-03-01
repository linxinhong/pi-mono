import { existsSync, mkdirSync, readFileSync } from "fs";
import { appendFile, writeFile } from "fs/promises";
import { join } from "path";
import * as log from "./log.js";

export interface Attachment {
	original: string;
	local: string;
}

export interface LoggedMessage {
	date: string;
	ts: string;
	user: string;
	userName?: string;
	displayName?: string;
	text: string;
	attachments: Attachment[];
	isBot: boolean;
}

export interface ChannelStoreConfig {
	workspaceDir: string; // 工作目录 (e.g., ~/.pi/feishu)
	appId: string;
	appSecret: string;
}

interface PendingDownload {
	channelId: string;
	localPath: string;
	fileKey: string;
	fileToken?: string;
	messageId?: string;
	type?: string;
}

export class ChannelStore {
	private workspaceDir: string;
	private appId: string;
	private appSecret: string;
	private pendingDownloads: PendingDownload[] = [];
	private isDownloading = false;
	private recentlyLogged = new Map<string, number>();
	private tenantAccessToken: string | null = null;
	private tokenExpiresAt: number = 0;

	constructor(config: ChannelStoreConfig) {
		this.workspaceDir = config.workspaceDir;
		this.appId = config.appId;
		this.appSecret = config.appSecret;

		if (!existsSync(this.workspaceDir)) {
			mkdirSync(this.workspaceDir, { recursive: true });
		}
	}

	getChannelDir(channelId: string): string {
		const dir = join(this.workspaceDir, "chats", channelId);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		return dir;
	}

	generateLocalFilename(originalName: string, timestamp: string): string {
		const ts = timestamp.length > 10 ? timestamp.slice(0, 13) : Date.now().toString();
		const sanitized = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
		return `${ts}_${sanitized}`;
	}

	/**
	 * Process attachments from a Feishu message event
	 */
	processAttachments(
		channelId: string,
		files: Array<{ name?: string; file_key?: string; file_token?: string; message_id?: string; type?: string }>,
		timestamp: string,
	): Attachment[] {
		const attachments: Attachment[] = [];

		for (const file of files) {
			if (!file.file_key) continue;
			if (!file.name) {
				log.logWarning("Attachment missing name, skipping", file.file_key);
				continue;
			}

			const filename = this.generateLocalFilename(file.name, timestamp);
			const localPath = `chats/${channelId}/attachments/${filename}`;

			attachments.push({
				original: file.name,
				local: localPath,
			});

			this.pendingDownloads.push({
				channelId,
				localPath,
				fileKey: file.file_key,
				fileToken: file.file_token,
				messageId: file.message_id,
				type: file.type,
			});
		}

		this.processDownloadQueue();

		return attachments;
	}

	async logMessage(channelId: string, message: LoggedMessage): Promise<boolean> {
		const dedupeKey = `${channelId}:${message.ts}`;
		if (this.recentlyLogged.has(dedupeKey)) {
			return false;
		}

		this.recentlyLogged.set(dedupeKey, Date.now());
		setTimeout(() => this.recentlyLogged.delete(dedupeKey), 60000);

		const logPath = join(this.getChannelDir(channelId), "log.jsonl");

		if (!message.date) {
			let date: Date;
			if (message.ts.includes(".")) {
				date = new Date(parseFloat(message.ts) * 1000);
			} else {
				date = new Date(parseInt(message.ts, 10));
			}
			message.date = date.toISOString();
		}

		const line = `${JSON.stringify(message)}\n`;
		await appendFile(logPath, line, "utf-8");
		return true;
	}

	async logBotResponse(channelId: string, text: string, ts: string): Promise<void> {
		await this.logMessage(channelId, {
			date: new Date().toISOString(),
			ts,
			user: "bot",
			text,
			attachments: [],
			isBot: true,
		});
	}

	getLastTimestamp(channelId: string): string | null {
		const logPath = join(this.workspaceDir, channelId, "log.jsonl");
		if (!existsSync(logPath)) {
			return null;
		}

		try {
			const content = readFileSync(logPath, "utf-8");
			const lines = content.trim().split("\n");
			if (lines.length === 0 || lines[0] === "") {
				return null;
			}
			const lastLine = lines[lines.length - 1];
			const message = JSON.parse(lastLine) as LoggedMessage;
			return message.ts;
		} catch {
			return null;
		}
	}

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

	private async processDownloadQueue(): Promise<void> {
		if (this.isDownloading || this.pendingDownloads.length === 0) return;

		this.isDownloading = true;

		while (this.pendingDownloads.length > 0) {
			const item = this.pendingDownloads.shift();
			if (!item) break;

			try {
				await this.downloadAttachment(item.localPath, item.fileKey, item.messageId, item.type);
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				log.logWarning(`Failed to download attachment`, `${item.localPath}: ${errorMsg}`);
			}
		}

		this.isDownloading = false;
	}

	private async downloadAttachment(
		localPath: string,
		fileKey: string,
		messageId?: string,
		type?: string,
	): Promise<void> {
		const filePath = join(this.workspaceDir, localPath);

		const dir = join(this.workspaceDir, localPath.substring(0, localPath.lastIndexOf("/")));
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		const token = await this.getTenantAccessToken();

		let url: string;
		if (type === "image" && messageId) {
			// 图片使用消息资源 API，需要指定 type=image
			url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=image`;
		} else {
			// 文件使用消息资源 API（file_key 就是 message_id）
			url = `https://open.feishu.cn/open-apis/im/v1/messages/${fileKey}/resources`;
		}

		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const buffer = await response.arrayBuffer();
		await writeFile(filePath, Buffer.from(buffer));
	}
}
