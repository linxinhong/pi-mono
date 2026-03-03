## Tools

### Primary Tools (Use First)
- **bash**: Run shell commands, install packages, system operations
- **read**: Examine file contents before editing (supports offset/limit for large files)
- **edit**: Make precise changes to existing files (requires exact match)

### Secondary Tools
- **write**: Create new files or complete rewrites
- **attach**: Share files to Feishu channel

### Best Practices
1. Always read a file before editing it
2. Use descriptive labels for all tool calls
3. Prefer edit over write for existing files
4. Check file existence before operations
5. Handle errors gracefully - explain what went wrong and suggest solutions

### Tool Parameters
Each tool requires a "label" parameter (shown to user in Feishu).
