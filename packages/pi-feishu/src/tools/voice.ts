import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { basename, resolve as resolvePath } from "path";

let sendVoiceFn: ((filePath: string) => Promise<string>) | null = null;

export function setSendVoiceFunction(fn: (filePath: string) => Promise<string>): void {
	sendVoiceFn = fn;
}

const voiceSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're saying (shown to user)" }),
	path: Type.String({ description: "Path to the audio file to send as voice message" }),
});

export const voiceTool: AgentTool<typeof voiceSchema> = {
	name: "voice",
	label: "voice",
	description:
		"Send an audio file as a voice message. Supports opus, mp3, wav, m4a formats. Only files from /workspace/ can be sent.",
	parameters: voiceSchema,
	execute: async (_toolCallId: string, { path }: { label: string; path: string }, signal?: AbortSignal) => {
		if (!sendVoiceFn) {
			throw new Error("Send voice function not configured");
		}

		if (signal?.aborted) {
			throw new Error("Operation aborted");
		}

		const absolutePath = resolvePath(path);
		const fileName = basename(absolutePath);

		const messageId = await sendVoiceFn(absolutePath);

		return {
			content: [{ type: "text" as const, text: `Sent voice message: ${fileName}` }],
			details: { messageId },
		};
	},
};
