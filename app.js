
const MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
const MODEL_NAME = "Qwen2.5-1.5B";
const WEBLLM_VERSION = "0.2.88";

const MAX_TOKENS = 160;
const MAX_CONVERSATION_MESSAGES = 4;
const MAX_MESSAGE_LENGTH = 1200;
const MAX_ATTACHMENT_TEXT = 7000;
const IMPORT_KEY = "nova_imported_context";

const KEYS = {
  memories: "nova_memories",
  conversation: "nova_conversation",
  display: "nova_display_history",
  notes: "nova_notes",
  tasks: "nova_tasks",
  model: "nova_model_id"
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

const fileInput = $("fileInput");
const attachButton = $("attachButton");
const attachmentPreview = $("attachmentPreview");

let engine = null;
let loading = false;
let generating = false;
let currentFilter = "all";
let attachments = [];
let attachmentContext = "";
let importedContext = null;

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

if (!Array.isArray(memories)) memories = [];
if (!Array.isArray(conversation)) conversation = [];
if (!Array.isArray(displayHistory)) displayHistory = [];
if (!Array.isArray(rawNotes)) rawNotes = [];
if (!Array.isArray(rawTasks)) rawTasks = [];

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
    return true;
  } catch (error) {
    console.error("Storage error:", error);
    setStatus("LOCAL STORAGE ERROR");
    return false;
  }
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

/* NAVIGATION */

function getActiveScreen() {
  return document.querySelector(".screen:not([hidden])");
}

function switchScreen(screenId) {
  document.querySelectorAll(".screen").forEach(screen => {
    screen.hidden = screen.id !== screenId;
  });

  document.querySelectorAll(".nav-button").forEach(button => {
    button.classList.toggle("active", button.dataset.screen === screenId);
  });
}

document.querySelectorAll(".nav-button").forEach(button => {
  button.addEventListener("click", () => switchScreen(button.dataset.screen));
});

/* PLUS BUTTON */

clearButton.addEventListener("click", () => {
  const active = getActiveScreen();
  if (!active) return;

  if (active.id === "chatScreen") {
    if (!confirm("Start a new conversation?")) return;
    conversation = [];
    displayHistory = [];
    saveState();
    chatMessages.innerHTML = "";
    addMessage("assistant", "New conversation started. How can I help?");
  } else if (active.id === "notesScreen") {
    noteTitle.focus();
  } else if (active.id === "tasksScreen") {
    taskInput.focus();
  }
});

/* TASKS */

function updateTaskSummary() {
  const completed = tasks.filter(task => task.done).length;
  taskSummary.textContent =
    `${tasks.length - completed} open · ${completed} completed · ${tasks.length} total`;
}

function formatDueDate(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric"
  });
}

function renderTasks() {
  taskList.innerHTML = "";
  updateTaskSummary();

  const visible = tasks.filter(task => {
    if (currentFilter === "open") return !task.done;
    if (currentFilter === "done") return task.done;
    return true;
  });

  taskEmpty.hidden = visible.length > 0;
  taskEmpty.textContent = tasks.length
    ? "No tasks in this category."
    : "No tasks yet. Add your first task above.";

  visible.forEach(task => {
    const card = document.createElement("article");
    card.className = `task-card ${task.done ? "completed" : ""}`;

    const check = document.createElement("button");
    check.type = "button";
    check.className = "task-check";
    check.textContent = task.done ? "✓" : "";
    check.setAttribute("aria-label", "Toggle task completion");
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
  const clean = String(text).trim();
  if (!clean) return false;

  if (!["low", "normal", "high"].includes(priority)) priority = "normal";
  if (dueDate && !isValidDate(dueDate)) return false;

  tasks.push({
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: clean,
    done: false,
    priority,
    dueDate,
    createdAt: Date.now()
  });

  if (!saveState()) {
    tasks.pop();
    return false;
  }

  renderTasks();
  return true;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function editTask(id) {
  const task = tasks.find(item => item.id === id);
  if (!task) return;

  const text = prompt("Edit task:", task.text);
  if (text === null || !text.trim()) return;

  const priorityInput = prompt("Priority: low, normal or high", task.priority);
  if (priorityInput === null) return;
  const priority = priorityInput.trim().toLowerCase();

  if (!["low", "normal", "high"].includes(priority)) {
    alert("Invalid priority.");
    return;
  }

  const date = prompt("Due date YYYY-MM-DD, or leave empty:", task.dueDate);
  if (date === null) return;
  if (date.trim() && !isValidDate(date.trim())) {
    alert("Invalid date.");
    return;
  }

  task.text = text.trim();
  task.priority = priority;
  task.dueDate = date.trim();
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

function getTaskList(filter = "all") {
  return tasks.filter(task => {
    if (filter === "open") return !task.done;
    if (filter === "done") return task.done;
    return true;
  });
}

function showTasks(filter = "all") {
  const list = getTaskList(filter);
  const title = filter === "open" ? "OPEN TASKS" :
    filter === "done" ? "COMPLETED TASKS" : "ALL TASKS";

  if (!list.length) {
    addMessage("assistant", `${title}\n\nThere are no tasks in this category.`);
    return;
  }

  const lines = list.map(task => {
    const number = tasks.indexOf(task) + 1;
    const state = task.done ? "[DONE]" : "[OPEN]";
    const due = task.dueDate ? ` | Due: ${task.dueDate}` : "";
    return `${number}. ${state} [${task.priority.toUpperCase()}] ${task.text}${due}`;
  });

  addMessage("assistant", `${title} (${list.length})\n\n${lines.join("\n")}`);
}

function completeTask(number) {
  const task = tasks[number - 1];
  if (!Number.isInteger(number) || !task) return false;
  task.done = true;
  if (!saveState()) return false;
  renderTasks();
  return true;
}

function reopenTask(number) {
  const task = tasks[number - 1];
  if (!Number.isInteger(number) || !task) return false;
  task.done = false;
  if (!saveState()) return false;
  renderTasks();
  return true;
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

/* NOTES */

function renderNotes() {
  noteList.innerHTML = "";
  const search = noteSearch.value.trim().toLowerCase();

  const visible = notes.filter(note =>
    note.title.toLowerCase().includes(search) ||
    note.content.toLowerCase().includes(search)
  );

  noteSummary.textContent =
    `${notes.length} saved ${notes.length === 1 ? "note" : "notes"}`;

  noteEmpty.hidden = visible.length > 0;
  noteEmpty.textContent = notes.length
    ? "No matching notes found."
    : "No notes yet. Create your first note above.";

  visible.forEach(note => {
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
  const cleanTitle = String(title).trim();
  const cleanContent = String(content).trim();
  if (!cleanTitle || !cleanContent) return false;

  const note = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: cleanTitle,
    content: cleanContent,
    createdAt: Date.now()
  };

  notes.unshift(note);
  if (!saveState()) {
    notes.shift();
    return false;
  }

  renderNotes();
  return true;
}

function editNote(id) {
  const note = notes.find(item => item.id === id);
  if (!note) return;

  const title = prompt("Note title:", note.title);
  if (title === null || !title.trim()) return;

  const content = prompt("Note content:", note.content);
  if (content === null || !content.trim()) return;

  note.title = title.trim();
  note.content = content.trim();
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

/* MEMORIES */

function saveMemory(value) {
  const clean = String(value).trim();
  if (!clean) return false;
  memories.push(clean);
  if (!saveState()) {
    memories.pop();
    return false;
  }
  return true;
}

function removeMemory(index) {
  if (!Number.isInteger(index) || index < 0 || index >= memories.length) {
    return false;
  }
  const removed = memories.splice(index, 1);
  if (!saveState()) {
    memories.splice(index, 0, ...removed);
    return false;
  }
  return true;
}

/* AI ACTION LAYER */

function performNaturalAction(input) {
  const text = input.trim();
  const lower = text.toLowerCase();

  let match;

  match = text.match(/^(?:please\s+)?(?:nova[, ]*)?(?:add|create|make)\s+(?:a\s+)?task\s+(?:to\s+)?(.+)$/i);
  if (match) {
    let taskText = match[1].trim();
    let priority = "normal";
    let dueDate = "";

    const priorityMatch = taskText.match(/\b(high|low|normal)\s+priority\b/i);
    if (priorityMatch) {
      priority = priorityMatch[1].toLowerCase();
      taskText = taskText.replace(priorityMatch[0], "").trim();
    }

    const dateMatch = taskText.match(/\b(?:on|for|due)\s+(\d{4}-\d{2}-\d{2})\b/i);
    if (dateMatch) {
      dueDate = dateMatch[1];
      taskText = taskText.replace(dateMatch[0], "").trim();
    }

    const success = addTask(taskText, priority, dueDate);
    addMessage("assistant", success
      ? `Task added and saved: ${taskText}`
      : "I couldn't save that task. Please check the task details.");
    return true;
  }

  match = text.match(/^(?:please\s+)?(?:nova[, ]*)?(?:remember|save to memory|memorize)\s+(?:that\s+)?(.+)$/i);
  if (match) {
    const success = saveMemory(match[1]);
    addMessage("assistant", success
      ? `Saved to memory: ${match[1]}`
      : "I couldn't save that memory.");
    return true;
  }

  if (/^(?:show|list|view)\s+(?:me\s+)?(?:my\s+)?memories$/.test(lower) ||
      lower === "what do you remember about me?") {
    addMessage("assistant", memories.length
      ? "SAVED MEMORIES\n\n" + memories.map((m, i) => `${i + 1}. ${m}`).join("\n")
      : "Your memory list is empty.");
    return true;
  }

  match = text.match(/^(?:please\s+)?(?:nova[, ]*)?(?:create|save|add)\s+(?:a\s+)?note(?:\s+(?:called|titled)\s+(.+?))?\s*(?:with content|:)\s*(.+)$/i);
  if (match) {
    const title = match[1] || "Untitled note";
    const content = match[2];
    const success = addNote(title, content);
    addMessage("assistant", success
      ? `Note "${title}" saved successfully.`
      : "I couldn't save that note.");
    return true;
  }

  if (/^(?:show|list|view)\s+(?:me\s+)?(?:my\s+)?notes$/.test(lower)) {
    addMessage("assistant", notes.length
      ? notes.map((n, i) => `${i + 1}. ${n.title}\n${n.content}`).join("\n\n")
      : "You have no saved notes.");
    return true;
  }

  if (/^(?:show|list|view)\s+(?:me\s+)?(?:my\s+)?tasks$/.test(lower) ||
      lower === "what are my tasks?") {
    showTasks("all");
    return true;
  }

  if (/^(?:show|list)\s+(?:my\s+)?open tasks$/.test(lower)) {
    showTasks("open");
    return true;
  }

  if (/^(?:show|list)\s+(?:my\s+)?completed tasks$/.test(lower)) {
    showTasks("done");
    return true;
  }

  match = lower.match(/^(?:mark|set|complete|finish)\s+(?:task\s*)#?(\d+)\s+(?:as\s+)?(?:done|complete|completed)$/);
  if (!match) {
    match = lower.match(/^(?:complete|finish)\s+task\s+#?(\d+)$/);
  }

  if (match) {
    const number = Number(match[1]);
    const success = completeTask(number);
    addMessage("assistant", success
      ? `Task ${number} marked as completed.`
      : `I couldn't find task ${number}. Ask me to show your tasks to check the numbers.`);
    return true;
  }

  match = lower.match(/^(?:reopen|restore)\s+task\s+#?(\d+)$/);
  if (match) {
    const number = Number(match[1]);
    const success = reopenTask(number);
    addMessage("assistant", success
      ? `Task ${number} reopened.`
      : `I couldn't find task ${number}.`);
    return true;
  }

  match = lower.match(/^(?:delete|remove)\s+task\s+#?(\d+)$/);
  if (match) {
    const number = Number(match[1]);
    const task = tasks[number - 1];

    if (!task) {
      addMessage("assistant", `I couldn't find task ${number}.`);
    } else if (confirm(`Delete task "${task.text}"?`)) {
      tasks.splice(number - 1, 1);
      const success = saveState();
      renderTasks();
      addMessage("assistant", success
        ? `Task deleted: ${task.text}`
        : "The task could not be deleted from storage.");
    } else {
      addMessage("assistant", "Deletion cancelled.");
    }
    return true;
  }

  match = lower.match(/^(?:forget|delete)\s+memory\s+#?(\d+)$/);
  if (match) {
    const number = Number(match[1]);
    const success = removeMemory(number - 1);
    addMessage("assistant", success
      ? `Memory ${number} deleted.`
      : `I couldn't find memory ${number}.`);
    return true;
  }

  return false;
}

/* LOCAL COMMANDS */

function handleCommand(text) {
  const command = text.trim();
  const lower = command.toLowerCase();

  if (lower === "/help") {
    addMessage("assistant",
`NOVA COMMANDS

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
/tasks open
/tasks done
/task done [number]
/task reopen [number]
/task delete [number]

Other:
/clear
/help`);
    return true;
  }

  if (lower.startsWith("/calc ")) {
    try {
      addMessage("assistant",
        `${command.slice(6)} = ${calculate(command.slice(6))}`);
    } catch (error) {
      addMessage("assistant", `Calculator error: ${error.message}`);
    }
    return true;
  }

  if (lower.startsWith("/remember ")) {
    const value = command.slice(10).trim();
    addMessage("assistant", saveMemory(value)
      ? "Saved to local memory."
      : "I couldn't save that memory.");
    return true;
  }

  if (lower === "/memories") {
    addMessage("assistant", memories.length
      ? memories.map((m, i) => `${i + 1}. ${m}`).join("\n")
      : "Your memory is empty.");
    return true;
  }

  if (lower.startsWith("/forget ")) {
    const target = command.slice(8).trim().toLowerCase();
    const index = memories.findIndex(m => m.toLowerCase().includes(target));
    addMessage("assistant", index >= 0 && target && removeMemory(index)
      ? "Memory deleted."
      : "I couldn't find that memory.");
    return true;
  }

  if (lower.startsWith("/note add ")) {
    const value = command.slice(10).trim();
    addMessage("assistant", addNote("Untitled note", value)
      ? "Note saved."
      : "I couldn't save that note.");
    return true;
  }

  if (lower === "/notes") {
    addMessage("assistant", notes.length
      ? notes.map((n, i) => `${i + 1}. ${n.title}\n${n.content}`).join("\n\n")
      : "You have no saved notes.");
    return true;
  }

  if (lower.startsWith("/note delete ")) {
    const number = Number(command.slice(13).trim());
    const note = notes[number - 1];

    if (!note) {
      addMessage("assistant", "That note number doesn't exist.");
    } else {
      notes.splice(number - 1, 1);
      saveState();
      renderNotes();
      addMessage("assistant", `Deleted note: ${note.title}`);
    }
    return true;
  }

  if (lower.startsWith("/task add ")) {
    const value = command.slice(10).trim();
    addMessage("assistant", addTask(value) ? "Task added." : "I couldn't add that task.");
    return true;
  }

  if (lower === "/tasks") { showTasks("all"); return true; }
  if (lower === "/tasks open") { showTasks("open"); return true; }
  if (lower === "/tasks done") { showTasks("done"); return true; }

  if (lower.startsWith("/task done ")) {
    const number = Number(command.slice(11).trim());
    addMessage("assistant", completeTask(number)
      ? `Completed task ${number}.` : "That task number doesn't exist.");
    return true;
  }

  if (lower.startsWith("/task reopen ")) {
    const number = Number(command.slice(13).trim());
    addMessage("assistant", reopenTask(number)
      ? `Reopened task ${number}.` : "That task number doesn't exist.");
    return true;
  }

  if (lower.startsWith("/task delete ")) {
    const number = Number(command.slice(13).trim());
    const task = tasks[number - 1];

    if (!task) {
      addMessage("assistant", "That task number doesn't exist.");
    } else if (confirm(`Delete "${task.text}"?`)) {
      tasks.splice(number - 1, 1);
      saveState();
      renderTasks();
      addMessage("assistant", "Task deleted.");
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

/* CALCULATOR */

function calculate(expression) {
  const tokens = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i];
    if (/\s/.test(char)) { i++; continue; }

    const remaining = expression.slice(i);
    const number = remaining.match(/^(?:\d+\.?\d*|\.\d+)/);

    if (number) {
      tokens.push(number[0]);
      i += number[0].length;
      continue;
    }

    if ("+-*/%()".includes(char)) {
      tokens.push(char);
      i++;
      continue;
    }

    throw new Error(`Invalid character: ${char}`);
  }

  let position = 0;

  function expressionValue() {
    let value = term();
    while (tokens[position] === "+" || tokens[position] === "-") {
      const op = tokens[position++];
      const right = term();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  function term() {
    let value = factor();
    while (["*", "/", "%"].includes(tokens[position])) {
      const op = tokens[position++];
      const right = factor();

      if ((op === "/" || op === "%") && right === 0) {
        throw new Error("Division by zero.");
      }

      if (op === "*") value *= right;
      if (op === "/") value /= right;
      if (op === "%") value %= right;
    }
    return value;
  }

  function factor() {
    const token = tokens[position];

    if (token === "+" || token === "-") {
      position++;
      const value = factor();
      return token === "-" ? -value : value;
    }

    if (token === "(") {
      position++;
      const value = expressionValue();
      if (tokens[position++] !== ")") {
        throw new Error("Missing closing parenthesis.");
      }
      return value;
    }

    if (token === undefined || !/^(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      throw new Error("Invalid calculation.");
    }

    position++;
    return Number(token);
  }

  if (!tokens.length) throw new Error("Enter a calculation.");
  const result = expressionValue();

  if (position !== tokens.length || !Number.isFinite(result)) {
    throw new Error("Invalid calculation.");
  }

  return Number(result.toPrecision(12)).toString();
}

/* ATTACHMENTS */

attachButton.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const selected = Array.from(fileInput.files || []);

  for (const file of selected) {
    if (attachments.some(item => item.name === file.name && item.size === file.size)) {
      continue;
    }

    const item = {
      name: file.name,
      size: file.size,
      type: file.type,
      file,
      text: "",
      imageUrl: ""
    };

    if (file.type.startsWith("image/")) {
      item.imageUrl = URL.createObjectURL(file);
    } else {
      try {
        item.text = await extractFileText(file);
      } catch (error) {
        item.text = `[Could not read ${file.name}: ${error.message}]`;
      }
    }

    attachments.push(item);
  }

  renderAttachments();
  fileInput.value = "";
});

function renderAttachments() {
  attachmentPreview.innerHTML = "";
  attachmentPreview.hidden = attachments.length === 0;

  attachments.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "attachment-item";

    if (item.imageUrl) {
      const image = document.createElement("img");
      image.src = item.imageUrl;
      image.alt = item.name;
      card.appendChild(image);
    }

    const name = document.createElement("span");
    name.textContent = item.name;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${item.name}`);
    remove.addEventListener("click", () => {
      if (attachments[index].imageUrl) {
        URL.revokeObjectURL(attachments[index].imageUrl);
      }
      attachments.splice(index, 1);
      renderAttachments();
    });

    card.append(name, remove);
    attachmentPreview.appendChild(card);
  });
}

async function extractFileText(file) {
  const extension = file.name.split(".").pop().toLowerCase();

  if (file.size > 12 * 1024 * 1024) {
    throw new Error("File is larger than 12 MB.");
  }

  if (["txt", "md", "csv", "json"].includes(extension) ||
      file.type.startsWith("text/")) {
    return (await file.text()).slice(0, MAX_ATTACHMENT_TEXT);
  }

  if (extension === "pdf" || file.type === "application/pdf") {
    const pdfjs = await import(
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs"
    );

    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    let output = "";

    const pageLimit = Math.min(pdf.numPages, 12);

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(" ");
      output += `\nPAGE ${pageNumber}\n${pageText}\n`;

      if (output.length >= MAX_ATTACHMENT_TEXT) break;
    }

    return output.slice(0, MAX_ATTACHMENT_TEXT);
  }

  if (extension === "docx") {
    const mammoth = await import(
      "https://cdn.jsdelivr.net/npm/mammoth@1.9.0/+esm"
    );

    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer()
    });

    return result.value.slice(0, MAX_ATTACHMENT_TEXT);
  }

  throw new Error("Unsupported file type.");
}

/* IMPORT FROM OTHER NOVA PAGES */

function readImportedContext() {
  try {
    const raw = localStorage.getItem(IMPORT_KEY);
    if (!raw) return null;

    const data = JSON.parse(raw);

    if (typeof data === "string") {
      return {
        name: "Imported content",
        type: "text",
        text: data
      };
    }

    if (!data || typeof data !== "object") return null;

    const text = String(
      data.text ??
      data.content ??
      data.caption ??
      data.description ??
      ""
    ).trim();

    if (!text) return null;

    return {
      name: String(data.name || data.filename || "Imported content"),
      type: String(data.type || "text"),
      text: text.slice(0, MAX_ATTACHMENT_TEXT)
    };
  } catch (error) {
    console.error("Could not read imported NOVA content:", error);
    return null;
  }
}

function refreshImportedContext() {
  const latest = readImportedContext();
  if (latest) importedContext = latest;
}

function clearImportedContext() {
  importedContext = null;

  try {
    localStorage.removeItem(IMPORT_KEY);
  } catch (error) {
    console.error("Could not clear imported content:", error);
  }
}

window.addEventListener("storage", event => {
  if (event.key === IMPORT_KEY) {
    refreshImportedContext();
  }
});

window.addEventListener("focus", refreshImportedContext);
window.addEventListener("pageshow", refreshImportedContext);

function buildAttachmentContext() {
  const readable = attachments
    .filter(item => item.text)
    .map(item => `FILE: ${item.name}\n${item.text}`)
    .join("\n\n");

  const images = attachments.filter(item => item.imageUrl);
  let result = readable;

  if (images.length) {
    result += (result ? "\n\n" : "") +
      `IMAGE ATTACHMENTS: ${images.map(item => item.name).join(", ")}.\n` +
      "The current text model cannot inspect image contents. Explain this limitation honestly.";
  }

  if (importedContext) {
    result += (result ? "\n\n" : "") +
      `IMPORTED FROM NOVA ${importedContext.type.toUpperCase()}: ${importedContext.name}\n` +
      importedContext.text;
  }

  return result.slice(0, MAX_ATTACHMENT_TEXT);
}

/* SYSTEM PROMPT */

function shortenText(value, limit) {
  return String(value ?? "").slice(0, limit);
}

function getSystemPrompt() {
  const memoryContext = memories.slice(-5)
    .map(item => "- " + shortenText(item, 180)).join("\n");

  const noteContext = notes.slice(0, 4)
    .map((item, i) =>
      `${i + 1}. ${shortenText(item.title, 80)}: ${shortenText(item.content, 250)}`
    ).join("\n");

  const taskContext = tasks.slice(0, 8)
    .map((item, i) =>
      `${i + 1}. ${item.done ? "[Completed]" : "[Open]"} [${item.priority}] ${shortenText(item.text, 120)}${item.dueDate ? " Due: " + item.dueDate : ""}`
    ).join("\n");

  return `You are NOVA, a private local AI assistant.

Answer clearly and directly. Do not invent facts.
You do not have internet access.
You must be honest about your abilities.
The app has a separate action system for tasks, notes and memories.
When the user asks you to change app data, follow the request through the available app actions when possible. Never claim an action happened unless the app confirms it.
If a file's text is provided, analyze that text.
If imported image-caption text is provided, use it as the available description of the image. Do not claim to see visual details beyond the description.
The current text model cannot directly inspect image pixels.

SAVED MEMORIES:
${memoryContext || "No saved memories."}

SAVED NOTES:
${noteContext || "No notes."}

TASKS:
${taskContext || "No tasks."}

ATTACHED AND IMPORTED CONTENT:
${attachmentContext || "No file content attached."}`;
}

/* LOCAL AI ENGINE */

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

    const webllm = await import(
      `https://esm.run/@mlc-ai/web-llm@${WEBLLM_VERSION}`
    );

    setStatus(`DOWNLOADING ${MODEL_NAME.toUpperCase()}`);

    engine = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback: report => {
        const progress = Math.max(5,
          Math.min(100, Math.round((report.progress || 0) * 100)));

        setProgress(report.text || "Loading model...", progress);
        setStatus(`LOADING ${MODEL_NAME.toUpperCase()}`);
      }
    });

    setProgress(`${MODEL_NAME} is ready.`, 100);
    setStatus("LOCAL AI READY");
    loadButton.textContent = "AI READY";

    addMessage("assistant",
      `NOVA is ready. I'm running locally on ${MODEL_NAME}.`);

  } catch (error) {
    engine = null;
    setStatus("AI NOT LOADED");
    setProgress(`Error: ${error.message}`, 0);
    loadButton.disabled = false;
    loadButton.textContent = "TRY AGAIN";
    addMessage("assistant", `I couldn't load the AI model.\n${error.message}`);
    console.error(error);
  } finally {
    loading = false;
  }
}

/* GENERATION */

function prepareConversation() {
  conversation = conversation
    .filter(message =>
      message &&
      ["user", "assistant"].includes(message.role) &&
      typeof message.content === "string"
    )
    .slice(-MAX_CONVERSATION_MESSAGES)
    .map(message => ({
      role: message.role,
      content: shortenText(message.content, MAX_MESSAGE_LENGTH)
    }));

  return conversation;
}

async function sendMessage(text) {
  const clean = text.trim();
  if (!clean || generating) return;

  addMessage("user", clean);

  if (handleCommand(clean)) return;
  if (performNaturalAction(clean)) return;

  refreshImportedContext();
  attachmentContext = buildAttachmentContext();

  if (!engine) {
    addMessage("assistant",
      "My AI model isn't loaded yet. Tap LOAD AI when you're ready.");
    return;
  }

  conversation.push({
    role: "user",
    content: shortenText(clean, MAX_MESSAGE_LENGTH)
  });

  prepareConversation();
  saveState();

  generating = true;
  sendButton.disabled = true;
  messageInput.disabled = true;
  attachButton.disabled = true;

  const replyBubble = addMessage("assistant", "Thinking...");

  try {
    setStatus("GENERATING RESPONSE");
    setProgress("NOVA is thinking...", 100);

    const response = await engine.chat.completions.create({
      messages: [
        { role: "system", content: getSystemPrompt() },
        ...conversation
      ],
      temperature: 0.4,
      top_p: 0.9,
      max_tokens: MAX_TOKENS
    });

    const answer =
      response.choices?.[0]?.message?.content?.trim() ||
      "I couldn't generate a response.";

    replyBubble.textContent = answer;

    conversation.push({ role: "assistant", content: answer });
    prepareConversation();

    const last = displayHistory[displayHistory.length - 1];
    if (last) last.text = answer;

    setStatus("LOCAL AI READY");
    setProgress(`${MODEL_NAME} is ready.`, 100);
    saveState();

  } catch (error) {
    const errorText = `Generation error: ${error.message}`;
    replyBubble.textContent = errorText;

    conversation = conversation.filter(message =>
      !(message.role === "user" &&
        message.content === shortenText(clean, MAX_MESSAGE_LENGTH))
    );

    const last = displayHistory[displayHistory.length - 1];
    if (last) last.text = errorText;

    setStatus("GENERATION ERROR");
    setProgress("Try a shorter question.", 0);
    saveState();
    console.error("Generation error:", error);

  } finally {
    generating = false;
    sendButton.disabled = false;
    messageInput.disabled = false;
    attachButton.disabled = false;
    messageInput.focus();
    chatMessages.scrollTop = chatMessages.scrollHeight;

    attachmentContext = "";
    clearImportedContext();
  }
}

/* EVENTS */

loadButton.addEventListener("click", loadAI);

chatForm.addEventListener("submit", async event => {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (!text || generating) return;

  messageInput.value = "";
  await sendMessage(text);
});

/* STARTUP */

refreshImportedContext();

saveState();
renderTasks();
renderNotes();
restoreConversation();

setStatus("AI NOT LOADED");
setProgress("NOVA is ready. Load the AI when you want.", 0);
loadButton.disabled = false;
loadButton.textContent = "LOAD AI";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .catch(error => console.error("Service worker error:", error));
  });
}
