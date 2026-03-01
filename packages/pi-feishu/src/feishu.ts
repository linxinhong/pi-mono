import * as lark from "@larksuiteoapi/node-sdk";
import express, { type Request, type Response } from "express";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import * as log from "./log.js";
import type { Attachment, ChannelStore } from "./store.js";

export type { CardContent, CardElement } from "./cards/index.js";
export { buildCodeCard, buildTextCard } from "./cards/index.js";

import type { CardContent } from "./cards/index.js";

// ============================================================================
// Types
// ============================================================================

export interface FeishuEvent {
	type: "mention" | "dm" | "p2p";
	channel: string;
	ts: string;
	user: string;
	text: string;
	files?: Array<{ name?: string; file_key?: string; file_token?: string }>;
	/** Processed attachments with local paths (populated after logUserMessage) */
	attachments?: Attachment[];
}

export interface FeishuUser {
	id: string;
	userName: string;
	displayName: string;
}

export interface FeishuChannel {
	id: string;
	name: string;
	type: "chat" | "p2p";
}

// Types used by agent.ts
export interface ChannelInfo {
	id: string;
	name: string;
}

export interface UserInfo {
	id: string;
	userName: string;
	displayName: string;
}

export interface FeishuContext {
	message: {
		text: string;
		rawText: string;
		user: string;
		userName?: string;
		channel: string;
		ts: string;
		attachments: Array<{ local: string }>;
	};
	channelName?: string;
	channels: ChannelInfo[];
	users: UserInfo[];
	respond: (text: string, shouldLog?: boolean) => Promise<void>;
	replaceMessage: (text: string) => Promise<void>;
	respondInThread: (text: string) => Promise<void>;
	setTyping: (isTyping: boolean) => Promise<void>;
	uploadFile: (filePath: string, title?: string) => Promise<void>;
	uploadImage: (imagePath: string) => Promise<string>;
	sendImage: (imageKey: string) => Promise<string>;
	setWorking: (working: boolean) => Promise<void>;
	deleteMessage: () => Promise<void>;
	sendErrorCard: (message: string) => Promise<void>;
}

export interface FeishuHandler {
	/**
	 * Check if channel is currently running (SYNC)
	 */
	isRunning(channelId: string): boolean;

	/**
	 * Handle an event that triggers the bot (ASYNC)
	 * Called only when isRunning() returned false for user messages.
	 * Events always queue and pass isEvent=true.
	 */
	handleEvent(event: FeishuEvent, feishu: FeishuBot, isEvent?: boolean): Promise<void>;

	/**
	 * Handle stop command (ASYNC)
	 * Called when user says "stop" while bot is running
	 */
	handleStop(channelId: string, feishu: FeishuBot): Promise<void>;
}

// ============================================================================
// Per-channel queue for sequential processing
// ============================================================================

type QueuedWork = () => Promise<void>;

class ChannelQueue {
	private queue: QueuedWork[] = [];
	private processing = false;

	enqueue(work: QueuedWork): void {
		this.queue.push(work);
		this.processNext();
	}

	size(): number {
		return this.queue.length;
	}

	private async processNext(): Promise<void> {
		if (this.processing || this.queue.length === 0) return;
		this.processing = true;
		const work = this.queue.shift()!;
		try {
			await work();
		} catch (err) {
			log.logWarning("Queue error", err instanceof Error ? err.message : String(err));
		}
		this.processing = false;
		this.processNext();
	}
}

// ============================================================================
// FeishuBot
// ============================================================================

export interface FeishuBotConfig {
	appId: string;
	appSecret: string;
	workingDir: string;
	store: ChannelStore;
	useWebSocket?: boolean;
	port?: number;
}

export class FeishuBot {
	private client: lark.Client;
	private wsClient: lark.WSClient | null = null;
	private handler: FeishuHandler;
	private workingDir: string;
	private store: ChannelStore;
	private app: ReturnType<typeof express> | null = null;
	private botUserId: string | null = null;
	private startupTs: string | null = null;

	private users = new Map<string, FeishuUser>();
	private channels = new Map<string, FeishuChannel>();
	private queues = new Map<string, ChannelQueue>();

	constructor(handler: FeishuHandler, config: FeishuBotConfig) {
		this.handler = handler;
		this.workingDir = config.workingDir;
		this.store = config.store;
		this.client = new lark.Client({
			appId: config.appId,
			appSecret: config.appSecret,
			disableTokenCache: false,
		});

		// Initialize WebSocket client if enabled
		if (config.useWebSocket !== false) {
			this.wsClient = new lark.WSClient({
				appId: config.appId,
				appSecret: config.appSecret,
				loggerLevel: lark.LoggerLevel.info,
			});
		}
	}

	// ==========================================================================
	// Public API
	// ==========================================================================

	async start(port: number): Promise<void> {
		// Get bot info - try to get bot user ID from bot endpoint
		try {
			const botInfo = await this.client.im.chat.get({
				path: {
					chat_id: "bot_info",
				},
			} as any);
			if (botInfo.code === 0) {
				this.botUserId = (botInfo.data as any)?.chat_id || null;
			}
		} catch {
			// Ignore, bot user ID will be extracted from mentions
		}

		await Promise.all([this.fetchUsers(), this.fetchChannels()]);
		log.logInfo(`Loaded ${this.channels.size} channels, ${this.users.size} users`);

		// Record startup time
		this.startupTs = Date.now().toString();

		// Use WebSocket long connection if available
		if (this.wsClient) {
			return this.startWebSocket();
		}

		// Fallback to HTTP webhook mode
		return this.startWebhook(port);
	}

	private async startWebSocket(): Promise<void> {
		log.logInfo("Starting WebSocket long connection mode...");

		const eventDispatcher = new lark.EventDispatcher({}).register({
			"im.message.receive_v1": async (data: any) => {
				await this.handleMessageEvent(data);
			},
		});

		this.wsClient!.start({ eventDispatcher });
		log.logInfo("WebSocket client started");
		log.logConnected();
	}

	private async startWebhook(port: number): Promise<void> {
		log.logInfo("Starting HTTP webhook mode...");

		// Start HTTP server for webhooks
		this.app = express();
		this.app.use(express.json({ limit: "10mb" }));

		// Health check endpoint
		this.app.get("/health", (_req: Request, res: Response) => {
			res.json({ status: "ok" });
		});

		// Webhook endpoint for Feishu events
		this.app.post("/webhook", async (req: Request, res: Response) => {
			await this.handleWebhook(req, res);
		});

		return new Promise((resolve, reject) => {
			this.app!.listen(port, () => {
				log.logInfo(`Feishu bot server listening on port ${port}`);
				log.logConnected();
				resolve();
			}).on("error", reject);
		});
	}

	getUser(userId: string): FeishuUser | undefined {
		return this.users.get(userId);
	}

	getChannel(channelId: string): FeishuChannel | undefined {
		return this.channels.get(channelId);
	}

	getAllUsers(): FeishuUser[] {
		return Array.from(this.users.values());
	}

	getAllChannels(): FeishuChannel[] {
		return Array.from(this.channels.values());
	}

	private buildTextCard(text: string): string {
		return JSON.stringify({
			schema: "2.0",
			config: { width_mode: "fill", update_multi: true },
			body: {
				elements: [{ tag: "div", text: { tag: "lark_md", content: text } }],
			},
		});
	}

	async postMessage(channel: string, text: string): Promise<string> {
		const result = await this.client.im.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: channel,
				msg_type: "interactive",
				content: this.buildTextCard(text),
			},
		});

		if (result.code !== 0) {
			throw new Error(`Failed to post message: ${result.msg}`);
		}

		return result.data?.message_id || "";
	}

	async updateMessage(_channel: string, messageId: string, text: string): Promise<void> {
		await this.client.im.message.patch({
			path: {
				message_id: messageId,
			},
			data: {
				content: this.buildTextCard(text),
			},
		} as any);
	}

	async deleteMessage(_channel: string, messageId: string): Promise<void> {
		await this.client.im.message.delete({
			path: {
				message_id: messageId,
			},
		});
	}

	async postInThread(channel: string, parentMessageId: string, text: string): Promise<string> {
		const result = await this.client.im.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: channel,
				msg_type: "text",
				content: JSON.stringify({ text }),
				root_id: parentMessageId,
			},
		} as any);

		if (result.code !== 0) {
			throw new Error(`Failed to post in thread: ${result.msg}`);
		}

		return result.data?.message_id || "";
	}

	async sendCard(channel: string, card: CardContent): Promise<string> {
		const result = await this.client.im.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: channel,
				msg_type: "interactive",
				content: JSON.stringify(card),
			},
		});

		if (result.code !== 0) {
			throw new Error(`Failed to send card: ${result.msg}`);
		}

		return result.data?.message_id || "";
	}

	/**
	 * 发送结构化消息（直接使用 markdown 卡片）
	 * AI 负责生成结构良好的 markdown，卡片负责准确渲染
	 */
	async postStructuredMessage(channel: string, text: string): Promise<string> {
		return this.postMessage(channel, text);
	}

	async uploadFile(channel: string, filePath: string, title?: string): Promise<void> {
		const fileName = title || basename(filePath);
		const ext = filePath.toLowerCase().split(".").pop() || "";

		// 支持的图片格式
		const imageExtensions = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "ico", "tiff", "heic"];

		if (imageExtensions.includes(ext)) {
			// 使用图片上传 API
			const imageKey = await this.uploadImage(filePath);
			await this.sendImage(channel, imageKey);
			return;
		}

		// 非图片文件，使用 IM 文件上传 API
		// 文件类型映射
		const fileTypeMap: Record<string, string> = {
			pdf: "pdf",
			doc: "doc",
			docx: "doc",
			xls: "xls",
			xlsx: "xls",
			ppt: "ppt",
			pptx: "ppt",
			mp4: "mp4",
			opus: "opus",
		};
		const fileType = fileTypeMap[ext] || "stream";

		const fileContent = readFileSync(filePath);

		// 使用 IM 文件上传 API
		const uploadResult = await (this.client.im.file as any).create({
			data: {
				file_type: fileType,
				file_name: fileName,
				file: fileContent,
			},
		});

		if (!uploadResult || !uploadResult.file_key) {
			throw new Error("Failed to upload file: no file_key returned");
		}

		// 发送文件消息
		await this.client.im.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: channel,
				msg_type: "file",
				content: JSON.stringify({ file_key: uploadResult.file_key }),
			},
		});
	}

	/**
	 * 上传图片到飞书
	 * @param imagePath 图片文件路径
	 * @returns image_key
	 */
	async uploadImage(imagePath: string): Promise<string> {
		const result = await this.client.im.image.create({
			data: {
				image_type: "message",
				image: readFileSync(imagePath),
			},
		});

		if (!result || !result.image_key) {
			throw new Error("Failed to upload image: no image_key returned");
		}

		return result.image_key;
	}

	/**
	 * 下载图片
	 * @param imageKey 图片的 key
	 * @returns 图片 Buffer
	 */
	async downloadImage(imageKey: string): Promise<Buffer> {
		const result = await this.client.im.image.get({
			path: { image_key: imageKey },
		});

		// 使用 getReadableStream 获取图片流并转换为 Buffer
		const stream = result.getReadableStream();
		const chunks: Buffer[] = [];

		return new Promise((resolve, reject) => {
			stream.on("data", (chunk: Buffer) => chunks.push(chunk));
			stream.on("end", () => resolve(Buffer.concat(chunks)));
			stream.on("error", reject);
		});
	}

	/**
	 * 发送图片消息到频道
	 * @param channel 频道 ID
	 * @param imageKey 图片的 key
	 * @returns 消息 ID
	 */
	async sendImage(channel: string, imageKey: string): Promise<string> {
		const result = await this.client.im.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: channel,
				msg_type: "image",
				content: JSON.stringify({ image_key: imageKey }),
			},
		});

		if (result.code !== 0) {
			throw new Error(`Failed to send image: ${result.msg}`);
		}

		return result.data?.message_id || "";
	}

	/**
	 * Log a message to log.jsonl (SYNC)
	 */
	logToFile(channel: string, entry: object): void {
		const dir = join(this.workingDir, "chats", channel);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		appendFileSync(join(dir, "log.jsonl"), `${JSON.stringify(entry)}\n`);
	}

	/**
	 * Log a bot response to log.jsonl
	 */
	logBotResponse(channel: string, text: string, ts: string): void {
		this.logToFile(channel, {
			date: new Date().toISOString(),
			ts,
			user: "bot",
			text,
			attachments: [],
			isBot: true,
		});
	}

	// ==========================================================================
	// Events Integration
	// ==========================================================================

	/**
	 * Enqueue an event for processing.
	 * Returns true if enqueued, false if queue is full (max 5).
	 */
	enqueueEvent(event: FeishuEvent): boolean {
		const queue = this.getQueue(event.channel);
		if (queue.size() >= 5) {
			log.logWarning(`Event queue full for ${event.channel}, discarding: ${event.text.substring(0, 50)}`);
			return false;
		}
		log.logInfo(`Enqueueing event for ${event.channel}: ${event.text.substring(0, 50)}`);
		queue.enqueue(() => this.handler.handleEvent(event, this, true));
		return true;
	}

	// ==========================================================================
	// Private - Webhook Handler
	// ==========================================================================

	private async handleWebhook(req: Request, res: Response): Promise<void> {
		const body = req.body;

		// Handle URL verification challenge
		if (body.type === "url_verification") {
			res.json({ challenge: body.challenge });
			return;
		}

		// Parse event
		const header = body.header;
		const event = body.event;

		if (!header || !event) {
			res.status(400).json({ error: "Invalid event format" });
			return;
		}

		const eventType = header.event_type;

		// Handle message events
		if (eventType === "im.message.receive_v1") {
			await this.handleMessageEvent(event);
		}

		res.json({ code: 0, msg: "success" });
	}

	private async handleMessageEvent(event: any): Promise<void> {
		const message = event.message;
		if (!message) return;

		const chatId = message.chat_id;
		const messageId = message.message_id;
		const msgType = message.message_type;
		const content = message.content;
		const sender = event.sender;

		// Skip bot messages
		if (sender?.sender_type === "app") return;

		// Parse message content
		let text = "";
		let files:
			| Array<{ name?: string; file_key?: string; file_token?: string; message_id?: string; type?: string }>
			| undefined;

		try {
			const parsedContent = JSON.parse(content);

			if (msgType === "text") {
				text = parsedContent.text || "";
			} else if (msgType === "post") {
				// Rich text message
				text = this.extractTextFromPost(parsedContent);
			} else if (msgType === "image") {
				// 图片消息 - 需要使用消息资源 API 下载
				const imageKey = parsedContent.image_key || "";
				files = [
					{
						name: `image_${imageKey}.jpg`,
						file_key: imageKey,
						message_id: messageId,
						type: "image",
					},
				];
				text = "[图片]";
			} else if (msgType === "file" || msgType === "audio" || msgType === "media") {
				// 调试：记录飞书返回的完整文件消息内容
				log.logInfo(`File message content: ${JSON.stringify(parsedContent)}`);
				// 音频消息可能没有 file_name，使用 file_key 生成默认文件名
				const fileName =
					parsedContent.file_name || `audio_${parsedContent.file_key}.${msgType === "audio" ? "opus" : "file"}`;
				files = [
					{
						name: fileName,
						file_key: parsedContent.file_key,
						file_token: parsedContent.file_token,
						message_id: messageId,
						type: "file",
					},
				];
				text = parsedContent.file_name || "[语音]";
			}
		} catch {
			text = content;
		}

		// Remove @mentions from text
		text = text.replace(/@_user_[\d]+/g, "").trim();

		// Determine message type
		const isP2P = message.chat_type === "p2p";
		const _isMention = text.includes(`@${this.botUserId}`) || content.includes(`"at_user_id"`);

		const feishuEvent: FeishuEvent = {
			type: isP2P ? "p2p" : "mention",
			channel: chatId,
			ts: message.create_time || Date.now().toString(),
			user: sender?.sender_id?.user_id || sender?.sender_id?.open_id || "unknown",
			text,
			files,
		};

		// Log message
		feishuEvent.attachments = this.logUserMessage(feishuEvent);

		// Skip old messages
		if (this.startupTs && feishuEvent.ts < this.startupTs) {
			log.logInfo(`[${chatId}] Skipping old message (pre-startup): ${text.substring(0, 30)}`);
			return;
		}

		// Check for stop command
		if (text.toLowerCase().trim() === "stop") {
			if (this.handler.isRunning(chatId)) {
				this.handler.handleStop(chatId, this);
			} else {
				await this.postMessage(chatId, "_Nothing running_");
			}
			return;
		}

		// Check if busy
		if (this.handler.isRunning(chatId)) {
			await this.postMessage(chatId, "_Already working. Say `stop` to cancel._");
		} else {
			this.getQueue(chatId).enqueue(() => this.handler.handleEvent(feishuEvent, this));
		}
	}

	private extractTextFromPost(postContent: any): string {
		if (!postContent.content) return "";

		const extractText = (elements: any[]): string => {
			return elements
				.map((el) => {
					if (el.tag === "text") return el.text || "";
					if (el.children) return extractText(el.children);
					return "";
				})
				.join("");
		};

		if (Array.isArray(postContent.content)) {
			return postContent.content
				.map((block: any) => {
					if (block.children) return extractText(block.children);
					return "";
				})
				.join("\n");
		}

		return "";
	}

	/**
	 * Log a user message to log.jsonl (SYNC)
	 */
	private logUserMessage(event: FeishuEvent): Attachment[] {
		const user = this.users.get(event.user);
		const attachments = event.files ? this.store.processAttachments(event.channel, event.files, event.ts) : [];

		this.logToFile(event.channel, {
			date: new Date().toISOString(),
			ts: event.ts,
			user: event.user,
			userName: user?.userName,
			displayName: user?.displayName,
			text: event.text,
			attachments,
			isBot: false,
		});

		return attachments;
	}

	private getQueue(channelId: string): ChannelQueue {
		let queue = this.queues.get(channelId);
		if (!queue) {
			queue = new ChannelQueue();
			this.queues.set(channelId, queue);
		}
		return queue;
	}

	// ==========================================================================
	// Private - Fetch Users/Channels
	// ==========================================================================

	private async fetchUsers(): Promise<void> {
		try {
			let pageToken: string | undefined;
			do {
				const result = await this.client.contact.user.list({
					params: {
						page_size: 100,
						page_token: pageToken,
					},
				});

				if (result.code === 0 && result.data?.items) {
					for (const user of result.data.items) {
						if (user.user_id) {
							this.users.set(user.user_id, {
								id: user.user_id,
								userName: user.name || user.user_id,
								displayName: user.nickname || user.name || user.user_id,
							});
						}
					}
				}

				pageToken = result.data?.page_token;
			} while (pageToken);
		} catch (err) {
			log.logWarning("Failed to fetch users", err instanceof Error ? err.message : String(err));
		}
	}

	private async fetchChannels(): Promise<void> {
		try {
			let pageToken: string | undefined;
			do {
				const result = await this.client.im.chat.list({
					params: {
						page_size: 100,
						page_token: pageToken,
					},
				});

				if (result.code === 0 && result.data?.items) {
					for (const chat of result.data.items) {
						const chatId = (chat as any).chat_id;
						if (chatId) {
							this.channels.set(chatId, {
								id: chatId,
								name: chat.name || chatId,
								type: (chat as any).chat_mode === "p2p" ? "p2p" : "chat",
							});
						}
					}
				}

				pageToken = result.data?.page_token;
			} while (pageToken);
		} catch (err) {
			log.logWarning("Failed to fetch channels", err instanceof Error ? err.message : String(err));
		}
	}
}
