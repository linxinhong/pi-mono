/**
 * Response Parser
 * 解析 AI 回复，提取结构化内容
 */

import type { ParsedResponse } from "./types.js";

/**
 * 提取代码块
 */
function extractCodeBlocks(text: string): { language: string; code: string }[] {
	const blocks: { language: string; code: string }[] = [];
	const regex = /```(\w*)\n([\s\S]*?)```/g;
	let match: RegExpExecArray | null = regex.exec(text);
	while (match !== null) {
		blocks.push({
			language: match[1] || "",
			code: match[2].trim(),
		});
		match = regex.exec(text);
	}
	return blocks;
}

/**
 * 提取文件变更
 */
function extractFileChanges(text: string): { type: "created" | "modified" | "deleted"; path: string }[] {
	const changes: { type: "created" | "modified" | "deleted"; path: string }[] = [];

	// 匹配文件路径模式
	const patterns = [
		// "创建/新建/添加 xxx" 或 "xxx 已创建"
		{ regex: /(?:创建|新建|添加|Created|New|Added?)\s+[`"]?([^\s"`]+\.[a-zA-Z]+)[`"]?/gi, type: "created" as const },
		// "修改/更新 xxx" 或 "xxx 已修改"
		{
			regex: /(?:修改|更新|编辑|Modified|Updated?|Edited?)\s+[`"]?([^\s"`]+\.[a-zA-Z]+)[`"]?/gi,
			type: "modified" as const,
		},
		// "删除 xxx" 或 "xxx 已删除"
		{ regex: /(?:删除|Deleted?|Removed?)\s+[`"]?([^\s"`]+\.[a-zA-Z]+)[`"]?/gi, type: "deleted" as const },
	];

	for (const { regex, type } of patterns) {
		let match: RegExpExecArray | null = regex.exec(text);
		while (match !== null) {
			const path = match[1];
			// 避免重复
			if (!changes.some((c) => c.path === path)) {
				changes.push({ type, path });
			}
			match = regex.exec(text);
		}
	}

	return changes;
}

/**
 * 提取摘要（取前几行或 ### 摘要 部分）
 */
function extractSummary(text: string): string {
	// 尝试提取 ### 摘要 部分
	const summaryMatch = text.match(/###\s*摘要\s*\n([\s\S]*?)(?=\n###|\n##|$)/i);
	if (summaryMatch) {
		return summaryMatch[1].trim();
	}

	// 尝试提取第一段（非代码块）
	const lines = text.split("\n");
	const summaryLines: string[] = [];
	let inCodeBlock = false;
	let lineCount = 0;

	for (const line of lines) {
		if (line.startsWith("```")) {
			inCodeBlock = !inCodeBlock;
			continue;
		}
		if (inCodeBlock) continue;

		// 跳过空行和标题
		if (line.trim() === "" || line.startsWith("#")) {
			if (summaryLines.length > 0) break;
			continue;
		}

		summaryLines.push(line);
		lineCount++;
		if (lineCount >= 3) break; // 最多 3 行
	}

	return summaryLines.join("\n").trim();
}

/**
 * 解析 AI 回复
 */
export function parseResponse(text: string): ParsedResponse {
	const codeBlocks = extractCodeBlocks(text);
	const fileChanges = extractFileChanges(text);
	const summary = extractSummary(text);

	return {
		summary,
		codeBlocks,
		fileChanges,
		details: text,
	};
}

/**
 * 判断是否需要结构化显示
 */
export function shouldUseStructuredCard(text: string): boolean {
	// 如果包含代码块或文件变更，使用结构化卡片
	const codeBlocks = extractCodeBlocks(text);
	const fileChanges = extractFileChanges(text);

	// 或者内容超过 500 字符
	const isLongContent = text.length > 500;

	return codeBlocks.length > 0 || fileChanges.length > 0 || isLongContent;
}
