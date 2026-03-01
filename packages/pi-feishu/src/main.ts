#!/usr/bin/env node

import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { type AgentRunner, getOrCreateRunner, setModel } from "./agent.js";
import { createEventsWatcher } from "./events.js";
import { type FeishuBot, FeishuBot as FeishuBotClass, type FeishuEvent, type FeishuHandler } from "./feishu.js";
import * as log from "./log.js";
import { parseSandboxArg, type SandboxConfig, validateSandbox } from "./sandbox.js";
import { ChannelStore } from "./store.js";

// ============================================================================
// Config
// ============================================================================

const PI_DIR = join(homedir(), ".pi");
const AGENT_DIR = join(PI_DIR, "agent");
const CHANNELS_CONFIG_PATH = join(AGENT_DIR, "channels.json");
const DEFAULT_WORKSPACE_DIR = join(PI_DIR, "feishu"); // 工作空间根目录
const CHANNELS_SUBDIR = "chats"; // 频道目录放在 workdir/chats 下

// Load .env from ~/.pi/agent/.env if exists
const envPath = join(AGENT_DIR, ".env");
if (existsSync(envPath)) {
	config({ path: envPath });
}

interface FeishuChannelConfig {
	appId: string;
	appSecret: string;
	encryptKey?: string;
	verificationToken?: string;
	port?: number;
	dataDir?: string;
	model?: string;
	showThinking?: boolean;
}

interface ChannelsConfig {
	feishu?: FeishuChannelConfig;
}

function loadChannelsConfig(): ChannelsConfig | null {
	if (!existsSync(CHANNELS_CONFIG_PATH)) {
		return null;
	}
	try {
		const content = readFileSync(CHANNELS_CONFIG_PATH, "utf-8");
		return JSON.parse(content);
	} catch (err) {
		console.error(`Failed to load ${CHANNELS_CONFIG_PATH}:`, err);
		return null;
	}
}

interface ParsedArgs {
	dataDir: string;
	sandbox: SandboxConfig;
}

function parseArgs(): ParsedArgs {
	const args = process.argv.slice(2);
	let sandbox: SandboxConfig = { type: "host" };
	let dataDir: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--sandbox=")) {
			sandbox = parseSandboxArg(arg.slice("--sandbox=".length));
		} else if (arg === "--sandbox") {
			sandbox = parseSandboxArg(args[++i] || "");
		} else if (arg === "--help" || arg === "-h") {
			console.error("Usage: pi-feishu [--sandbox=host|docker:<name>] [data-directory]");
			console.error("");
			console.error("Arguments:");
			console.error("  data-directory    - Data directory (default: ~/.pi/feishu)");
			console.error("  --sandbox         - Sandbox mode: host (default) or docker:<name>");
			console.error("");
			console.error("Config file: ~/.pi/agent/channels.json");
			console.error(
				JSON.stringify(
					{ feishu: { appId: "cli_xxx", appSecret: "xxx", port: 3000, model: "groq/qwen-qwq-32b" } },
					null,
					2,
				),
			);
			console.error("");
			console.error("Environment variables (fallback):");
			console.error("  FEISHU_APP_ID      - Feishu application ID");
			console.error("  FEISHU_APP_SECRET  - Feishu application secret");
			console.error("  PORT               - Server port (default: 3000)");
			console.error("  PI_MODEL           - LLM model (e.g., groq/qwen-qwq-32b)");
			process.exit(0);
		} else if (!arg.startsWith("-")) {
			dataDir = arg;
		}
	}

	const finalDataDir = dataDir ? resolve(dataDir) : DEFAULT_WORKSPACE_DIR;

	return {
		dataDir: finalDataDir,
		sandbox,
	};
}

const parsedArgs = parseArgs();
const channelsConfig = loadChannelsConfig();

// Get config from channels.json or environment variables
const feishuConfig = channelsConfig?.feishu;
const FEISHU_APP_ID = feishuConfig?.appId || process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = feishuConfig?.appSecret || process.env.FEISHU_APP_SECRET;
const PORT = feishuConfig?.port || parseInt(process.env.PORT || "3000", 10);
const MODEL = feishuConfig?.model || process.env.PI_MODEL || process.env.FEISHU_MODEL;

// Set model early before any agent code runs
if (MODEL) {
	setModel(MODEL);
}

// Data directory: CLI arg > channels.json > default
const workspaceDir =
	parsedArgs.dataDir !== DEFAULT_WORKSPACE_DIR ? parsedArgs.dataDir : feishuConfig?.dataDir || DEFAULT_WORKSPACE_DIR;

// Ensure directories exist
if (!existsSync(workspaceDir)) {
	mkdirSync(workspaceDir, { recursive: true });
}
if (!existsSync(AGENT_DIR)) {
	mkdirSync(AGENT_DIR, { recursive: true });
}

const { sandbox } = parsedArgs;

if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
	console.error("Missing env: FEISHU_APP_ID, FEISHU_APP_SECRET");
	console.error("");
	console.error("Get these from the Feishu Open Platform: https://open.feishu.cn/");
	process.exit(1);
}

await validateSandbox(sandbox);

// ============================================================================
// State (per channel)
// ============================================================================

interface ChannelState {
	running: boolean;
	runner: AgentRunner;
	store: ChannelStore;
	stopRequested: boolean;
	stopMessageId?: string;
}

const channelStates = new Map<string, ChannelState>();

const SHOW_THINKING = feishuConfig?.showThinking ?? false;

function getState(channelId: string): ChannelState {
	let state = channelStates.get(channelId);
	if (!state) {
		const channelDir = join(workspaceDir, CHANNELS_SUBDIR, channelId);
		state = {
			running: false,
			runner: getOrCreateRunner(sandbox, channelId, channelDir, SHOW_THINKING),
			store: sharedStore,
			stopRequested: false,
		};
		channelStates.set(channelId, state);
	}
	return state;
}

// ============================================================================
// Create FeishuContext adapter
// ============================================================================

function createFeishuContext(event: FeishuEvent, feishu: FeishuBot, _state: ChannelState, isEvent?: boolean) {
	let statusMessageId: string | null = null; // Status message for thinking progress
	let responseMessageId: string | null = null; // Final response message
	const threadMessageIds: string[] = [];
	let statusText = "";
	const toolHistory: string[] = []; // 累积工具调用状态

	const user = feishu.getUser(event.user);
	const channel = feishu.getChannel(event.channel);

	const eventFilename = isEvent ? event.text.match(/^\[EVENT:([^:]+):/)?.[1] : undefined;

	return {
		message: {
			text: event.text,
			rawText: event.text,
			user: event.user,
			userName: user?.userName,
			channel: event.channel,
			ts: event.ts,
			attachments: (event.attachments || []).map((a) => ({ local: a.local })),
		},
		channelName: channel?.name,
		channels: feishu.getAllChannels().map((c) => ({ id: c.id, name: c.name })),
		users: feishu.getAllUsers().map((u) => ({ id: u.id, userName: u.userName, displayName: u.displayName })),

		respond: async (text: string, _shouldLog = true) => {
			// 如果是工具状态消息（以 "_ ->" 开头或 "_Error:"），累积到历史
			if (text.startsWith("_ -> ") || text.startsWith("_Error:")) {
				const cleanText = text.replace(/^_/, "").replace(/_$/, "");
				toolHistory.push(cleanText);

				// 构建状态显示
				const historyText = toolHistory.join("\n");
				if (statusMessageId) {
					await feishu.updateMessage(event.channel, statusMessageId, `🤔 处理中……\n\n${historyText}`);
				}
				return;
			}

			// 其他消息更新状态
			statusText = statusText ? `${statusText}\n${text}` : text;
			if (statusMessageId) {
				await feishu.updateMessage(event.channel, statusMessageId, `🤔 处理中……\n${statusText}`);
			}
		},

		replaceMessage: async (text: string) => {
			// Send final response as structured card (or plain message for short content)
			responseMessageId = await feishu.postStructuredMessage(event.channel, text);
			feishu.logBotResponse(event.channel, text, responseMessageId);
		},

		respondInThread: async (text: string) => {
			const parentId = responseMessageId || statusMessageId;
			if (parentId) {
				const id = await feishu.postInThread(event.channel, parentId, text);
				threadMessageIds.push(id);
			}
		},

		setTyping: async (isTyping: boolean) => {
			if (isTyping && !statusMessageId) {
				statusText = eventFilename ? `Starting event: ${eventFilename}` : "";
				const displayText = eventFilename ? `🤔 处理中……\n${statusText}` : "🤔 处理中……";
				statusMessageId = await feishu.postMessage(event.channel, displayText);
			}
		},

		uploadFile: async (filePath: string, title?: string) => {
			await feishu.uploadFile(event.channel, filePath, title);
		},

		uploadImage: async (imagePath: string): Promise<string> => {
			return feishu.uploadImage(imagePath);
		},

		sendImage: async (imageKey: string): Promise<string> => {
			return feishu.sendImage(event.channel, imageKey);
		},

		setWorking: async (working: boolean) => {
			if (!working && statusMessageId) {
				// Update status to "completed"
				await feishu.updateMessage(event.channel, statusMessageId, "😊 处理完成");
			}
		},

		deleteMessage: async () => {
			for (let i = threadMessageIds.length - 1; i >= 0; i--) {
				try {
					await feishu.deleteMessage(event.channel, threadMessageIds[i]);
				} catch {
					// Ignore errors deleting thread messages
				}
			}
			threadMessageIds.length = 0;
			if (statusMessageId) {
				await feishu.deleteMessage(event.channel, statusMessageId);
				statusMessageId = null;
			}
			if (responseMessageId) {
				await feishu.deleteMessage(event.channel, responseMessageId);
				responseMessageId = null;
			}
		},

		sendErrorCard: async (message: string) => {
			await feishu.sendCard(event.channel, {
				schema: "2.0",
				config: { width_mode: "fill" },
				body: {
					elements: [
						{
							tag: "div",
							text: {
								tag: "lark_md",
								content: `**Error**\n\n${message}`,
							},
						},
					],
				},
				header: {
					template: "red",
					title: { tag: "plain_text", content: "Error" },
				},
			} as any);
		},
	};
}

// ============================================================================
// Handler
// ============================================================================

const handler: FeishuHandler = {
	isRunning(channelId: string): boolean {
		const state = channelStates.get(channelId);
		return state?.running ?? false;
	},

	async handleStop(channelId: string, feishu: FeishuBot): Promise<void> {
		const state = channelStates.get(channelId);
		if (state?.running) {
			state.stopRequested = true;
			state.runner.abort();
			const id = await feishu.postMessage(channelId, "_Stopping..._");
			state.stopMessageId = id;
		} else {
			await feishu.postMessage(channelId, "_Nothing running_");
		}
	},

	async handleEvent(event: FeishuEvent, feishu: FeishuBot, isEvent?: boolean): Promise<void> {
		const state = getState(event.channel);

		state.running = true;
		state.stopRequested = false;

		log.logInfo(`[${event.channel}] Starting run: ${event.text.substring(0, 50)}`);

		try {
			const ctx = createFeishuContext(event, feishu, state, isEvent);

			await ctx.setTyping(true);
			await ctx.setWorking(true);
			const result = await state.runner.run(ctx as any, state.store);
			await ctx.setWorking(false);

			if (result.stopReason === "aborted" && state.stopRequested) {
				if (state.stopMessageId) {
					await feishu.updateMessage(event.channel, state.stopMessageId, "_Stopped_");
					state.stopMessageId = undefined;
				} else {
					await feishu.postMessage(event.channel, "_Stopped_");
				}
			}
		} catch (err) {
			log.logWarning(`[${event.channel}] Run error`, err instanceof Error ? err.message : String(err));
		} finally {
			state.running = false;
		}
	},
};

// ============================================================================
// Start
// ============================================================================

log.logStartup(workspaceDir, sandbox.type === "host" ? "host" : `docker:${sandbox.container}`);

const sharedStore = new ChannelStore({ workspaceDir, appId: FEISHU_APP_ID!, appSecret: FEISHU_APP_SECRET! });

const bot = new FeishuBotClass(handler, {
	appId: FEISHU_APP_ID!,
	appSecret: FEISHU_APP_SECRET!,
	workingDir: workspaceDir,
	store: sharedStore,
});

// Start events watcher
const eventsWatcher = createEventsWatcher(workspaceDir, bot);

// Handle shutdown
process.on("SIGINT", () => {
	log.logInfo("Shutting down...");
	eventsWatcher.stop();
	process.exit(0);
});

process.on("SIGTERM", () => {
	log.logInfo("Shutting down...");
	eventsWatcher.stop();
	process.exit(0);
});

// Start the bot
await bot.start(PORT);
eventsWatcher.start();
