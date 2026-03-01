/**
 * Feishu Card Types
 * 飞书卡片 JSON 2.0 类型定义
 */

// 卡片配置
export interface CardConfig {
	width_mode?: "default" | "compact" | "fill";
	update_multi?: boolean;
	enable_forward?: boolean;
}

// 卡片标题
export interface CardHeader {
	title: { content: string; tag: "plain_text" | "lark_md" };
	subtitle?: { content: string; tag: "plain_text" | "lark_md" };
	template?: string;
	icon?: {
		tag: "standard_icon" | "custom_icon";
		token?: string;
		color?: string;
		img_key?: string;
	};
	padding?: string;
}

// 卡片元素接口
export interface CardElement {
	tag: string;
	element_id?: string;
	text?: { content: string; tag: "plain_text" | "lark_md" };
	title?: { content: string; tag: "plain_text" | "lark_md" };
	elements?: CardElement[];
	header?: { title: { content: string; tag: "plain_text" | "lark_md" } };
	content?: string;
	expanded?: boolean;
	margin?: string;
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

// 卡片正文
export interface CardBody {
	elements: CardElement[];
	direction?: "vertical" | "horizontal";
	padding?: string;
	horizontal_spacing?: string;
	vertical_spacing?: string;
	horizontal_align?: "left" | "center" | "right";
	vertical_align?: "top" | "center" | "bottom";
}

// 卡片内容接口 (JSON 2.0)
export interface CardContent {
	schema: "2.0";
	config?: CardConfig;
	header?: CardHeader;
	body: CardBody;
	card_link?: {
		url?: string;
		android_url?: string;
		ios_url?: string;
		pc_url?: string;
	};
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
