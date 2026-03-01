/**
 * Feishu Card Types
 * 飞书卡片 JSON 2.0 类型定义
 */

// 卡片元素接口
export interface CardElement {
	tag: string;
	text?: { content: string; tag: string };
	title?: { content: string; tag: string };
	elements?: CardElement[];
	config?: { wide_screen_mode: boolean };
	header?: { title: { content: string; tag: string }; template?: string };
	content?: string;
	expanded?: boolean;
	// column_set 相关
	flex_mode?: string;
	background_style?: string;
	columns?: CardColumn[];
	// 其他属性
	[name: string]: unknown;
}

export interface CardColumn {
	tag: "column";
	width: string;
	weight?: number;
	elements: CardElement[];
}

// 卡片内容接口
export interface CardContent {
	config: { wide_screen_mode: boolean };
	header?: { title: { content: string; tag: string }; template?: string };
	elements: CardElement[];
}

// 可折叠区域接口
export interface CollapsibleSection {
	title: string;
	content: string;
	collapsed?: boolean;
}

// 解析后的回复结构
export interface ParsedResponse {
	summary: string;
	codeBlocks: { language: string; code: string }[];
	fileChanges: { type: "created" | "modified" | "deleted"; path: string }[];
	details: string;
}
