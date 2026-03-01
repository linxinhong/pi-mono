/**
 * Memory Indexer - File watcher and index manager
 *
 * Watches memory files for changes and updates the SQLite index accordingly.
 */

import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import { join } from "path";
import * as log from "../log.js";
import { getMemoryStore } from "./store.js";

// ============================================================================
// Types
// ============================================================================

export interface IndexerConfig {
	workspaceDir: string;
}

// ============================================================================
// Memory Indexer
// ============================================================================

export class MemoryIndexer {
	private watcher: FSWatcher | null = null;
	private _workspaceDir: string;
	private store: ReturnType<typeof getMemoryStore>;
	private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

	constructor(config: IndexerConfig) {
		this._workspaceDir = config.workspaceDir;
		this.store = getMemoryStore(config.workspaceDir);
	}

	/** Get the workspace directory */
	get workspaceDir(): string {
		return this._workspaceDir;
	}

	/**
	 * Start watching memory files
	 */
	start(): void {
		const memoryFiles = [join(this.workspaceDir, "*.md"), join(this.workspaceDir, "memory/**/*.md")];

		this.watcher = chokidarWatch(memoryFiles, {
			ignored: [/(^|[/\\])\../, /node_modules/, /dist/],
			persistent: true,
			ignoreInitial: false,
		});

		this.watcher
			.on("add", (path) => this.handleFileChange(path, "add"))
			.on("change", (path) => this.handleFileChange(path, "change"))
			.on("unlink", (path) => this.handleFileChange(path, "unlink"));

		log.logInfo(`Memory indexer started, watching: ${this.workspaceDir}`);
	}

	/**
	 * Stop watching
	 */
	stop(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}

		// Clear debounce timers
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();
	}

	/**
	 * Handle file change with debouncing
	 */
	private handleFileChange(filePath: string, event: string): void {
		// Clear existing timer
		const existing = this.debounceTimers.get(filePath);
		if (existing) {
			clearTimeout(existing);
		}

		// Debounce: wait 500ms before processing
		this.debounceTimers.set(
			filePath,
			setTimeout(() => {
				this.debounceTimers.delete(filePath);
				this.processFileChange(filePath, event);
			}, 500),
		);
	}

	/**
	 * Process file change
	 */
	private processFileChange(filePath: string, event: string): void {
		try {
			if (event === "unlink") {
				this.store.removeFile(filePath);
				log.logInfo(`Memory index removed: ${filePath}`);
			} else {
				this.store.indexFile(filePath);
				log.logInfo(`Memory index updated: ${filePath}`);
			}
		} catch (error) {
			log.logWarning(
				`Failed to update memory index: ${filePath}`,
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	/**
	 * Force rebuild of entire index
	 */
	rebuildIndex(): void {
		log.logInfo("Rebuilding memory index...");
		this.store.rebuildIndex();
		log.logInfo("Memory index rebuilt");
	}

	/**
	 * Get indexer statistics
	 */
	getStats(): { totalChunks: number; byLayer: Record<string, number> } {
		return this.store.getStats();
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

let indexerInstance: MemoryIndexer | null = null;

export function getMemoryIndexer(workspaceDir: string): MemoryIndexer {
	if (indexerInstance && indexerInstance.workspaceDir === workspaceDir) {
		return indexerInstance;
	}

	if (indexerInstance) {
		indexerInstance.stop();
	}

	indexerInstance = new MemoryIndexer({ workspaceDir });
	return indexerInstance;
}

export function stopMemoryIndexer(): void {
	if (indexerInstance) {
		indexerInstance.stop();
		indexerInstance = null;
	}
}
