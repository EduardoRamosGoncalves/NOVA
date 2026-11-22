const MODEL_ID = "SmolLM2-360M-Instruct-q4f32_1-MLC";

const STORAGE_KEYS = {
  memories: "nova_memories",
  conversation: "nova_conversation",
  display: "nova_display_history"
};

const loadButton = document.getElementById("loadModelButton");
const clearButton = document.getElementById("clearButton");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const chatMessages = document.getElementById("chatMessages");
const statusText = document.getElementById("status");
const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");

let engine = null;
let loading = false;

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

let memories = readStorage(STORAGE_KEYS.memories, []);
let conversation = readStorage(STORAGE_KEYS.conversation, []);
let displayHistory = readStorage(STORAGE_KEYS.display, []);

function saveState() {
  localStorage.setItem(STORAGE_KEYS.memories, JSON.stringify(memories));
  localStorage.setItem(STORAGE_KEYS.conversation, JSON.stringify(conversation));
  localStorage.setItem(STORAGE_KEYS.display, JSON.stringify(displayHistory));
}

function setStatus(text) {
  statusText.textContent = text;
}

function setProgress(text, percentage) {
  progressText.textContent = text;
  progressBar.style.width = `${percentage}%`;
}

function renderMessage(sender, text) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${sender}`;

  const name = document.createElement("div");
  name.className = "sender";
  name.textContent = sender === "user" ? "YOU" : "NOVA";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  wrapper.appendChild(name);
  wrapper.appendChild(bubble);
  chatMessages.appendChild(wrapper);

  chatMessages.scrollTop = chatMessages.scrollHeight;

  return bubble;
}

function addMessage(sender, text) {
  displayHistory.push({ sender, text });

  // Keep the displayed history from growing indefinitely.
  displayHistory = displayHistory.slice(-100);

  const bubble = renderMessage(sender, text);
  saveState();

  return bubble;
}

function restoreConversation() {
  chatMessages.innerHTML = "";

  if (displayHistory.length === 0) {
    renderMessage(
      "assistant",
      "Welcome back. Your saved conversations and memories are available."
    );
    return;
  }

  for (const message of displayHistory) {
    if (
      message &&
      ["user", "assistant"].includes(message.sender) &&
      typeof message.text === "string"
    ) {
      renderMessage(message.sender, message.text);
    }
  }
}

function getSystemPrompt() {
  const memoryText = memories.length
    ? memories.map(item => `- ${item}`).join("\n")
    : "No saved memories.";

  return `You are NOVA, a helpful personal AI assistant.
You run locally on the user's device.
Answer clearly and naturally.
Use simple language.
Do not pretend to have access to the internet or the user's files.
Use the saved memories when relevant, but do not force them into unrelated answers.

Saved memories:
${memoryText}`;
}

function handleCommand(text) {
  const command = text.trim();
  const lower = command.toLowerCase();

  if (lower === "/help") {
    addMessage(
      "assistant",
      "Available commands:\n/remember [information]\n/memories\n/forget [information]\n/clear\n/help"
    );
    return true;
  }

  if (lower.startsWith("/remember ")) {
    const memory = command.slice(10).trim();

    if (!memory) {
      addMessage("assistant", "Write something after /remember.");
      return true;
    }

    memories.push(memory);
    saveState();
    addMessage("assistant", "Saved. I'll include this memory when relevant.");
    return true;
  }

  if (lower === "/memories") {
    addMessage(
      "assistant",
      memories.length
        ? memories.map((item, index) => `${index + 1}. ${item}`).join("\n")
        : "Your memory is empty."
    );
    return true;
  }

  if (lower.startsWith("/forget ")) {
    const target = command.slice(8).trim().toLowerCase();

    if (!target) {
      addMessage("assistant", "Write the memory you want to remove.");
      return true;
    }

    const index = memories.findIndex(
      item => item.toLowerCase().includes(target)
    );

    if (index === -1) {
      addMessage("assistant", "I couldn't find that memory.");
    } else {
      memories.splice(index, 1);
      saveState();
      addMessage("assistant", "Memory deleted.");
    }

    return true;
  }

  if (lower === "/clear") {
    conversation = [];
    displayHistory = [];
    chatMessages.innerHTML = "";
    saveState();
    addMessage("assistant", "Conversation cleared. Your saved memories are safe.");
    return true;
  }

  return false;
}

async function loadAI() {
  if (loading || engine) return;

  loading = true;
  loadButton.disabled = true;
  loadButton.textContent = "LOADING";

  try {
    if (!navigator.gpu) {
      throw new Error("WebGPU is unavailable in this Safari session.");
    }

    setStatus("CHECKING DEVICE");
    setProgress("Checking graphics support...", 2);

    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
      throw new Error("No compatible graphics adapter was found.");
    }

    setStatus("LOADING AI ENGINE");
    setProgress("Preparing the local AI engine...", 5);

    const webllm = await import("https://esm.run/@mlc-ai/web-llm");

    setStatus("LOADING LOCAL MODEL");

    engine = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback: report => {
        const progress = Math.max(
          5,
          Math.min(100, Math.round((report.progress || 0) * 100))
        );

        setProgress(report.text || "Loading model...", progress);
      }
    });

    setProgress("AI model ready.", 100);
    setStatus("LOCAL AI READY");
    loadButton.textContent = "AI READY";

    addMessage("assistant", "I'm ready. Your saved memories are available.");

  } catch (error) {
    engine = null;
    setStatus("AI NOT LOADED");
    setProgress(`Error: ${error.message}`, 0);
    loadButton.disabled = false;
    loadButton.textContent = "TRY AGAIN";

    addMessage("assistant", `I couldn't load my AI model.\n${error.message}`);
    console.error(error);

  } finally {
    loading = false;
  }
}

async function sendMessage(text) {
  const cleanText = text.trim();

  if (!cleanText) return;

  addMessage("user", cleanText);

  if (handleCommand(cleanText)) return;

  if (!engine) {
    addMessage("assistant", "My AI model isn't loaded yet. Tap LOAD AI first.");
    return;
  }

  conversation.push({
    role: "user",
    content: cleanText
  });

  // Limit recent context to avoid sending an unlimited conversation.
  conversation = conversation.slice(-12);
  saveState();

  sendButton.disabled = true;
  messageInput.disabled = true;

  const replyBubble = addMessage("assistant", "Thinking...");

  try {
    const messages = [
      {
        role: "system",
        content: getSystemPrompt()
      },
      ...conversation
    ];

    const response = await engine.chat.completions.create({
      messages,
      temperature: 0.7,
      max_tokens: 256
    });

    const answer =
      response.choices?.[0]?.message?.content ||
      "I couldn't generate a response.";

    replyBubble.textContent = answer;

    conversation.push({
      role: "assistant",
      content: answer
    });

    conversation = conversation.slice(-12);

    const lastDisplayMessage = displayHistory[displayHistory.length - 1];

    if (lastDisplayMessage) {
      lastDisplayMessage.text = answer;
    }

    saveState();

  } catch (error) {
    replyBubble.textContent = `Generation error: ${error.message}`;

    const lastDisplayMessage = displayHistory[displayHistory.length - 1];

    if (lastDisplayMessage) {
      lastDisplayMessage.text = replyBubble.textContent;
    }

    saveState();
    console.error(error);

  } finally {
    sendButton.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

loadButton.addEventListener("click", loadAI);

chatForm.addEventListener("submit", async event => {
  event.preventDefault();

  const text = messageInput.value.trim();

  if (!text) return;

  messageInput.value = "";
  await sendMessage(text);
});

clearButton.addEventListener("click", () => {
  conversation = [];
  displayHistory = [];
  chatMessages.innerHTML = "";
  saveState();

  addMessage("assistant", "Conversation cleared. Your saved memories are safe.");
});

restoreConversation();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .catch(error => console.error("Service worker error:", error));
  });
}