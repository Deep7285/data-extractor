# 🚀 Quick Start — Chat Sync

## For Immediate Use

### 1. Load chat history + start Claude CLI

**Windows (PowerShell):**
```powershell
.\claude-with-context.ps1
```

**macOS/Linux:**
```bash
node claude-terminal-client.mjs
```

### 2. Load chat history + ask a question

**Windows:**
```powershell
.\claude-with-context.ps1 -Query "Help me debug this issue"
```

**macOS/Linux:**
```bash
node claude-terminal-client.mjs --query "Help me debug this issue"
```

---

## Integration with Your Web App

### Add to index.html (before `</body>`):
```html
<script src="frontend/chat-sync.js"></script>
```

### Capture messages from your chat UI:
```javascript
// After user sends a message:
chatHistory.addMessage("user", userMessageText);

// After Claude responds:
chatHistory.addMessage("assistant", responseText);
```

---

## File Structure Created

```
invoice-worker/
├── chat-history.json              ← Stores conversation history
├── CHAT_SYNC_SETUP.md            ← Full documentation (you're reading the quick version)
├── QUICK_START.md                ← This file
├── claude-with-context.ps1       ← PowerShell launcher (Windows)
├── claude-terminal-client.mjs    ← Node.js launcher (any OS)
├── frontend/
│   └── chat-sync.js              ← Web capture + storage logic
└── src/
    └── worker.ts                 ← Updated with /api/sync-chat-history endpoint
```

---

## How It Works

1. **Web Interface** → Messages saved to `chat-history.json` and browser localStorage
2. **Terminal Script** → Loads `chat-history.json` as context
3. **Claude CLI** → Starts with all conversation history preloaded
4. **You Debug** → Claude understands full context from web chat

---

## Example Workflow

```
[Web Chat]
You:     "Why is GSTIN extraction failing?"
Claude:  "Check the regex pattern in schema_and_prompt.ts"

[Terminal]
$ .\claude-with-context.ps1 -Query "I found the issue in line 45. How to fix?"

[Claude Terminal - with web context loaded]
Claude: "Based on our discussion, the issue is... 
         Here's the fix for line 45 in schema_and_prompt.ts..."
```

---

## Requirements

- **Claude CLI** installed: `npm install -g claude-cli` (or use `claude` command)
- **Node.js** (for .mjs script)
- **PowerShell 5+** (Windows) or bash (macOS/Linux)

---

## Troubleshooting

**"Chat history not found" error:**
1. Make sure you've added messages to the chat
2. Verify `chat-history.json` exists in project root
3. Run: `node claude-terminal-client.mjs` to verify it can load

**Claude not starting:**
1. Check Claude CLI is installed: `which claude`
2. Test manually: `echo "Hello" | claude`

**Messages not being captured:**
1. Open browser DevTools → Console
2. Run: `chatHistory.addMessage("user", "test")`
3. Verify file updates: `cat chat-history.json`

---

For detailed setup and advanced usage, see **CHAT_SYNC_SETUP.md**
