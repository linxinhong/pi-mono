/**
 * Memory Tools - AI tools for memory management
 *
 * These tools allow the AI to actively manage its own memory:
 * - memory_save: Save important information to long-term memory
 * - memory_recall: Search and retrieve historical memories
 * - memory_append_daily: Append to today's daily log
 * - memory_forget: Remove outdated information
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getMemoryStore } from "./store.js";

// ============================================================================
// Types
// ============================================================================

export interface MemoryToolResult {
	success: boolean;
	message: string;
	data?: unknown;
}

export interface MemoryTool {
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<
			string,
			{
				type: string;
				description: string;
				enum?: string[];
			}
		>;
		required: string[];
	};
}

// ============================================================================
// Memory Tools Definition
// ============================================================================

export const memoryTools: MemoryTool[] = [
	{
		name: "memory_save",
		description:
			"Save important information to long-term memory (MEMORY.md). Use for user preferences, system configurations, important decisions, or recurring patterns.",
		parameters: {
			type: "object",
			properties: {
				content: {
					type: "string",
					description: "The information to save (concise and factual)",
				},
				section: {
					type: "string",
					description: "Which section to save to",
					enum: ["User Preferences", "System Knowledge", "Recurring Tasks", "Important Decisions"],
				},
			},
			required: ["content", "section"],
		},
	},
	{
		name: "memory_recall",
		description:
			"Search historical memories. Use when user mentions past events or when historical context is needed.",
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Search keywords or question",
				},
				topK: {
					type: "number",
					description: "Number of results to return (default 5)",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "memory_append_daily",
		description:
			"Append a record to today's daily log. Use for task execution results, user instructions, notable events.",
		parameters: {
			type: "object",
			properties: {
				content: {
					type: "string",
					description: "The content to log (concise, factual)",
				},
			},
			required: ["content"],
		},
	},
	{
		name: "memory_forget",
		description:
			"Remove outdated information from long-term memory. Use when preferences change or information becomes irrelevant.",
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Keywords identifying the information to remove",
				},
			},
			required: ["query"],
		},
	},
];

// ============================================================================
// Memory Tool Implementations
// ============================================================================

/**
 * Create memory tool handlers for a workspace
 */
export function createMemoryToolHandlers(
	workspaceDir: string,
): Record<string, (params: Record<string, unknown>) => Promise<MemoryToolResult>> {
	const handlers: Record<string, (params: Record<string, unknown>) => Promise<MemoryToolResult>> = {
		memory_save: async (params: Record<string, unknown>) => {
			const content = params.content as string;
			const section = params.section as string;

			try {
				const memoryPath = join(workspaceDir, "MEMORY.md");
				let memoryContent = "";

				if (existsSync(memoryPath)) {
					memoryContent = readFileSync(memoryPath, "utf-8");
				}

				// Find or create section
				const sectionHeader = `## ${section}`;
				const timestamp = new Date().toISOString().split("T")[0];
				const newEntry = `- [${timestamp}] ${content}`;

				if (memoryContent.includes(sectionHeader)) {
					// Append to existing section
					const lines = memoryContent.split("\n");
					let sectionIndex = -1;
					let nextSectionIndex = lines.length;

					for (let i = 0; i < lines.length; i++) {
						if (lines[i] === sectionHeader) {
							sectionIndex = i;
						} else if (sectionIndex !== -1 && lines[i].startsWith("## ") && i > sectionIndex) {
							nextSectionIndex = i;
							break;
						}
					}

					if (sectionIndex !== -1) {
						lines.splice(nextSectionIndex, 0, newEntry);
						memoryContent = lines.join("\n");
					}
				} else {
					// Create new section
					if (memoryContent.trim()) {
						memoryContent += `\n\n${sectionHeader}\n${newEntry}`;
					} else {
						memoryContent = `# Long-term Memory\n\n${sectionHeader}\n${newEntry}`;
					}
				}

				writeFileSync(memoryPath, memoryContent);

				// Rebuild index
				const store = getMemoryStore(workspaceDir);
				store.indexFile(memoryPath);

				return {
					success: true,
					message: `Saved to ${section} in long-term memory`,
					data: { path: memoryPath },
				};
			} catch (error) {
				return {
					success: false,
					message: `Failed to save memory: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		},

		memory_recall: async (params: Record<string, unknown>) => {
			const query = params.query as string;
			const topK = (params.topK as number) || 5;

			try {
				const store = getMemoryStore(workspaceDir);
				const results = store.search(query, topK);

				if (results.length === 0) {
					return {
						success: true,
						message: "No relevant memories found",
						data: { results: [] },
					};
				}

				const formattedResults = results.map((r, i) => ({
					rank: i + 1,
					layer: r.chunk.layer,
					source: r.chunk.filePath,
					content: r.chunk.content.substring(0, 500) + (r.chunk.content.length > 500 ? "..." : ""),
					score: r.score.toFixed(2),
				}));

				return {
					success: true,
					message: `Found ${results.length} relevant memories`,
					data: { results: formattedResults },
				};
			} catch (error) {
				return {
					success: false,
					message: `Failed to recall memories: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		},

		memory_append_daily: async (params: Record<string, unknown>) => {
			const content = params.content as string;

			try {
				const memoryDir = join(workspaceDir, "memory");
				if (!existsSync(memoryDir)) {
					mkdirSync(memoryDir, { recursive: true });
				}

				const today = new Date().toISOString().split("T")[0];
				const dailyPath = join(memoryDir, `${today}.md`);
				const timestamp = new Date().toISOString().split("T")[1].substring(0, 5);

				const entry = `### [${timestamp}]\n${content}\n\n`;

				if (!existsSync(dailyPath)) {
					writeFileSync(dailyPath, `# Daily Log - ${today}\n\n${entry}`);
				} else {
					appendFileSync(dailyPath, entry);
				}

				// Index the new content
				const store = getMemoryStore(workspaceDir);
				store.indexFile(dailyPath);

				return {
					success: true,
					message: `Appended to daily log ${today}`,
					data: { path: dailyPath },
				};
			} catch (error) {
				return {
					success: false,
					message: `Failed to append daily log: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		},

		memory_forget: async (params: Record<string, unknown>) => {
			const query = params.query as string;

			try {
				const memoryPath = join(workspaceDir, "MEMORY.md");

				if (!existsSync(memoryPath)) {
					return {
						success: false,
						message: "No long-term memory file exists",
					};
				}

				let memoryContent = readFileSync(memoryPath, "utf-8");
				const lines = memoryContent.split("\n");
				const newLines: string[] = [];
				let removed = 0;

				for (const line of lines) {
					// Check if line contains the query (case-insensitive)
					if (line.toLowerCase().includes(query.toLowerCase())) {
						removed++;
						continue;
					}
					newLines.push(line);
				}

				if (removed === 0) {
					return {
						success: false,
						message: `No matching content found for: ${query}`,
					};
				}

				memoryContent = newLines.join("\n");
				writeFileSync(memoryPath, memoryContent);

				// Rebuild index
				const store = getMemoryStore(workspaceDir);
				store.indexFile(memoryPath);

				return {
					success: true,
					message: `Removed ${removed} line(s) containing: ${query}`,
					data: { removed },
				};
			} catch (error) {
				return {
					success: false,
					message: `Failed to forget: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		},
	};

	return handlers;
}

/**
 * Get memory tools in a format compatible with Agent tool system
 */
export function getMemoryToolsDefinition(): Array<{
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}> {
	return memoryTools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	}));
}
