# pi-feishu

A Feishu (Lark) bot that delegates messages to the pi coding agent. This is a port of [pi-mom](../mom/) for Feishu.

## Features

- AI-powered chatbot for Feishu
- Supports both group mentions and direct messages
- Rich card message support
- File attachment handling
- Docker sandbox support for isolated execution
- Event scheduling (immediate, one-shot, periodic)
- Skills system for custom tools
- Memory persistence across conversations

## Quick Start

### 1. Create a Feishu App

1. Go to [Feishu Open Platform](https://open.feishu.cn/)
2. Create a new app
3. Note your `App ID` and `App Secret`

### 2. Configure Permissions

Enable these permissions in your Feishu app:

| Permission | Description |
|------------|-------------|
| `im:message:send_as_bot` | Send messages as bot |
| `im:message.group_at_msg:readonly` | Receive group @mentions |
| `im:message.p2p_msg:readonly` | Receive direct messages |
| `im:chat:readonly` | Get chat info |
| `contact:user:readonly` | Get user info |

### 3. Configure Event Subscription

1. Set your webhook URL: `https://your-domain.com/webhook`
2. Subscribe to `im.message.receive_v1` event

### 4. Install and Run

```bash
# Clone and install
cd pi-mono/packages/pi-feishu
npm install

# Set environment variables
export FEISHU_APP_ID="cli_xxxxxx"
export FEISHU_APP_SECRET="xxxxxx"
export PORT=3000

# Run
npm run build
node dist/main.js /path/to/data
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FEISHU_APP_ID` | Yes | Feishu application ID |
| `FEISHU_APP_SECRET` | Yes | Feishu application secret |
| `PORT` | No | Server port (default: 3000) |

### Command Line Options

```bash
pi-feishu [--sandbox=host|docker:<name>] <working-directory>
```

- `--sandbox=host` - Run commands directly on host (default)
- `--sandbox=docker:<name>` - Run commands in Docker container

## Usage

### Group Chat

Mention the bot in any group chat:

```
@pi-feishu help me write a script to process CSV files
```

### Direct Message

Send a direct message to the bot:

```
What's the weather today?
```

### Stop Running Task

```
stop
```

## Workspace Structure

```
data/
├── MEMORY.md                    # Global memory
├── settings.json                # Bot settings
├── events/                      # Scheduled events
│   ├── reminder.json
│   └── periodic-check.json
├── skills/                      # Global skills
│   └── my-tool/
│       └── SKILL.md
└── <chat_id>/                   # Per-channel data
    ├── MEMORY.md                # Channel memory
    ├── log.jsonl                # Message history
    ├── context.jsonl            # LLM context
    ├── attachments/             # Downloaded files
    ├── scratch/                 # Working directory
    └── skills/                  # Channel-specific skills
```

## Skills

Skills are reusable CLI tools. Create a skill:

```
data/skills/hello/SKILL.md
```

```markdown
---
name: hello
description: Say hello to someone
---

# Hello Skill

Usage: `{baseDir}/hello.sh <name>`

Example:
```bash
/workspace/skills/hello/hello.sh World
```
```

## Events

### Immediate Event

Triggers immediately when detected:

```json
{
  "type": "immediate",
  "channelId": "oc_xxx",
  "text": "New GitHub issue opened"
}
```

### One-shot Event

Triggers once at a specific time:

```json
{
  "type": "one-shot",
  "channelId": "oc_xxx",
  "text": "Meeting reminder",
  "at": "2025-12-15T09:00:00+08:00"
}
```

### Periodic Event

Triggers on a cron schedule:

```json
{
  "type": "periodic",
  "channelId": "oc_xxx",
  "text": "Daily standup check",
  "schedule": "0 9 * * 1-5",
  "timezone": "Asia/Shanghai"
}
```

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Clean
npm run clean
```

## Differences from pi-mom

| Feature | pi-mom (Slack) | pi-feishu (Feishu) |
|---------|----------------|-------------------|
| Connection | Socket Mode (WebSocket) | Webhook (HTTP) |
| Message Format | mrkdwn | Lark Markdown |
| Card Messages | Block Kit | Feishu Card |
| Auth | Bot Token + App Token | App ID + App Secret |

## License

MIT
