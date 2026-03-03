/**
 * 模板渲染引擎
 * 支持 {{include:path}} 引用文件和 {{variable}} 变量替换
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * 提示词模式
 */
export type PromptMode = "full" | "minimal" | "compact";

/**
 * 模板渲染上下文
 */
export interface PromptContext {
	/** 工作空间路径 */
	workspacePath: string;
	/** 频道 ID */
	channelId: string;
	/** 记忆内容 */
	memory: string;
	/** 频道列表格式化字符串 */
	channels: string;
	/** 用户列表格式化字符串 */
	users: string;
	/** 技能列表格式化字符串 */
	skills: string;
	/** 环境描述 */
	envDescription: string;
	/** 频道路径 */
	channelPath: string;
	/** 是否 Docker 环境 */
	isDocker: boolean;
	/** 时区 */
	timezone: string;
	/** 提示词模式 */
	promptMode?: PromptMode;
	/** 当前日期 (YYYY-MM-DD) */
	currentDate?: string;
	/** 用户名 */
	userName?: string;
	/** 频道名 */
	channelName?: string;
}

/**
 * 渲染模板字符串
 * 1. 处理 {{include:path}} 引用 - 读取指定路径的文件内容
 * 2. 处理 {{#if condition}}...{{/if}} 条件渲染
 * 3. 处理 {{#eq var value}}...{{/eq}} 相等判断
 * 4. 处理 {{variable}} 变量 - 从上下文中替换
 *
 * @param template 模板字符串
 * @param context 渲染上下文
 * @returns 渲染后的字符串
 */
export function renderPrompt(template: string, context: PromptContext): string {
	let result = template;

	// 1. 处理 {{include:path}} 引用
	// 支持相对路径，基于 workspacePath 解析
	result = result.replace(/\{\{include:([^}]+)\}\}/g, (_, path: string) => {
		const filePath = join(context.workspacePath, path);
		if (existsSync(filePath)) {
			try {
				const content = readFileSync(filePath, "utf-8");
				// 限制文件大小（20KB）
				const MAX_FILE_SIZE = 20000;
				if (content.length > MAX_FILE_SIZE) {
					return `<!-- File too large: ${path} (${content.length} chars, max ${MAX_FILE_SIZE}) -->`;
				}
				return sanitizeContent(content);
			} catch (error) {
				return `<!-- Error reading ${path}: ${error} -->`;
			}
		}
		return `<!-- Missing: ${path} -->`;
	});

	// 2. 处理 {{#if condition}}...{{else}}...{{/if}} 条件渲染
	result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, condition: string, content: string) => {
		// 支持 {{#if}}...{{else}}...{{/if}} 语法
		const parts = content.split(/\{\{else\}\}/);
		const truthyContent = parts[0];
		const falsyContent = parts.length > 1 ? parts[1] : "";

		const value = context[condition as keyof PromptContext];
		const isTruthy = Boolean(value) || value === "true";
		return isTruthy ? truthyContent : falsyContent;
	});

	// 3. 处理 {{#eq var value}}...{{else}}...{{/eq}} 相等判断
	result = result.replace(
		/\{\{#eq\s+(\w+)\s+([^\}]+)\}\}([\s\S]*?)\{\{\/eq\}\}/g,
		(_, varName: string, expectedValue: string, content: string) => {
			const parts = content.split(/\{\{else\}\}/);
			const matchContent = parts[0];
			const noMatchContent = parts.length > 1 ? parts[1] : "";

			const actualValue = context[varName as keyof PromptContext];
			const trimmedExpected = expectedValue.trim().replace(/^["']|["']$/g, "");

			return actualValue === trimmedExpected ? matchContent : noMatchContent;
		},
	);

	// 4. 处理 {{variable}} 变量
	result = result.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
		if (key in context) {
			const value = context[key as keyof PromptContext];
			return value !== undefined && value !== null ? String(value) : "";
		}
		// 保留未识别的占位符
		return `{{${key}}}`;
	});

	return result;
}

/**
 * 内容安全过滤
 * 移除潜在的注入模式
 */
function sanitizeContent(content: string): string {
	return content
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
		.replace(/on\w+\s*=/gi, "data-blocked=");
}

/**
 * 检测敏感信息
 * 返回检测到的敏感信息类型列表
 */
export function detectSensitive(content: string): string[] {
	const detected: string[] = [];
	const patterns = [
		{ name: "OpenAI API Key", pattern: /sk-[a-zA-Z0-9]{20,}/g },
		{ name: "Slack Token", pattern: /xox[baprs]-[a-zA-Z0-9-]+/g },
		{ name: "API Key Assignment", pattern: /api[_-]?key\s*[=:]\s*['"][^'"]+/gi },
		{ name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g },
		{ name: "Private Key", pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g },
	];

	for (const { name, pattern } of patterns) {
		if (pattern.test(content)) {
			detected.push(name);
		}
		// Reset lastIndex for global regex
		pattern.lastIndex = 0;
	}

	return detected;
}

/**
 * 默认系统模板
 * 当 boot/AGENTS.md 不存在时使用
 */
export const DEFAULT_SYSTEM_TEMPLATE = `You are pi-feishu, a Feishu bot assistant. Be concise. No emojis.

## Core Identity

You are pi-feishu, an AI assistant for Feishu.

### Primary Directive
Help users accomplish tasks efficiently through code execution and automation.

### Values
- **Helpful**: Provide useful, actionable assistance
- **Honest**: Acknowledge limitations and uncertainties
- **Efficient**: Be concise and focused on solving problems

### Boundaries
- Never expose credentials or sensitive data
- Always confirm before destructive operations (delete, overwrite)
- Respect user privacy
- Don't pretend to have capabilities you don't have

## Response Rules

1. Be concise - no unnecessary explanations
2. Be direct - get to the point quickly
3. Be accurate - verify before acting
4. Be safe - confirm destructive operations
5. Match user's language
6. Use markdown formatting
7. Include file paths when discussing code

## Tools

### Primary Tools (Use First)
- **bash**: Run shell commands, install packages, system operations
- **read**: Examine file contents before editing (supports offset/limit for large files)
- **edit**: Make precise changes to existing files (requires exact match)

### Secondary Tools
- **write**: Create new files or complete rewrites
- **attach**: Share files to Feishu channel

### Best Practices
1. Always read a file before editing it
2. Use descriptive labels for all tool calls
3. Prefer edit over write for existing files
4. Check file existence before operations
5. Handle errors gracefully

## Memory Guide

### When to Update Memory
- User states a preference
- You learn important context
- User explicitly asks to remember something

### Current Memory
{{memory}}

## Feishu Context

### Formatting (Lark Markdown)
Bold: **text**, Italic: *text*, Code: \`code\`, Block: \`\`\`code\`\`\`, Links: [text](url)
Do NOT use HTML tags.

### Current Date
{{currentDate}}

### Channel & User IDs
Channels:
{{channels}}

Users:
{{users}}

## Environment
{{envDescription}}

{{#if isDocker}}
- Install tools with: apk add <package>
- Your changes persist across sessions
{{else}}
- Be careful with system modifications
{{/if}}

## Workspace Layout
{{workspacePath}}/
├── MEMORY.md                    # Global memory
├── skills/                      # Global CLI tools
└── {{channelId}}/               # This channel
    ├── MEMORY.md                # Channel memory
    ├── log.jsonl                # Message history
    ├── attachments/             # User-shared files
    └── scratch/                 # Working directory

### Available Skills
{{skills}}
`;

