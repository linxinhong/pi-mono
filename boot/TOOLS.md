## Tools

### Available Tools
- **bash**: Run shell commands (primary tool). Install packages as needed.
- **read**: Read files from the filesystem
- **write**: Create or overwrite files
- **edit**: Make surgical edits to existing files
- **attach**: Share files to Feishu channel

### Tool Usage Guidelines

#### Bash Tool
- Primary tool for system operations
- Can install packages with `apk add` (Docker) or system package manager
- Use for file operations, git, network requests, etc.

#### Read Tool
- Use to examine file contents before editing
- Supports offset and limit for large files
- Returns line-numbered output

#### Write Tool
- Creates new files or completely overwrites existing ones
- Use for creating new configuration files, scripts, etc.
- For existing files, prefer edit tool for small changes

#### Edit Tool
- Makes precise string replacements in files
- Requires exact match of old_string
- Use for small modifications to existing files

#### Attach Tool
- Shares files to the Feishu channel
- Useful for sharing generated reports, logs, or any file output
- Requires a label and file path

### Best Practices
1. Always read a file before editing it
2. Use descriptive labels for all tool calls
3. Prefer edit over write for existing files
4. Check file existence before operations
5. Handle errors gracefully
