
const MODEL_ID = "SmolLM2-360M-Instruct-q4f32_1-MLC";

const KEYS = {
  memories: "nova_memories",
  conversation: "nova_conversation",
  display: "nova_display_history",
  notes: "nova_notes",
  tasks: "nova_tasks"
};

const $ = id => document.getElementById(id);

const loadButton = $("loadModelButton");
const clearButton = $("clearButton");
const chatForm = $("chatForm");
const messageInput = $("messageInput");
const sendButton = $("sendButton");
const chatMessages = $("chatMessages");
const statusText = $("status");
const progressText = $("progressText");
const progressBar = $("progressBar");

const taskForm = $("taskForm");
const taskInput = $("taskInput");
const taskPriority = $("taskPriority");
const taskDueDate = $("taskDueDate");
const taskList = $("taskList");
const taskSummary = $("taskSummary");
const taskEmpty = $("taskEmpty");

const noteForm = $("noteForm");
const noteTitle = $("noteTitle");
const noteContent = $("noteContent");
const noteSearch = $("noteSearch");
const noteList = $("noteList");
const noteSummary = $("notesSummary");
const noteEmpty = $("noteEmpty");

let engine = null;
let loading = false;
let currentFilter = "all";

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
let rawNotes = readStorage(KEYS.notes, []);
let rawTasks = readStorage(KEYS.tasks, []);

/* ---------- DATA NORMALIZATION ---------- */

function makeTask(item, index) {
  if (typeof item === "string") {
    return {
      id: `task-${Date.now()}-${index}`,
      text: item,
      done: false,
      priority: "normal",
      dueDate: "",
      createdAt: Date.now()
    };
  }

  if (!item || typeof item !== "object") return null;

  const text = String(item.text ?? item.title ?? "").trim();
  if (!text) return null;

  return {
    id: String(item.id || `task-${Date.now()}-${index}`),
    text,
    done: item.done === true,
    priority: ["low", "normal", "high"].includes(item.priority)
      ? item.priority : "normal",
    dueDate: typeof item.dueDate === "string" ? item.dueDate : "",
    createdAt: Number(item.createdAt) || Date.now()
  };
}

function normalizeNote(item, index) {
  if (typeof item === "string") {
    return {
      id: `note-${Date.now()}-${index}`,
      title: "Untitled note",
      content: item,
      createdAt: Date.now()
    };
  }

  if (!item || typeof item !== "object") return null;

  const content = String(item.content ?? item.text ?? "").trim();
  if (!content) return null;

  return {
    id: String(item.id || `note-${Date.now()}-${index}`),
    title: String(item.title || "Untitled note"),
    content,
    createdAt: Number(item.createdAt) || Date.now()
  };
}

let tasks = rawTasks.map(makeTask).filter(Boolean);
let notes = rawNotes.map(normalizeNote).filter(Boolean);

function saveState() {
  try {
    localStorage.setItem(KEYS.memories, JSON.stringify(memories));
    localStorage.setItem(KEYS.conversation, JSON.stringify(conversation));
    localStorage.setItem(KEYS.display, JSON.stringify(displayHistory));
    localStorage.setItem(KEYS.notes, JSON.stringify(notes));
    localStorage.setItem(KEYS.tasks, JSON.stringify(tasks));
  } catch (error) {
    console.error("Storage error:", error);
    setStatus("LOCAL STORAGE ERROR");
  }
}

/* ---------- GENERAL ---------- */

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

  wrapper.append(name, bubble);
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
    renderMessage("assistant",
      "Welcome back. Your local tools and saved data are ready.");
    return;
  }

  for (const message of displayHistory) {
    if (message &&
      ["user", "assistant"].includes(message.sender) &&
      typeof message.text === "string") {
      renderMessage(message.sender, message.text);
    }
  }
}

/* ---------- TASK MANAGER ---------- */

function updateTaskSummary() {
  const completed = tasks.filter(task => task.done).length;
  const open = tasks.length - completed;

  taskSummary.textContent =
    `${open} open · ${completed} completed · ${tasks.length} total`;
}

function formatDueDate(date) {
  if (!date) return "";

  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function renderTasks() {
  taskList.innerHTML = "";
  updateTaskSummary();

  const visibleTasks = tasks.filter(task => {
    if (currentFilter === "open") return !task.done;
    if (currentFilter === "done") return task.done;
    return true;
  });

  taskEmpty.hidden = visibleTasks.length > 0;

  if (!tasks.length) {
    taskEmpty.textContent = "No tasks yet. Add your first task above.";
  } else if (!visibleTasks.length) {
    taskEmpty.textContent = "No tasks in this category.";
  }

  visibleTasks.forEach(task => {
    const card = document.createElement("article");
    card.className = `task-card ${task.done ? "completed" : ""}`;

    const check = document.createElement("button");
    check.type = "button";
    check.className = "task-check";
    check.textContent = task.done ? "✓" : "";
    check.setAttribute("aria-label",
      task.done ? "Mark task as open" : "Complete task");

    check.addEventListener("click", () => {
      task.done = !task.done;
      saveState();
      renderTasks();
    });

    const content = document.createElement("div");
    content.className = "task-content";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.text;

    const details = document.createElement("div");
    details.className = "task-details";

    const priority = document.createElement("span");
    priority.className = `priority priority-${task.priority}`;
    priority.textContent = `${task.priority} priority`;

    details.appendChild(priority);

    if (task.dueDate) {
      const due = document.createElement("span");
      due.className = "task-due";
      due.textContent = `Due: ${formatDueDate(task.dueDate)}`;
      details.appendChild(due);
    }

    content.append(title, details);

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "EDIT";
    edit.addEventListener("click", () => editTask(task.id));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "DELETE";
    remove.addEventListener("click", () => deleteTask(task.id));

    actions.append(edit, remove);
    card.append(check, content, actions);
    taskList.appendChild(card);
  });
}

function addTask(text, priority = "normal", dueDate = "") {
  const cleanText = text.trim();
  if (!cleanText) return false;

  tasks.push({
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: cleanText,
    done: false,
    priority,
    dueDate,
    createdAt: Date.now()
  });

  saveState();
  renderTasks();
  return true;
}

function editTask(id) {
  const task = tasks.find(item => item.id === id);
  if (!task) return;

  const newText = prompt("Edit task:", task.text);
  if (newText === null) return;

  if (!newText.trim()) {
    alert("A task needs a name.");
    return;
  }

  task.text = newText.trim();

  const newPriority = prompt(
    "Priority: low, normal or high", task.priority
  );

  if (newPriority !== null) {
    const value = newPriority.trim().toLowerCase();
    if (["low", "normal", "high"].includes(value)) {
      task.priority = value;
    }
  }

  const newDate = prompt(
    "Due date in YYYY-MM-DD format. Leave empty for no due date.",
    task.dueDate
  );

  if (newDate !== null) {
    task.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(newDate.trim())
      ? newDate.trim() : "";
  }

  saveState();
  renderTasks();
}

function deleteTask(id) {
  const task = tasks.find(item => item.id === id);
  if (!task || !confirm(`Delete "${task.text}"?`)) return;

  tasks = tasks.filter(item => item.id !== id);
  saveState();
  renderTasks();
}

taskForm.addEventListener("submit", event => {
  event.preventDefault();

  if (addTask(taskInput.value, taskPriority.value, taskDueDate.value)) {
    taskInput.value = "";
    taskDueDate.value = "";
    taskPriority.value = "normal";
    taskInput.focus();
  }
});

document.querySelectorAll(".task-filter").forEach(button => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;

    document.querySelectorAll(".task-filter").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    renderTasks();
  });
});

/* ---------- NOTES MANAGER ---------- */

function renderNotes() {
  noteList.innerHTML = "";

  const search = noteSearch.value.trim().toLowerCase();

  const visibleNotes = notes.filter(note =>
    note.title.toLowerCase().includes(search) ||
    note.content.toLowerCase().includes(search)
  );

  noteSummary.textContent =
    `${notes.length} saved ${notes.length === 1 ? "note" : "notes"}`;

  noteEmpty.hidden = visibleNotes.length > 0;

  if (!notes.length) {
    noteEmpty.textContent = "No notes yet. Create your first note above.";
  } else if (!visibleNotes.length) {
    noteEmpty.textContent = "No matching notes found.";
  }

  visibleNotes.forEach(note => {
    const card = document.createElement("article");
    card.className = "note-card";

    const heading = document.createElement("div");
    heading.className = "note-card-heading";

    const title = document.createElement("h3");
    title.textContent = note.title;

    const date = document.createElement("span");
    date.className = "note-date";
    date.textContent = new Date(note.createdAt).toLocaleDateString();

    heading.append(title, date);

    const content = document.createElement("p");
    content.className = "note-card-content";
    content.textContent = note.content;

    const actions = document.createElement("div");
    actions.className = "note-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "EDIT";
    edit.addEventListener("click", () => editNote(note.id));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "DELETE";
    remove.addEventListener("click", () => deleteNote(note.id));

    actions.append(edit, remove);
    card.append(heading, content, actions);
    noteList.appendChild(card);
  });
}

function addNote(title, content) {
  const cleanTitle = title.trim();
  const cleanContent = content.trim();

  if (!cleanTitle || !cleanContent) return false;

  notes.unshift({
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: cleanTitle,
    content: cleanContent,
    createdAt: Date.now()
  });

  saveState();
  renderNotes();
  return true;
}

function editNote(id) {
  const note = notes.find(item => item.id === id);
  if (!note) return;

  const newTitle = prompt("Note title:", note.title);
  if (newTitle === null) return;

  if (!newTitle.trim()) {
    alert("A note needs a title.");
    return;
  }

  const newContent = prompt("Note content:", note.content);
  if (newContent === null) return;

  if (!newContent.trim()) {
    alert("A note needs some content.");
    return;
  }

  note.title = newTitle.trim();
  note.content = newContent.trim();

  saveState();
  renderNotes();
}

function deleteNote(id) {
  const note = notes.find(item => item.id === id);
  if (!note || !confirm(`Delete "${note.title}"?`)) return;

  notes = notes.filter(item => item.id !== id);
  saveState();
  renderNotes();
}

noteForm.addEventListener("submit", event => {
  event.preventDefault();

  if (addNote(noteTitle.value, noteContent.value)) {
    noteTitle.value = "";
    noteContent.value = "";
    noteTitle.focus();
  }
});

noteSearch.addEventListener("input", renderNotes);

/* ---------- AI CONTEXT ---------- */

function getSystemPrompt() {
  return `You are NOVA, a helpful personal AI assistant running locally.
Answer clearly and naturally.
Use simple language.
Do not claim to access the internet or files unless a tool has provided the information.

Saved memories:
${memories.map(item => "- " + item).join("\n") || "No saved memories."}

Saved notes:
${notes.map((item, i) =>
  `${i + 1}. ${item.title}: ${item.content}`
).join("\n") || "No notes."}

Tasks:
${tasks.map((item, i) =>
  `${i + 1}. ${item.done ? "[Completed]" : "[Open]"} [${item.priority}] ${item.text}${item.dueDate ? " Due: " + item.dueDate : ""}`
).join("\n") || "No tasks."}

You can explain how to use your local tools.`;
}

/* ---------- CALCULATOR ---------- */

function calculate(expression) {
  const tokens = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    const remaining = expression.slice(i);
    const numberMatch = remaining.match(/^(?:\d+\.?\d*|\.\d+)/);

    if (numberMatch) {
      tokens.push(numberMatch[0]);
      i += numberMatch[0].length;
      continue;
    }

    if ("+-*/%()".includes(char)) {
      tokens.push(char);
      i++;
      continue;
    }

    throw new Error(`Invalid character: ${char}`);
  }

  if (!tokens.length) throw new Error("Enter a calculation.");

  let position = 0;

  function parseExpression() {
    let value = parseTerm();

    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++];
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }

    return value;
  }

  function parseTerm() {
    let value = parseFactor();

    while (["*", "/", "%"].includes(tokens[position])) {
      const operator = tokens[position++];
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
    const token = tokens[position];

    if (token === "+" || token === "-") {
      position++;
      const value = parseFactor();
      return token === "-" ? -value : value;
    }

    if (token === "(") {
      position++;
      const value = parseExpression();

      if (tokens[position] !== ")") {
        throw new Error("Missing closing parenthesis.");
      }

      position++;
      return value;
    }

    if (token === undefined ||
        !/^(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      throw new Error("Invalid calculation.");
    }

    position++;
    return Number(token);
  }

  const result = parseExpression();

  if (position !== tokens.length || !Number.isFinite(result)) {
    throw new Error("Invalid calculation.");
  }

  return Number(result.toPrecision(12)).toString();
}

/* ---------- LOCAL COMMANDS ---------- */

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
      addMessage("assistant",
        `${expression} = ${calculate(expression)}`);
    } catch (error) {
      addMessage("assistant", `Calculator error: ${error.message}`);
    }
    return true;
  }

  if (lower.startsWith("/remember ")) {
    const memory = command.slice(10).trim();

    if (!memory) {
      addMessage("assistant", "Write something after /remember.");
    } else {
      memories.push(memory);
      saveState();
      addMessage("assistant", "Saved to local memory.");
    }
    return true;
  }

  if (lower === "/memories") {
    addMessage("assistant",
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
      addNote("Untitled note", note);
      addMessage("assistant", "Note saved on this device.");
    }
    return true;
  }

  if (lower === "/notes") {
    addMessage("assistant",
      notes.length
        ? notes.map((note, i) =>
          `${i + 1}. ${note.title}\n${note.content}`
        ).join("\n\n")
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
      renderNotes();
      addMessage("assistant", `Deleted note: ${removed.title}`);
    }
    return true;
  }

  if (lower.startsWith("/task add ")) {
    const task = command.slice(10).trim();

    if (!task) {
      addMessage("assistant", "Write something after /task add.");
    } else {
      addTask(task);
      addMessage("assistant", "Task added.");
    }
    return true;
  }

  if (lower === "/tasks") {
    addMessage("assistant",
      tasks.length
        ? `ALL TASKS (${tasks.length})\n\n` +
          tasks.map((task, i) =>
            `${i + 1}. ${task.done ? "[DONE]" : "[OPEN]"} [${task.priority}] ${task.text}${task.dueDate ? " | Due: " + task.dueDate : ""}`
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
      renderTasks();
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
      renderTasks();
      addMessage("assistant", `Deleted task: ${removed.text}`);
    }
    return true;
  }

  if (lower === "/clear") {
    conversation = [];
    displayHistory = [];
    saveState();
    chatMessages.innerHTML = "";
    addMessage("assistant",
      "Conversation cleared. Your notes and memories are safe.");
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
          5, Math.min(100, Math.round((report.progress || 0) * 100))
        );
        setProgress(report.text || "Loading model...", progress);
      }
    });

    setProgress("AI model ready.", 100);
    setStatus("LOCAL AI READY");
    loadButton.textContent = "AI READY";

    addMessage("assistant",
      "I'm ready. My local tools and memory are available.");

  } catch (error) {
    engine = null;
    setStatus("AI NOT LOADED");
    setProgress(`Error: ${error.message}`, 0);
    loadButton.disabled = false;
    loadButton.textContent = "TRY AGAIN";

    addMessage("assistant",
      `I couldn't load my AI model.\n${error.message}`);
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
    addMessage("assistant",
      "My AI model isn't loaded yet. Tap LOAD AI first.");
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
  addMessage("assistant",
    "Conversation cleared. Your notes and memories are safe.");
});

/* ---------- STARTUP ---------- */

saveState();
renderTasks();
renderNotes();
restoreConversation();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .catch(error => console.error("Service worker error:", error));
  });
}