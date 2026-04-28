#!/usr/bin/env node
// claude-terminal-client.mjs — CLI to load web chat history and interact with Claude
// Usage: node claude-terminal-client.mjs [--query "your question"]

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHAT_HISTORY_PATH = path.join(__dirname, "chat-history.json");

// Color codes for terminal
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  bold: "\x1b[1m"
};

function log(msg, color = "reset") {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

async function loadChatHistory() {
  if (!fs.existsSync(CHAT_HISTORY_PATH)) {
    log(`⚠️  Chat history not found at ${CHAT_HISTORY_PATH}`, "yellow");
    return null;
  }

  try {
    const data = fs.readFileSync(CHAT_HISTORY_PATH, "utf8");
    const history = JSON.parse(data);
    return history;
  } catch (err) {
    log(`✗ Failed to load chat history: ${err.message}`, "red");
    return null;
  }
}

function formatHistoryAsContext(history) {
  if (!history || !history.conversations || history.conversations.length === 0) {
    return "";
  }

  let activeConv = history.conversations.find(c => c.id === history.activeConversationId);
  if (!activeConv) {
    activeConv = history.conversations[0];
  }

  let context = `## 📋 Chat History from Web Interface\n`;
  context += `**Last Updated:** ${history.lastUpdated}\n`;
  context += `**Conversation:** ${activeConv.id}\n`;
  context += `**Messages:** ${activeConv.messages.length}\n\n`;
  context += `---\n\n`;

  activeConv.messages.forEach((msg, idx) => {
    const roleUpper = msg.role.toUpperCase();
    context += `**[${idx + 1}] ${roleUpper}:**\n\n${msg.content}\n\n---\n\n`;
  });

  return context;
}

async function runClaudeWithContext(query = null) {
  // Load chat history
  const history = await loadChatHistory();
  let context = history ? formatHistoryAsContext(history) : "";

  if (history) {
    const activeConv = history.conversations.find(c => c.id === history.activeConversationId) || history.conversations[0];
    log(`✓ Loaded chat history (${activeConv.messages.length} messages)`, "green");
  } else {
    log(`ℹ No previous chat history`, "gray");
  }

  log(`---`, "gray");

  // If query provided, process it with context
  if (query) {
    const fullPrompt = context ? `${context}\n\n---\n\nNEW QUESTION:\n\n${query}` : query;
    log(`▶ Processing query with context...`, "cyan");
    log(``, "reset");

    // Call Claude with the full prompt
    const claudeProcess = spawn("claude", [], {
      stdio: "inherit",
      shell: true
    });

    claudeProcess.stdin.write(fullPrompt);
    claudeProcess.stdin.end();

    return new Promise((resolve, reject) => {
      claudeProcess.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Claude process exited with code ${code}`));
        }
      });
    });
  }

  // Interactive mode
  log(`💬 Starting Claude CLI with loaded context...`, "cyan");
  log(`Type 'exit' or Ctrl+C to quit\n`, "gray");

  // Start Claude interactively
  const claudeProcess = spawn("claude", [], {
    stdio: "inherit",
    shell: true
  });

  // Send context if available
  if (context) {
    claudeProcess.stdin.write(context);
    claudeProcess.stdin.write("\n\n---\n\nContext loaded. Ready to assist with invoice extraction issues.\n\n");
  }

  return new Promise((resolve, reject) => {
    claudeProcess.on("close", (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`Claude process exited with code ${code}`));
      }
    });

    claudeProcess.on("error", (err) => {
      reject(err);
    });
  });
}

// Parse CLI arguments
const args = process.argv.slice(2);
let query = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--query" && args[i + 1]) {
    query = args[i + 1];
    break;
  }
}

// Run
runClaudeWithContext(query).catch(err => {
  log(`✗ Error: ${err.message}`, "red");
  process.exit(1);
});
