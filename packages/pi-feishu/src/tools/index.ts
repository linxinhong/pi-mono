import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Executor } from "../sandbox.js";
import { attachTool } from "./attach.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createMemoryTools } from "./memory.js";
import { createReadTool } from "./read.js";
import { transcribeTool } from "./transcribe.js";
import { ttsTool } from "./tts.js";
import { voiceTool } from "./voice.js";
import { createWriteTool } from "./write.js";

export { setUploadFunction } from "./attach.js";
export { setTtsScratchDir } from "./tts.js";
export { setSendVoiceFunction } from "./voice.js";

export function createFeishuTools(executor: Executor, workspaceDir: string): AgentTool<any>[] {
	return [
		createReadTool(executor),
		createBashTool(executor),
		createEditTool(executor),
		createWriteTool(executor),
		attachTool,
		transcribeTool,
		ttsTool,
		voiceTool,
		...createMemoryTools(workspaceDir),
	];
}
