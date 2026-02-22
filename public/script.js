// ============================================
// script.js — Multi-User Client-Side Logic
// ============================================
// Handles: role selection, joining rooms,
// user list, messaging, typing, admin kick.

const socket = io();

// --- DOM References ---
const joinScreen = document.getElementById("join-screen");
const chatScreen = document.getElementById("chat-screen");

// Join screen
const roleSelect = document.getElementById("role-select");
const usernameInput = document.getElementById("username-input");
const pinInput = document.getElementById("pin-input");
const joinBtn = document.getElementById("join-btn");
const joinBtnText = document.getElementById("join-btn-text");
const errorMsg = document.getElementById("error-msg");

// Chat screen
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const userCountEl = document.getElementById("user-count");
const userListEl = document.getElementById("user-list");
const myRoleBadge = document.getElementById("my-role-badge");
const myNameEl = document.getElementById("my-name");
const statusText = document.getElementById("status-text");
const onlineBadge = document.getElementById("online-badge");
const messagesContainer = document.getElementById("messages-container");
const msgInput = document.getElementById("msg-input");
const sendBtn = document.getElementById("send-btn");
const typingIndicator = document.getElementById("typing-indicator");
const typingName = document.getElementById("typing-name");

// --- State ---
let myUsername = "";
let myRole = "";
let typingTimeout = null;
let typingUsers = new Set();

// ============================================
// JOIN SCREEN LOGIC
// ============================================

// Change button text based on role
roleSelect.addEventListener("change", () => {
    joinBtnText.textContent =
        roleSelect.value === "admin" ? "Create Room" : "Join Room";
});

// Allow only numeric PIN
pinInput.addEventListener("input", () => {
    pinInput.value = pinInput.value.replace(/\D/g, "");
    errorMsg.textContent = "";
});

// Enter key submits
usernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pinInput.focus();
});
pinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinBtn.click();
});

// Join button
joinBtn.addEventListener("click", () => {
    const role = roleSelect.value;
    const username = usernameInput.value.trim();
    const pin = pinInput.value.trim();

    if (!username) {
        errorMsg.textContent = "Please enter your display name.";
        shakeElement(usernameInput);
        return;
    }
    if (!pin) {
        errorMsg.textContent = "Please enter a numeric PIN.";
        shakeElement(pinInput);
        return;
    }

    joinBtn.disabled = true;
    joinBtnText.textContent = "Joining…";

    socket.emit("join-room", { username, pin, role });
});

// --- Server: success ---
socket.on("join-success", ({ username, role, users }) => {
    myUsername = username;
    myRole = role;

    // Switch screens
    joinScreen.classList.remove("active");
    chatScreen.classList.add("active");

    // Set sidebar footer
    myRoleBadge.textContent = role === "admin" ? "👑 Admin" : "👤 User";
    myRoleBadge.className = `role-badge ${role}`;
    myNameEl.textContent = username;

    // Populate user list
    renderUserList(users);

    msgInput.focus();
});

// --- Server: error ---
socket.on("join-error", (msg) => {
    errorMsg.textContent = msg;
    joinBtn.disabled = false;
    joinBtnText.textContent =
        roleSelect.value === "admin" ? "Create Room" : "Join Room";
    shakeElement(joinBtn);
});

// ============================================
// CHAT LOGIC
// ============================================

// Send message
function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;
    socket.emit("send-message", { message: text });
    socket.emit("stop-typing");
    msgInput.value = "";
    msgInput.focus();
}

sendBtn.addEventListener("click", sendMessage);
msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
});

// Typing indicator
msgInput.addEventListener("input", () => {
    socket.emit("typing");
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit("stop-typing");
    }, 1500);
});

// Receive message
socket.on("receive-message", ({ sender, role, message, time }) => {
    const isSelf = sender === myUsername;
    appendMessage(sender, role, message, time, isSelf);
});

// Typing events
socket.on("user-typing", ({ username }) => {
    typingUsers.add(username);
    updateTypingIndicator();
});

socket.on("user-stop-typing", ({ username }) => {
    typingUsers.delete(username);
    updateTypingIndicator();
});

// User joined / left
socket.on("user-joined", ({ username, role, users }) => {
    appendSystemMessage(`${username} joined the room`);
    renderUserList(users);
});

socket.on("user-left", ({ username, kicked, users }) => {
    const msg = kicked
        ? `${username} was removed by Admin`
        : `${username} left the room`;
    appendSystemMessage(msg);
    typingUsers.delete(username);
    updateTypingIndicator();
    renderUserList(users);
});

// Kicked
socket.on("kicked", (msg) => {
    alert(msg);
    location.reload();
});

// Room closed by admin
socket.on("room-closed", (msg) => {
    alert(msg);
    location.reload();
});

// Sidebar toggle & close
sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
});

const sidebarClose = document.getElementById("sidebar-close");
sidebarClose.addEventListener("click", () => {
    sidebar.classList.add("collapsed");
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Render the sidebar user list.
 */
function renderUserList(users) {
    userListEl.innerHTML = "";
    userCountEl.textContent = users.length;
    onlineBadge.textContent = `${users.length} online`;

    users.forEach((u) => {
        const li = document.createElement("li");

        const avatarClass =
            u.role === "admin" ? "admin-avatar" : "user-avatar-color";
        const initial = u.username.charAt(0).toUpperCase();
        const roleTag =
            u.role === "admin"
                ? `<span class="role-tag admin">Admin</span>`
                : `<span class="role-tag user">User</span>`;

        let kickHtml = "";
        // Show kick button if I am admin and this is not me
        if (
            myRole === "admin" &&
            u.username !== myUsername &&
            u.role !== "admin"
        ) {
            kickHtml = `<button class="kick-btn" data-user="${escapeHtml(
                u.username
            )}" title="Remove user">✕</button>`;
        }

        li.innerHTML = `
      <div class="user-avatar ${avatarClass}">${initial}</div>
      <div class="user-info">
        <div class="uname">${escapeHtml(u.username)}</div>
      </div>
      ${roleTag}
      ${kickHtml}
    `;

        userListEl.appendChild(li);
    });

    // Attach kick handlers
    document.querySelectorAll(".kick-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = btn.getAttribute("data-user");
            if (confirm(`Remove "${target}" from the room?`)) {
                socket.emit("kick-user", { targetUsername: target });
            }
        });
    });
}

/**
 * Append a chat message bubble.
 */
function appendMessage(sender, role, message, time, isSelf) {
    const row = document.createElement("div");
    const isAdmin = role === "admin";
    let classes = `message-row ${isSelf ? "self" : "other"}`;
    if (!isSelf && isAdmin) classes += " admin-msg";
    row.className = classes;

    const senderNameClass = isAdmin ? "sender-name admin-name" : "sender-name";
    const miniRole = isAdmin
        ? `<span class="mini-role admin">admin</span>`
        : "";

    row.innerHTML = `
    <span class="msg-sender">
      <span class="${senderNameClass}">${escapeHtml(sender)}</span>
      ${miniRole}
    </span>
    <div class="msg-bubble">${escapeHtml(message)}</div>
    <span class="msg-time">${time}</span>
  `;

    messagesContainer.appendChild(row);
    scrollToBottom();
}

/**
 * Append a system message.
 */
function appendSystemMessage(text) {
    const el = document.createElement("div");
    el.className = "system-msg";
    el.textContent = text;
    messagesContainer.appendChild(el);
    scrollToBottom();
}

/**
 * Update typing indicator for multiple users.
 */
function updateTypingIndicator() {
    if (typingUsers.size === 0) {
        typingIndicator.classList.add("hidden");
    } else {
        const names = Array.from(typingUsers).join(", ");
        typingName.textContent = names;
        typingIndicator.classList.remove("hidden");
        scrollToBottom();
    }
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function shakeElement(el) {
    el.style.animation = "shake 0.35s ease";
    el.addEventListener("animationend", () => { el.style.animation = ""; }, { once: true });
}

// Inject shake animation
const style = document.createElement("style");
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-6px); }
    40% { transform: translateX(6px); }
    60% { transform: translateX(-4px); }
    80% { transform: translateX(4px); }
  }
`;
document.head.appendChild(style);
