// chat-sync.js — Sync web chat with terminal/local storage
// Saves chat messages to local JSON file that Claude CLI can load

class ChatHistoryManager {
  constructor() {
    this.storageKey = "invoice_chat_history";
    this.localFilePath = "../chat-history.json"; // Relative to frontend
    this.history = this.loadHistory();
  }

  loadHistory() {
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.warn("Failed to parse chat history:", e);
      }
    }
    return this.getEmptyHistory();
  }

  getEmptyHistory() {
    return {
      version: "1.0",
      conversations: [
        {
          id: this.generateId(),
          timestamp: new Date().toISOString(),
          platform: "web",
          messages: []
        }
      ],
      lastUpdated: new Date().toISOString(),
      activeConversationId: ""
    };
  }

  generateId() {
    return `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  addMessage(role, content, conversationId = null) {
    const activeConvId = conversationId || this.history.activeConversationId || this.history.conversations[0]?.id;
    
    let conversation = this.history.conversations.find(c => c.id === activeConvId);
    if (!conversation) {
      conversation = {
        id: this.generateId(),
        timestamp: new Date().toISOString(),
        platform: "web",
        messages: []
      };
      this.history.conversations.push(conversation);
      this.history.activeConversationId = conversation.id;
    }

    conversation.messages.push({
      role,
      content,
      timestamp: new Date().toISOString()
    });

    this.history.lastUpdated = new Date().toISOString();
    this.saveHistory();
  }

  saveHistory() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.history, null, 2));
    this.syncToFile();
  }

  syncToFile() {
    // Send to server endpoint to write to file
    fetch("../api/sync-chat-history", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.history)
    }).catch(err => console.warn("Failed to sync to file:", err));
  }

  getFormattedContext() {
    // Format history for Claude CLI context
    const activeConv = this.history.conversations.find(
      c => c.id === this.history.activeConversationId
    ) || this.history.conversations[0];

    if (!activeConv) return "";

    return activeConv.messages
      .map(msg => `${msg.role.toUpperCase()}:\n${msg.content}`)
      .join("\n\n---\n\n");
  }

  getAsMarkdown() {
    // Export as markdown for terminal use
    const activeConv = this.history.conversations.find(
      c => c.id === this.history.activeConversationId
    ) || this.history.conversations[0];

    if (!activeConv) return "";

    let md = `# Chat History\n\n**Exported:** ${new Date().toISOString()}\n\n`;
    activeConv.messages.forEach((msg, idx) => {
      md += `## Message ${idx + 1} (${msg.role})\n\n${msg.content}\n\n`;
    });
    return md;
  }

  exportToTerminal() {
    return this.getFormattedContext();
  }
}

// Global instance
const chatHistory = new ChatHistoryManager();

// Hook into existing functionality (if you have message display)
function hookChatDisplay() {
  // Example: If you have chat messages displayed, add observer
  // This captures messages as they appear on screen
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      // Look for message elements and extract text
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) { // Element node
          // Adapt selectors to your actual DOM structure
          const messageEl = node.closest("[data-message]");
          if (messageEl) {
            const role = messageEl.getAttribute("data-role") || "user";
            const content = messageEl.textContent;
            chatHistory.addMessage(role, content);
          }
        }
      });
    });
  });

  // Observe chat container (adjust selector to your DOM)
  const chatContainer = document.getElementById("chat-container") || document.body;
  observer.observe(chatContainer, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

// Initialize on load
document.addEventListener("DOMContentLoaded", hookChatDisplay);
