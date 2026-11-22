
const chat = document.getElementById("chat");
const form = document.getElementById("messageForm");
const input = document.getElementById("messageInput");
const memoryPanel = document.getElementById("memoryPanel");
const memoryList = document.getElementById("memoryList");

let memories = JSON.parse(
    localStorage.getItem("nova_memories") || "[]"
);

function saveMemories() {
    localStorage.setItem(
        "nova_memories",
        JSON.stringify(memories)
    );
}

function addMessage(text, isUser = false) {
    const welcome = chat.querySelector(".welcome");
    if (welcome) welcome.remove();

    const message = document.createElement("div");
    message.className = "message " +
        (isUser ? "user" : "assistant");

    message.textContent = text;
    chat.appendChild(message);

    chat.scrollTop = chat.scrollHeight;
}

function respond(text) {
    const command = text.trim();
    const lower = command.toLowerCase();

    if (lower === "/help") {
        return `NOVA COMMANDS

/help
/remember [information]
/memories
/forget [information]
/clear`;
    }

    if (lower.startsWith("/remember ")) {
        const memory = command.substring(10).trim();

        if (!memory) return "Please provide something to remember.";

        memories.push(memory);
        saveMemories();

        return "Memory saved locally.";
    }

    if (lower === "/memories") {
        if (memories.length === 0) {
            return "Your memory is empty.";
        }

        return memories.map(
            (memory, index) => `${index + 1}. ${memory}`
        ).join("\n");
    }

    if (lower.startsWith("/forget ")) {
        const target = command.substring(8).toLowerCase();

        const previousLength = memories.length;

        memories = memories.filter(
            memory => !memory.toLowerCase().includes(target)
        );

        saveMemories();

        return memories.length === previousLength
            ? "No matching memory found."
            : "Matching memories deleted.";
    }

    if (lower === "/clear") {
        chat.innerHTML = "";
        return "Conversation cleared.";
    }

    return `I received your message:

"${command}"

My AI model has not been connected yet.`;
}

form.addEventListener("submit", event => {
    event.preventDefault();

    const text = input.value.trim();
    if (!text) return;

    addMessage(text, true);
    input.value = "";

    const answer = respond(text);

    addMessage(answer);
});

document.getElementById("clearButton")
    .addEventListener("click", () => {
        chat.innerHTML = `
            <div class="welcome">
                <h2>How can I help?</h2>
                <p>Your personal assistant.</p>
            </div>
        `;
    });

document.getElementById("helpButton")
    .addEventListener("click", () => {
        addMessage("/help", true);
        addMessage(respond("/help"));
    });

document.getElementById("memoryButton")
    .addEventListener("click", () => {
        renderMemories();
        memoryPanel.classList.remove("hidden");
    });

document.getElementById("closeMemory")
    .addEventListener("click", () => {
        memoryPanel.classList.add("hidden");
    });

function renderMemories() {
    memoryList.innerHTML = "";

    if (memories.length === 0) {
        memoryList.textContent = "No saved memories.";
        return;
    }

    memories.forEach((memory, index) => {
        const item = document.createElement("div");
        item.className = "memory-item";

        const text = document.createElement("span");
        text.textContent = memory;

        const remove = document.createElement("button");
        remove.textContent = "DELETE";

        remove.addEventListener("click", () => {
            memories.splice(index, 1);
            saveMemories();
            renderMemories();
        });

        item.appendChild(text);
        item.appendChild(remove);
        memoryList.appendChild(item);
    });
}
