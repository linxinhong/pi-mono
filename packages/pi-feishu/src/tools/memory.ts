/**
 * Memory Tools for Feishu Bot
 *
 * These tools allow the AI to actively manage its own memory through tool calling.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import * as log from "../log.js";
import { getMemoryStore } from "../memory/store.js";

// ============================================================================
// Schemas
// ============================================================================

const memorySaveSchema = Type.Object({
	content: Type.String({ description: "The information to save (concise and factual)" }),
	section: Type.Union(
		[
			Type.Literal("User Preferences"),
			Type.Literal("System Knowledge"),
			Type.Literal("Recurring Tasks"),
			Type.Literal("Important Decisions"),
		],
		{ description: "Which section to save to" },
	),
});

const memoryRecallSchema = Type.Object({
	query: Type.String({ description: "Search keywords or question" }),
	topK: Type.Optional(Type.Number({ description: "Number of results to return (default 5)" })),
});

const memoryAppendDailySchema = Type.Object({
	content: Type.String({ description: "The content to log (concise, factual)" }),
});

const memoryForgetSchema = Type.Object({
	query: Type.String({ description: "Keywords identifying the information to remove" }),
});

// ============================================================================
// Helper Functions
// ============================================================================

function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function getToday(): string {
	return new Date().toISOString().split("T")[0];
}

function getTimestamp(): string {
	return new Date().toISOString().split("T")[1].substring(0, 5);
}

// ============================================================================
// Memory Tool Creators
// ============================================================================

export function createMemorySaveTool(workspaceDir: string): AgentTool<typeof memorySaveSchema> {
	return {
		name: "memory_save",
		label: "Save Memory",
		description:
			"Save important information to long-term memory (MEMORY.md). Use for user preferences, system configurations, important decisions, or recurring patterns.",
		parameters: memorySaveSchema,
		execute: async (_toolCallId: string, args: { content: string; section: string }) => {
			const memoryPath = join(workspaceDir, "MEMORY.md");
			const timestamp = getToday();

			try {
				let memoryContent = "";
				if (existsSync(memoryPath)) {
					memoryContent = readFileSync(memoryPath, "utf-8");
				}

				const sectionHeader = `## ${args.section}`;
				const newEntry = `- [${timestamp}] ${args.content}`;

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

				// Update index
				const store = getMemoryStore(workspaceDir);
				store.indexFile(memoryPath);

				log.logInfo(`Memory saved to ${args.section}`);

				return {
					content: [{ type: "text", text: `Saved to ${args.section} in long-term memory` }],
					details: { success: true, section: args.section },
				};
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);
				log.logWarning("Failed to save memory", errMsg);
				return {
					content: [{ type: "text", text: `Failed to save memory: ${errMsg}` }],
					details: { success: false, error: errMsg },
				};
			}
		},
	};
}

export function createMemoryRecallTool(workspaceDir: string): AgentTool<typeof memoryRecallSchema> {
	return {
		name: "memory_recall",
		label: "Recall Memory",
		description:
			"Search historical memories. Use when user mentions past events or when historical context is needed.",
		parameters: memoryRecallSchema,
		execute: async (_toolCallId: string, args: { query: string; topK?: number }) => {
			try {
				const store = getMemoryStore(workspaceDir);
				const results = store.search(args.query, args.topK || 5);

				if (results.length === 0) {
					return {
						content: [{ type: "text", text: "No relevant memories found" }],
						details: { success: true, results: [] },
					};
				}

				const formattedResults = results.map((r, i) => ({
					rank: i + 1,
					source: r.chunk.filePath,
					content: r.chunk.content.substring(0, 500) + (r.chunk.content.length > 500 ? "..." : ""),
					score: r.score.toFixed(2),
				}));

				const resultText = formattedResults
					.map((r) => `[${r.rank}] Score: ${r.score}\nSource: ${r.source}\n${r.content}`)
					.join("\n\n");

				log.logInfo(`Memory recall: found ${results.length} results for "${args.query}"`);

				return {
					content: [{ type: "text", text: `Found ${results.length} relevant memories:\n\n${resultText}` }],
					details: { success: true, results: formattedResults },
				};
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);
				log.logWarning("Failed to recall memories", errMsg);
				return {
					content: [{ type: "text", text: `Failed to recall memories: ${errMsg}` }],
					details: { success: false, error: errMsg },
				};
			}
		},
	};
}

export function createMemoryAppendDailyTool(workspaceDir: string): AgentTool<typeof memoryAppendDailySchema> {
	return {
		name: "memory_append_daily",
		label: "Append Daily Log",
		description:
			"Append a record to today's daily log. Use for task execution results, user instructions, notable events.",
		parameters: memoryAppendDailySchema,
		execute: async (_toolCallId: string, args: { content: string }) => {
			try {
				const memoryDir = join(workspaceDir, "memory");
				ensureDir(memoryDir);

				const today = getToday();
				const dailyPath = join(memoryDir, `${today}.md`);
				const timestamp = getTimestamp();

				const entry = `### [${timestamp}]\n${args.content}\n\n`;

				if (!existsSync(dailyPath)) {
					writeFileSync(dailyPath, `# Daily Log - ${today}\n\n${entry}`);
				} else {
					appendFileSync(dailyPath, entry);
				}

				// Index the new content
				const store = getMemoryStore(workspaceDir);
				store.indexFile(dailyPath);

				log.logInfo(`Daily log appended: ${args.content.substring(0, 50)}...`);

				return {
					content: [{ type: "text", text: `Appended to daily log ${today}` }],
					details: { success: true, date: today },
				};
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);
				log.logWarning("Failed to append daily log", errMsg);
				return {
					content: [{ type: "text", text: `Failed to append daily log: ${errMsg}` }],
					details: { success: false, error: errMsg },
				};
			}
		},
	};
}

export function createMemoryForgettingTool(workspaceDir: string): AgentTool<typeof memoryForgetSchema> {
	return {
		name: "memory_forget",
		label: "Forget Memory",
		description:
			"Remove outdated information from long-term memory. Use when preferences change or information becomes irrelevant.",
		parameters: memoryForgetSchema,
		execute: async (_toolCallId: string, args: { query: string }) => {
			try {
				const memoryPath = join(workspaceDir, "MEMORY.md");

				if (!existsSync(memoryPath)) {
					return {
						content: [{ type: "text", text: "No long-term memory file exists" }],
						details: { success: false, reason: "no_file" },
					};
				}

				let memoryContent = readFileSync(memoryPath, "utf-8");
				const lines = memoryContent.split("\n");
				const newLines: string[] = [];
				let removed = 0;

				for (const line of lines) {
					if (line.toLowerCase().includes(args.query.toLowerCase())) {
						removed++;
						continue;
					}
					newLines.push(line);
				}

				if (removed === 0) {
					return {
						content: [{ type: "text", text: `No matching content found for: ${args.query}` }],
						details: { success: false, reason: "not_found" },
					};
				}

				memoryContent = newLines.join("\n");
				writeFileSync(memoryPath, memoryContent);

				// Rebuild index
				const store = getMemoryStore(workspaceDir);
				store.indexFile(memoryPath);

				log.logInfo(`Memory forgotten: removed ${removed} line(s) for "${args.query}"`);

				return {
					content: [{ type: "text", text: `Removed ${removed} line(s) containing: ${args.query}` }],
					details: { success: true, removed },
				};
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);
				log.logWarning("Failed to forget memory", errMsg);
				return {
					content: [{ type: "text", text: `Failed to forget: ${errMsg}` }],
					details: { success: false, error: errMsg },
				};
			}
		},
	};
}

// ============================================================================
// Combined Memory Tools Creator
// ============================================================================

export function createMemoryTools(workspaceDir: string): AgentTool<any>[] {
	return [
		createMemorySaveTool(workspaceDir),
		createMemoryRecallTool(workspaceDir),
		createMemoryAppendDailyTool(workspaceDir),
		createMemoryForgettingTool(workspaceDir),
	];
}
