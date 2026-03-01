/**
 * Card Builder Functions
 * 卡片构建函数
 */

import type { CardContent, CardElement } from "./types.js";

/**
 * 构建分割线
 */
export function buildDivider(): CardElement {
	return { tag: "hr" };
}

/**
 * 构建文本 div
 */
export function buildDiv(content: string): CardElement {
	return {
		tag: "div",
		text: { content, tag: "lark_md" },
	};
}

/**
 * 构建可折叠区域
 */
export function buildCollapsibleSection(title: string, content: string, collapsed = true): CardElement {
	return {
		tag: "collapsible_panel",
		header: { title: { content: title, tag: "plain_text" } },
		expanded: !collapsed,
		elements: [{ tag: "div", text: { content, tag: "lark_md" } }],
	};
}

/**
 * 构建代码块（使用 markdown 格式）
 */
export function buildCodeBlock(code: string, language?: string): CardElement {
	const langTag = language ? `\`\`\`${language}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``;
	return {
		tag: "div",
		text: { content: langTag, tag: "lark_md" },
	};
}

/**
 * 构建简单文本卡片
 */
export function buildTextCard(title: string, content: string): CardContent {
	return {
		config: { wide_screen_mode: true },
		header: { title: { content: title, tag: "plain_text" } },
		elements: [
			{
				tag: "div",
				text: { content, tag: "lark_md" },
			},
		],
	};
}

/**
 * 构建代码卡片
 */
export function buildCodeCard(title: string, code: string, language?: string): CardContent {
	const langTag = language ? `\`\`\`${language}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``;
	return {
		config: { wide_screen_mode: true },
		header: { title: { content: title, tag: "plain_text" } },
		elements: [
			{
				tag: "div",
				text: { content: langTag, tag: "lark_md" },
			},
		],
	};
}

/**
 * 构建结构化结果卡片
 */
export function buildStructuredCard(
	title: string,
	summary: string,
	sections?: { title: string; content: string; collapsed?: boolean }[],
): CardContent {
	const elements: CardElement[] = [];

	// 添加摘要
	if (summary) {
		elements.push(buildDiv(summary));
	}

	// 添加分割线和可折叠区域
	if (sections && sections.length > 0) {
		if (summary) {
			elements.push(buildDivider());
		}
		for (const section of sections) {
			elements.push(buildCollapsibleSection(section.title, section.content, section.collapsed ?? true));
		}
	}

	return {
		config: { wide_screen_mode: true },
		header: { title: { content: title, tag: "plain_text" } },
		elements: elements.length > 0 ? elements : [buildDiv("(无内容)")],
	};
}

/**
 * 文件变更类型图标
 */
const FILE_CHANGE_ICONS = {
	created: "➕",
	modified: "✏️",
	deleted: "🗑️",
};

/**
 * 构建文件变更列表
 */
export function buildFileChangeList(changes: { type: "created" | "modified" | "deleted"; path: string }[]): string {
	if (changes.length === 0) return "";
	return changes.map((c) => `${FILE_CHANGE_ICONS[c.type]} ${c.path}`).join("\n");
}

/**
 * 构建代码块列表
 */
export function buildCodeBlocksList(blocks: { language: string; code: string }[]): string {
	if (blocks.length === 0) return "";
	return blocks
		.map((b) => {
			const lang = b.language || "";
			return `\`\`\`${lang}\n${b.code}\n\`\`\``;
		})
		.join("\n\n");
}
