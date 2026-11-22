const MODEL_ID = "SmolLM2-360M-Instruct-q4f32_1-MLC";

const KEYS = {
  memories: "nova_memories",
  conversation: "nova_conversation",
  display: "nova_display_history",
  notes: "nova_notes",
  tasks: "nova_tasks"
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

let memories = readStorage(KEYS.memories, []);
let conversation = readStorage(KEYS.conversation, []);
let displayHistory = readStorage(KEYS.display, []);
let notes = readStorage(KEYS.notes, []);
let tasks = readStorage(KEYS.tasks, []);

function saveState() {
  localStorage.setItem(KEYS.memories, JSON.stringify(memories));
  localStorage.setItem(KEYS.conversation, JSON.stringify(conversation));
  localStorage.setItem(KEYS.display, JSON.stringify(displayHistory));
  localStorage.setItem(KEYS.notes, JSON.stringify(notes));
  localStorage.setItem(KEYS.tasks, JSON.stringify(tasks));
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
  displayHistory = displayHistory.slice(-100);

  const bubble = renderMessage(sender, text);
  saveState();
  return bubble;
}

function restoreConversation() {
  chatMessages.innerHTML = "";

  if (!displayHistory.length) {
    renderMessage(
      "assistant",
      "Welcome back. Your local tools and saved data are ready."
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
  return `You are NOVA, a helpful personal AI assistant running locally.
Answer clearly and naturally.
Use simple language.
Do not claim to access the internet or files unless a tool has provided the information.

Saved memories:
${memories.map(item => "- " + item).join("\n") || "No saved memories."}

Saved notes:
${notes.map((item, i) => `${i + 1}. ${item}`).join("\n") || "No notes."}

Tasks:
${tasks.map((item, i) => `${i + 1}. ${item.done ? "[Completed]" : "[Open]"} ${item.text}`).join("\n") || "No tasks."}

You can explain how to use your local tools.`;
}

/* ---------- SAFE CALCULATOR ---------- */

function calculate(expression) {
  const tokens = expression.match(
    /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([+\-*/()%]))/g
  );

  if (!tokens || tokens.join("").replace(/\s/g, "") !== expression.replace(/\s/g, "")) {
    throw new Error("Use numbers, +, -, *, /, %, and parentheses.");
  }

  const values = tokens.map(token => token.trim());
  let position = 0;

  function parseExpression() {
    let value = parseTerm();

    while (values[position] === "+" || values[position] === "-") {
      const operator = values[position++];
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }

    return value;
  }

  function parseTerm() {
    let value = parseFactor();

    while (
      values[position] === "*" ||
      values[position] === "/" ||
      values[position] === "%"
    ) {
      const operator = values[position++];
      const right = parseFactor();

      if ((operator === "/" || operator === "%") && right === 0) {
        throw new Error("Division by zero is not allowed.");
      }

      if (operator === "*") value *= right;
      if (operator === "/") value /= right;
      if (operator === "%") value %= right;
    }

    return value;
  }

  function parseFactor() {
    const token = values[position++];

    if (token === "+") return parseFactor();
    if (token === "-") return -parseFactor();

    if (token === "(") {
      const value = parseExpression();

      if (values[position++] !== ")") {
        throw new Error("Missing closing parenthesis.");
      }

      return value;
    }

    const number = Number(token);

    if (!Number.isFinite(number)) {
      throw new Error("Invalid calculation.");
    }

    return number;
  }

  const result = parseExpression();

  if (position !== values.length || !Number.isFinite(result)) {
    throw new Error("Invalid calculation.");
  }

  return Number(result.toPrecision(12)).toString();
}

/* ---------- LOCAL TOOLS ---------- */

function handleCommand(text) {
  const command = text.trim();
  const lower = command.toLowerCase();

  if (lower === "/help") {
    addMessage("assistant",
`NOVA LOCAL COMMANDS

Calculator:
/calc 12 * (4 + 2)

Memory:
/remember [information]
/memories
/forget [word]

Notes:
/note add [text]
/notes
/note delete [number]

Tasks:
/task add [text]
/tasks
/task done [number]
/task delete [number]

Other:
/clear
/help`);
    return true;
  }

  if (lower.startsWith("/calc ")) {
    try {
      const expression = command.slice(6).trim();
      const result = calculate(expression);
      addMessage("assistant", `${expression} = ${result}`);
    } catch (error) {
      addMessage("assistant", `Calculator error: ${error.message}`);
    }
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
    addMessage("assistant", "Saved to local memory.");
    return true;
  }

  if (lower === "/memories") {
    addMessage(
      "assistant",
      memories.length
        ? memories.map((item, i) => `${i + 1}. ${item}`).join("\n")
        : "Your memory is empty."
    );
    return true;
  }

  if (lower.startsWith("/forget ")) {
    const target = command.slice(8).trim().toLowerCase();

    const index = memories.findIndex(item =>
      item.toLowerCase().includes(target)
    );

    if (!target || index === -1) {
      addMessage("assistant", "I couldn't find that memory.");
    } else {
      memories.splice(index, 1);
      saveState();
      addMessage("assistant", "Memory deleted.");
    }
    return true;
  }

  if (lower.startsWith("/note add ")) {
    const note = command.slice(10).trim();

    if (!note) {
      addMessage("assistant", "Write something after /note add.");
    } else {
      notes.push(note);
      saveState();
      addMessage("assistant", "Note saved on this device.");
    }
    return true;
  }

  if (lower === "/notes") {
    addMessage(
      "assistant",
      notes.length
        ? notes.map((note, i) => `${i + 1}. ${note}`).join("\n")
        : "You have no saved notes."
    );
    return true;
  }

  if (lower.startsWith("/note delete ")) {
    const number = Number(command.slice(13).trim());

    if (!Number.isInteger(number) || number < 1 || number > notes.length) {
      addMessage("assistant", "That note number doesn't exist.");
    } else {
      const removed = notes.splice(number - 1, 1)[0];
      saveState();
      addMessage("assistant", `Deleted note: ${removed}`);
    }
    return true;
  }

  if (lower.startsWith("/task add ")) {
    const task = command.slice(10).trim();

    if (!task) {
      addMessage("assistant", "Write something after /task add.");
    } else {
      tasks.push({ text: task, done: false });
      saveState();
      addMessage("assistant", "Task added.");
    }
    return true;
  }

  if (lower === "/tasks") {
    addMessage(
      "assistant",
      tasks.length
        ? tasks.map((task, i) =>
            `${i + 1}. ${task.done ? "[DONE]" : "[OPEN]"} ${task.text}`
          ).join("\n")
        : "Your task list is empty."
    );
    return true;
  }

  if (lower.startsWith("/task done ")) {
    const number = Number(command.slice(11).trim());

    if (!Number.isInteger(number) || number < 1 || number > tasks.length) {
      addMessage("assistant", "That task number doesn't exist.");
    } else {
      tasks[number - 1].done = true;
      saveState();
      addMessage("assistant", `Completed: ${tasks[number - 1].text}`);
    }
    return true;
  }

  if (lower.startsWith("/task delete ")) {
    const number = Number(command.slice(13).trim());

    if (!Number.isInteger(number) || number < 1 || number > tasks.length) {
      addMessage("assistant", "That task number doesn't exist.");
    } else {
      const removed = tasks.splice(number - 1, 1)[0];
      saveState();
      addMessage("assistant", `Deleted task: ${removed.text}`);
    }
    return true;
  }

  if (lower === "/clear") {
    conversation = [];
    displayHistory = [];
    saveState();
    chatMessages.innerHTML = "";
    addMessage("assistant", "Conversation cleared. Your notes and memories are safe.");
    return true;
  }

  return false;
}

/* ---------- LOCAL AI ENGINE ---------- */

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
    setProgress("Preparing local AI engine...", 5);

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

    addMessage("assistant", "I'm ready. My local tools and memory are available.");

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

  // Local commands run without sending anything to the AI model.
  if (handleCommand(cleanText)) return;

  if (!engine) {
    addMessage("assistant", "My AI model isn't loaded yet. Tap LOAD AI first.");
    return;
  }

  conversation.push({ role: "user", content: cleanText });
  conversation = conversation.slice(-12);
  saveState();

  sendButton.disabled = true;
  messageInput.disabled = true;

  const replyBubble = addMessage("assistant", "Thinking...");

  try {
    const response = await engine.chat.completions.create({
      messages: [
        { role: "system", content: getSystemPrompt() },
        ...conversation
      ],
      temperature: 0.7,
      max_tokens: 256
    });

    const answer =
      response.choices?.[0]?.message?.content ||
      "I couldn't generate a response.";

    replyBubble.textContent = answer;

    conversation.push({ role: "assistant", content: answer });
    conversation = conversation.slice(-12);

    const lastMessage = displayHistory[displayHistory.length - 1];
    if (lastMessage) lastMessage.text = answer;

    saveState();

  } catch (error) {
    replyBubble.textContent = `Generation error: ${error.message}`;

    const lastMessage = displayHistory[displayHistory.length - 1];
    if (lastMessage) lastMessage.text = replyBubble.textContent;

    saveState();
    console.error(error);

  } finally {
    sendButton.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

/* ---------- EVENT LISTENERS ---------- */

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
  saveState();

  chatMessages.innerHTML = "";
  addMessage("assistant", "Conversation cleared. Your notes and memories are safe.");
});

restoreConversation();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .catch(error => console.error("Service worker error:", error));
  });
}