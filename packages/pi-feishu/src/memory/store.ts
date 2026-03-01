/**
 * Memory Store - SQLite + FTS5 storage layer
 *
 * Zero-dependency memory indexing using SQLite FTS5 for full-text search.
 * Files are the source of truth; SQLite is a derived index that can be rebuilt.
 */

import BetterSqlite3 from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";

// ============================================================================
// Types
// ============================================================================

export interface MemoryChunk {
	id: number;
	filePath: string;
	chunkIndex: number;
	content: string;
	layer: "longterm" | "daily" | "profile";
	createdAt: number;
	recallCount: number;
}

export interface SearchResult {
	chunk: MemoryChunk;
	score: number;
}

export interface MemoryStoreConfig {
	workspaceDir: string;
}

// ============================================================================
// Memory Store
// ============================================================================

export class MemoryStore {
	private db: BetterSqlite3.Database;
	private dbPath: string;
	private _workspaceDir: string;

	constructor(config: MemoryStoreConfig) {
		this._workspaceDir = config.workspaceDir;
		this.dbPath = join(config.workspaceDir, ".memory-index", "memory.db");

		// Ensure directory exists
		const dbDir = dirname(this.dbPath);
		if (!existsSync(dbDir)) {
			mkdirSync(dbDir, { recursive: true });
		}

		// Initialize database
		this.db = new BetterSqlite3(this.dbPath);
		this.initializeSchema();
	}

	/** Get the workspace directory */
	get workspaceDir(): string {
		return this._workspaceDir;
	}

	/**
	 * Initialize SQLite schema with FTS5
	 */
	private initializeSchema(): void {
		this.db.exec(`
			-- Memory chunks table
			CREATE TABLE IF NOT EXISTS memory_chunks (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				file_path   TEXT NOT NULL,
				chunk_index INTEGER NOT NULL,
				content     TEXT NOT NULL,
				layer       TEXT NOT NULL,
				created_at  INTEGER DEFAULT (strftime('%s', 'now')),
				recall_count INTEGER DEFAULT 0,
				UNIQUE(file_path, chunk_index)
			);

			-- FTS5 virtual table for full-text search
			CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
				content,
				content='memory_chunks',
				content_rowid='id',
				tokenize='unicode61'
			);

			-- Triggers to keep FTS5 in sync
			CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memory_chunks BEGIN
				INSERT INTO memory_fts(rowid, content) VALUES (NEW.id, NEW.content);
			END;

			CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memory_chunks BEGIN
				INSERT INTO memory_fts(memory_fts, rowid, content) VALUES('delete', OLD.id, OLD.content);
			END;

			CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON memory_chunks BEGIN
				INSERT INTO memory_fts(memory_fts, rowid, content) VALUES('delete', OLD.id, OLD.content);
				INSERT INTO memory_fts(rowid, content) VALUES (NEW.id, NEW.content);
			END;
		`);
	}

	/**
	 * Chunk text into ~400 token pieces (rough estimate: 1 token ~= 4 chars)
	 */
	private chunkText(text: string, maxChunkSize: number = 1600): string[] {
		const chunks: string[] = [];
		const paragraphs = text.split(/\n\n+/);
		let currentChunk = "";

		for (const para of paragraphs) {
			// If adding this paragraph would exceed limit, start new chunk
			if (currentChunk.length + para.length + 2 > maxChunkSize && currentChunk.length > 0) {
				chunks.push(currentChunk.trim());
				currentChunk = para;
			} else {
				currentChunk += (currentChunk ? "\n\n" : "") + para;
			}
		}

		if (currentChunk.trim()) {
			chunks.push(currentChunk.trim());
		}

		return chunks.length > 0 ? chunks : [text];
	}

	/**
	 * Determine memory layer from file path
	 */
	private getLayer(filePath: string): "longterm" | "daily" | "profile" {
		if (filePath.includes("/memory/")) {
			if (filePath.includes("/compressed/")) {
				return "longterm";
			}
			return "daily";
		}
		if (filePath.includes("/boot/profile.md")) {
			return "profile";
		}
		return "longterm";
	}

	/**
	 * Index a file: chunk it and store in SQLite
	 */
	indexFile(filePath: string): void {
		if (!existsSync(filePath)) {
			// File doesn't exist, remove from index
			this.removeFile(filePath);
			return;
		}

		const content = readFileSync(filePath, "utf-8").trim();
		if (!content) {
			this.removeFile(filePath);
			return;
		}

		const relativePath = filePath.replace(this.workspaceDir, "").replace(/^\//, "");
		const layer = this.getLayer(filePath);
		const chunks = this.chunkText(content);

		// Use transaction for atomic update
		const transaction = this.db.transaction(() => {
			// Remove old chunks for this file
			this.db.prepare("DELETE FROM memory_chunks WHERE file_path = ?").run(relativePath);

			// Insert new chunks
			const insertStmt = this.db.prepare(`
				INSERT INTO memory_chunks (file_path, chunk_index, content, layer)
				VALUES (?, ?, ?, ?)
			`);

			for (let i = 0; i < chunks.length; i++) {
				insertStmt.run(relativePath, i, chunks[i], layer);
			}
		});

		transaction();
	}

	/**
	 * Remove a file from the index
	 */
	removeFile(filePath: string): void {
		const relativePath = filePath.replace(this.workspaceDir, "").replace(/^\//, "");
		this.db.prepare("DELETE FROM memory_chunks WHERE file_path = ?").run(relativePath);
	}

	/**
	 * Rebuild the entire index from all memory files
	 */
	rebuildIndex(): void {
		const transaction = this.db.transaction(() => {
			// Clear existing index
			this.db.exec("DELETE FROM memory_chunks");

			// Index all memory files
			const memoryFiles = this.findMemoryFiles();
			for (const file of memoryFiles) {
				this.indexFile(file);
			}
		});

		transaction();
	}

	/**
	 * Find all memory files in workspace
	 */
	private findMemoryFiles(): string[] {
		const files: string[] = [];

		// Boot directory files (identity and behavior)
		const bootDir = join(this.workspaceDir, "boot");
		if (existsSync(bootDir)) {
			const bootFiles = ["profile.md", "soul.md", "identity.md", "tools.md"];
			for (const file of bootFiles) {
				const path = join(bootDir, file);
				if (existsSync(path)) {
					files.push(path);
				}
			}
		}

		// Memory directory (long-term memory, daily logs and compressed)
		const memoryDir = join(this.workspaceDir, "memory");
		if (existsSync(memoryDir)) {
			const addFromDir = (dir: string) => {
				const items = readdirSync(dir, { withFileTypes: true });
				for (const item of items) {
					const fullPath = join(dir, item.name);
					if (item.isDirectory()) {
						addFromDir(fullPath);
					} else if (item.name.endsWith(".md")) {
						files.push(fullPath);
					}
				}
			};
			addFromDir(memoryDir);
		}

		return files;
	}

	/**
	 * Search memory using FTS5 full-text search
	 */
	search(query: string, topK: number = 5): SearchResult[] {
		// Increment recall count for accessed chunks
		const updateStmt = this.db.prepare(`
			UPDATE memory_chunks SET recall_count = recall_count + 1 WHERE id = ?
		`);

		// FTS5 search with BM25 ranking
		const results = this.db
			.prepare(`
			SELECT
				m.id,
				m.file_path,
				m.chunk_index,
				m.content,
				m.layer,
				m.created_at,
				m.recall_count,
				bm25(memory_fts) as score
			FROM memory_fts
			JOIN memory_chunks m ON memory_fts.rowid = m.id
			WHERE memory_fts MATCH ?
			ORDER BY score ASC
			LIMIT ?
		`)
			.all(query, topK) as Array<{
			id: number;
			file_path: string;
			chunk_index: number;
			content: string;
			layer: string;
			created_at: number;
			recall_count: number;
			score: number;
		}>;

		return results.map((row) => {
			// Update recall count
			updateStmt.run(row.id);

			return {
				chunk: {
					id: row.id,
					filePath: row.file_path,
					chunkIndex: row.chunk_index,
					content: row.content,
					layer: row.layer as "longterm" | "daily" | "profile",
					createdAt: row.created_at,
					recallCount: row.recall_count,
				},
				// BM25 returns negative scores; negate for consistency
				score: -row.score,
			};
		});
	}

	/**
	 * Get all chunks for a specific file
	 */
	getFileChunks(filePath: string): MemoryChunk[] {
		const relativePath = filePath.replace(this.workspaceDir, "").replace(/^\//, "");
		return this.db
			.prepare(`
			SELECT id, file_path, chunk_index, content, layer, created_at, recall_count
			FROM memory_chunks
			WHERE file_path = ?
			ORDER BY chunk_index
		`)
			.all(relativePath) as MemoryChunk[];
	}

	/**
	 * Close database connection
	 */
	close(): void {
		this.db.close();
	}

	/**
	 * Get database statistics
	 */
	getStats(): { totalChunks: number; byLayer: Record<string, number> } {
		const totalChunks = (this.db.prepare("SELECT COUNT(*) as count FROM memory_chunks").get() as { count: number })
			.count;

		const layers = this.db
			.prepare(`
			SELECT layer, COUNT(*) as count
			FROM memory_chunks
			GROUP BY layer
		`)
			.all() as Array<{ layer: string; count: number }>;

		const byLayer: Record<string, number> = {};
		for (const row of layers) {
			byLayer[row.layer] = row.count;
		}

		return { totalChunks, byLayer };
	}
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get or create a MemoryStore instance for a workspace
 */
let storeInstance: MemoryStore | null = null;

export function getMemoryStore(workspaceDir: string): MemoryStore {
	if (storeInstance && storeInstance.workspaceDir === workspaceDir) {
		return storeInstance;
	}

	if (storeInstance) {
		storeInstance.close();
	}

	storeInstance = new MemoryStore({ workspaceDir });
	return storeInstance;
}
