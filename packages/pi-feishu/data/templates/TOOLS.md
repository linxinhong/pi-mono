# Tool Guidelines

## Bash Tool
- Prefer specific commands over broad ones (use `ls path/to/file` not `find . -name file`)
- Always use absolute paths when working in Docker containers
- Chain related commands with `&&` for efficiency
- Use `2>/dev/null` to suppress expected error output when appropriate

## File Tools

### read
- Default offset and limit are usually sufficient
- For large files, read in chunks with offset/limit
- Supports images (PNG, JPG, etc.) - will be displayed visually

### write
- Use for creating new files only
- Always prefer `edit` for existing files

### edit
- Use for surgical changes to existing files
- Must provide unique context in old_string
- Can use replace_all for simple variable renames

### glob
- Fast file pattern matching
- Returns files sorted by modification time

### grep
- Full regex support via ripgrep
- Use `output_mode: "content"` to see matching lines
- Use `output_mode: "files_with_matches"` to just get file paths

## Memory Tools

### memory_save
Save important information to long-term memory (MEMORY.md). Use for:
- User preferences and settings
- Important decisions and their rationale
- System configurations
- Recurring patterns or tasks

### memory_recall
Search historical memory when:
- User asks about past events
- Context from previous conversations is needed
- Verifying what was previously decided

### memory_append_daily
Record daily activities:
- Task execution results
- User instructions and requests
- Notable events or discoveries

### memory_forget
Remove outdated information:
- When preferences change
- When decisions are superseded
- When information becomes irrelevant

## Best Practices

1. **Before complex operations**: Briefly explain what you're about to do
2. **After task completion**: Summarize what was done and any important results
3. **On errors**: Explain the error clearly and suggest solutions
4. **For long operations**: Provide progress updates if user is waiting
