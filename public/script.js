// ============================================
// script.js — Client-Side Chat Logic
// ============================================
// Handles: PIN submission, joining rooms,
// sending/receiving messages, typing indicators.

// --- Connect to the Socket.io server ---
const socket = io();

// --- DOM References ---
const joinScreen = document.getElementById("join-screen");
const chatScreen = document.getElementById("chat-screen");

// Join screen elements
const usernameSelect = document.getElementById("username-select");
const pinInput = document.getElementById("pin-input");
const joinBtn = document.getElementById("join-btn");
const errorMsg = document.getElementById("error-msg");

// Chat screen elements
const statusText = document.getElementById("status-text");
const onlineBadge = document.getElementById("online-badge");
const messagesContainer = document.getElementById("messages-container");
const msgInput = document.getElementById("msg-input");
const sendBtn = document.getElementById("send-btn");
const typingIndicator = document.getElementById("typing-indicator");
const typingName = document.getElementById("typing-name");

// --- State ---
let myUsername = "";
let typingTimeout = null;

// ============================================
// JOIN LOGIC
// ============================================

// Allow only numeric input for PIN
pinInput.addEventListener("input", () => {
    pinInput.value = pinInput.value.replace(/\D/g, "");
    errorMsg.textContent = "";
});

// Submit on Enter key
pinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinBtn.click();
});

// Join button click
joinBtn.addEventListener("click", () => {
    const username = usernameSelect.value;
    const pin = pinInput.value.trim();

    // Basic validation
    if (!pin) {
        errorMsg.textContent = "Please enter a numeric PIN.";
        shakeElement(pinInput);
        return;
    }

    // Disable button while waiting
    joinBtn.disabled = true;
    joinBtn.textContent = "Joining…";

    // Send join request to server
    socket.emit("join-room", { username, pin });
});

// --- Server: join success ---
socket.on("join-success", ({ username, usersInRoom }) => {
    myUsername = username;

    // Switch screens
    joinScreen.classList.remove("active");
    chatScreen.classList.add("active");

    // Update header
    updateOnlineStatus(usersInRoom);

    // Focus the message input
    msgInput.focus();
});

// --- Server: join error ---
socket.on("join-error", (msg) => {
    errorMsg.textContent = msg;
    joinBtn.disabled = false;
    joinBtn.textContent = "Join Room";
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

// --- Typing indicator ---
msgInput.addEventListener("input", () => {
    socket.emit("typing");

    // Stop typing after 1.5s of inactivity
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit("stop-typing");
    }, 1500);
});

// --- Receive message from server ---
socket.on("receive-message", ({ sender, message, time }) => {
    const isSelf = sender === myUsername;
    appendMessage(sender, message, time, isSelf);
});

// --- Typing events ---
socket.on("user-typing", ({ username }) => {
    typingName.textContent = username;
    typingIndicator.classList.remove("hidden");
    scrollToBottom();
});

socket.on("user-stop-typing", () => {
    typingIndicator.classList.add("hidden");
});

// --- User joined / left ---
socket.on("user-joined", ({ username, usersInRoom }) => {
    appendSystemMessage(`${username} joined the room`);
    updateOnlineStatus(usersInRoom);
});

socket.on("user-left", ({ username, usersInRoom }) => {
    appendSystemMessage(`${username} left the room`);
    updateOnlineStatus(usersInRoom);
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Append a chat message bubble to the messages container.
 */
function appendMessage(sender, message, time, isSelf) {
    const row = document.createElement("div");
    row.className = `message-row ${isSelf ? "self" : "other"}`;

    row.innerHTML = `
    <span class="msg-sender">${escapeHtml(sender)}</span>
    <div class="msg-bubble">${escapeHtml(message)}</div>
    <span class="msg-time">${time}</span>
  `;

    messagesContainer.appendChild(row);
    scrollToBottom();
}

/**
 * Append a system message (e.g., "User1 joined the room").
 */
function appendSystemMessage(text) {
    const el = document.createElement("div");
    el.className = "system-msg";
    el.textContent = text;
    messagesContainer.appendChild(el);
    scrollToBottom();
}

/**
 * Update the online badge and status text.
 */
function updateOnlineStatus(count) {
    onlineBadge.textContent = `${count} / 2 online`;
    if (count === 2) {
        statusText.textContent = "Both users connected ✓";
        statusText.style.color = "#00cec9";
    } else {
        statusText.textContent = "Waiting for partner…";
        statusText.style.color = "";
    }
}

/**
 * Scroll the messages container to the bottom.
 */
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Shake animation for error feedback.
 */
function shakeElement(el) {
    el.classList.add("shake");
    el.style.animation = "shake 0.35s ease";
    el.addEventListener(
        "animationend",
        () => {
            el.style.animation = "";
        },
        { once: true }
    );
}

// Add shake keyframes dynamically
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
