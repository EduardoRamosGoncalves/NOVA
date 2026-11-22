const MODEL_ID = "SmolLM2-360M-Instruct-q4f32_1-MLC";

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
let conversation = [];

const memories = JSON.parse(
  localStorage.getItem("nova_memories") || "[]"
);

function saveMemories() {
  localStorage.setItem("nova_memories", JSON.stringify(memories));
}

function setStatus(text) {
  statusText.textContent = text;
}

function setProgress(text, percentage) {
  progressText.textContent = text;
  progressBar.style.width = `${percentage}%`;
}

function addMessage(sender, text) {
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

function getSystemPrompt() {
  let memoryText = memories.length
    ? memories.map(item => `- ${item}`).join("\n")
    : "No saved memories.";

  return `You are NOVA, a helpful personal AI assistant.
You run locally on the user's device.
Answer clearly and naturally.
Use simple language.
Do not pretend to have access to the internet or the user's files.
Your saved memories are:

${memoryText}`;
}

function handleCommand(text) {
  const command = text.trim();
  const lower = command.toLowerCase();

  if (lower === "/help") {
    addMessage("assistant",
      "Commands:\n/remember [information]\n/memories\n/forget [information]\n/clear\n/help"
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
    saveMemories();
    addMessage("assistant", "Saved to local memory.");
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
    const index = memories.findIndex(
      item => item.toLowerCase().includes(target)
    );

    if (index === -1) {
      addMessage("assistant", "I couldn't find that memory.");
    } else {
      memories.splice(index, 1);
      saveMemories();
      addMessage("assistant", "Memory deleted.");
    }

    return true;
  }

  if (lower === "/clear") {
    conversation = [];
    chatMessages.innerHTML = "";
    addMessage("assistant", "Conversation cleared.");
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
      throw new Error(
        "WebGPU is unavailable in this Safari session. Update iOS and try again."
      );
    }

    setStatus("CHECKING DEVICE");
    setProgress("Checking graphics support...", 2);

    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
      throw new Error("Safari could not access a compatible graphics adapter.");
    }

    setStatus("DOWNLOADING AI ENGINE");
    setProgress("Preparing local AI engine...", 5);

    const webllm = await import("https://esm.run/@mlc-ai/web-llm");

    setStatus("LOADING LOCAL MODEL");

    engine = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        const progress = Math.max(
          5,
          Math.min(100, Math.round((report.progress || 0) * 100))
        );

        setProgress(
          report.text || "Loading model...",
          progress
        );
      }
    });

    setProgress("AI model ready.", 100);
    setStatus("LOCAL AI READY");
    loadButton.textContent = "AI READY";

    addMessage(
      "assistant",
      "My local AI model is ready. You can now talk to me."
    );

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
    addMessage(
      "assistant",
      "My AI model isn't loaded yet. Tap LOAD AI first."
    );
    return;
  }

  conversation.push({
    role: "user",
    content: cleanText
  });

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

  } catch (error) {
    replyBubble.textContent = `Generation error: ${error.message}`;
    console.error(error);

  } finally {
    sendButton.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

loadButton.addEventListener("click", loadAI);

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = "";
  await sendMessage(text);
});

clearButton.addEventListener("click", () => {
  conversation = [];
  chatMessages.innerHTML = "";
  addMessage("assistant", "Conversation cleared.");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .catch(error => console.error("Service worker error:", error));
  });
}
