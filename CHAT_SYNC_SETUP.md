# 🔗 Web-to-Terminal Chat Sync Guide

## Overview

This system allows you to:
1. **Capture chat conversations from your web interface**
2. **Save them to a JSON file** automatically
3. **Load that history into Claude CLI in terminal** with full context
4. **Continue debugging/fixing issues** using Claude in the terminal with web chat context

---

## Setup Steps

### Step 1: Add Chat Sync to Your Web Interface

Add this script tag to your `index.html` **before** closing `</body>`:

```html
<!-- Chat history sync -->
<script src="frontend/chat-sync.js"></script>
```

### Step 2: Capture Chat Messages

Modify your web interface to feed messages into the chat history. Here are different approaches:

#### Option A: Manual Logging (Simplest)

If you have a chat display element, add this after each message appears:

```javascript
// After a user message appears:
chatHistory.addMessage("user", "User's message text here");

// After Claude responds:
chatHistory.addMessage("assistant", "Claude's response here");
```

#### Option B: Observe DOM Changes (Automatic)

The `chat-sync.js` already includes a `hookChatDisplay()` function. Update the selectors to match your DOM:

```javascript
// In your index.html or where you display messages:
const messageEl = document.createElement('div');
messageEl.setAttribute('data-message', 'true');
messageEl.setAttribute('data-role', 'user'); // or 'assistant'
messageEl.textContent = "Your message";
chatContainer.appendChild(messageEl);
```

#### Option C: Intercept API Calls (Most Elegant)

Hook into your fetch/API calls:

```javascript
// Wrap your original API call
const originalFetch = window.fetch;
window.fetch = function(...args) {
  return originalFetch.apply(this, args).then(response => {
    // If this is a chat API, capture the message
    if (args[0].includes('/chat')) {
      response.clone().json().then(data => {
        if (data.message) {
          chatHistory.addMessage("assistant", data.message);
        }
      });
    }
    return response;
  });
};
```

### Step 3: Export Chat History

Once messages are captured, they automatically save to localStorage. To export to file:

```javascript
// In browser console:
const historyJson = JSON.stringify(chatHistory.history, null, 2);
console.log(historyJson);

// Then copy and save to chat-history.json in your project root
```

Or manually trigger sync:

```javascript
chatHistory.syncToFile(); // Sends to backend API
```

---

## Using Claude CLI with Web Chat Context

### Method 1: PowerShell Script (Windows)

**Simple usage:**
```powershell
.\claude-with-context.ps1
```

This loads chat history and starts Claude CLI with the context preloaded.

**With a specific query:**
```powershell
.\claude-with-context.ps1 -Query "Why is the invoice extraction failing on PDFs?"
```

### Method 2: Node.js Script (Cross-platform)

**Interactive mode:**
```bash
node claude-terminal-client.mjs
```

**With a query:**
```bash
node claude-terminal-client.mjs --query "How do I fix the GSTIN extraction?"
```

### Method 3: Direct Terminal Command

If you have Claude CLI installed:

```bash
# Load history as context
cat chat-history.json | claude "Here's my chat history. Based on this, help me fix..."
```

---

## Workflow Example

### Scenario: Debugging Invoice Extraction

1. **In Web Interface** (while troubleshooting):
   ```
   User: "Why are invoices failing to extract?"
   Claude: "Could be a PDF encoding issue. Check the error logs."
   User: "Got it, let me look at the logs"
   Claude: "Great. Try extracting a test PDF with verbose logging enabled."
   ```

2. **Switch to Terminal** (with full context):
   ```powershell
   .\claude-with-context.ps1 -Query "I found the issue in worker.ts line 331. How should I fix it?"
   ```

3. **Claude in Terminal** sees entire conversation history and helps you:
   - Understand the issue in context
   - Suggest specific code fixes
   - Test the changes
   - Verify the solution

---

## File Locations

- **Chat history:** `chat-history.json` (project root)
- **Web sync script:** `frontend/chat-sync.js`
- **PowerShell launcher:** `claude-with-context.ps1`
- **Node.js launcher:** `claude-terminal-client.mjs`
- **Backend sync endpoint:** `src/worker.ts` → `/api/sync-chat-history`

---

## API Reference

### Backend Endpoint

**POST `/api/sync-chat-history`**

Saves chat history to Cloudflare KV storage for persistent access.

**Request:**
```json
{
  "version": "1.0",
  "conversations": [
    {
      "id": "conv-1",
      "timestamp": "2026-04-28T...",
      "platform": "web",
      "messages": [
        {
          "role": "user",
          "content": "Message text",
          "timestamp": "2026-04-28T..."
        }
      ]
    }
  ],
  "lastUpdated": "2026-04-28T...",
  "activeConversationId": "conv-1"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Chat history synced"
}
```

---

## Troubleshooting

### Chat history not appearing in terminal

1. Check `chat-history.json` exists in project root:
   ```bash
   ls chat-history.json
   ```

2. Verify it has content:
   ```bash
   cat chat-history.json
   ```

3. If empty, manually capture messages:
   ```javascript
   chatHistory.addMessage("user", "Your message");
   chatHistory.addMessage("assistant", "Response");
   chatHistory.saveHistory();
   ```

### Claude not starting in terminal

- Install Claude CLI: `npm install -g claude-cli`
- Ensure you have `claude` command available:
  ```bash
  which claude
  ```

### PowerShell script permission denied

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
.\claude-with-context.ps1
```

---

## Advanced Usage

### Get formatted context without starting Claude

```javascript
// In browser console:
console.log(chatHistory.getFormattedContext());
```

### Export as Markdown

```javascript
// Create a markdown file with the chat history
const md = chatHistory.getAsMarkdown();
// Save as chat-history.md
```

### Multiple Conversations

The system supports multiple conversations:

```javascript
// Get a specific conversation
const conv = chatHistory.history.conversations[0];

// Switch active conversation
chatHistory.history.activeConversationId = "conv-2";
chatHistory.saveHistory();
```

### Programmatic Access from Terminal

```javascript
// claude-terminal-client.mjs automatically:
// 1. Loads chat-history.json
// 2. Formats all messages as context
// 3. Passes to Claude CLI
// 4. Keeps stdin open for your queries
```

---

## Security Notes

- ✅ Chat history stored locally (no external uploads unless you sync)
- ✅ Backend KV storage auto-expires after 7 days
- ✅ All API calls use httpOnly cookies for auth
- ⚠️ Don't store sensitive API keys in chat history
- ⚠️ Review history before sharing with others

---

## Next Steps

1. Add `chat-sync.js` to your `index.html`
2. Set up message capture (choose Option A, B, or C above)
3. Test by running: `.\claude-with-context.ps1`
4. Deploy changes to Cloudflare Workers

Good luck with your invoice extraction debugging! 🚀
