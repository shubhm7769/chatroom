// ============================================
// server.js — Real-Time Private Chatroom Backend
// ============================================
// This file sets up an Express server with Socket.io
// for real-time, PIN-based private chat between two users.

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

// --- Create Express app and HTTP server ---
const app = express();
const server = http.createServer(app);

// --- Attach Socket.io to the HTTP server ---
const io = new Server(server);

// --- Serve static files from the "public" folder ---
app.use(express.static(path.join(__dirname, "public")));

// ============================================
// Room Management
// ============================================
// We store rooms as a Map:
//   key   = PIN (string)
//   value = array of { socketId, username }
// Each room can hold at most 2 users.

const rooms = new Map();

// ============================================
// Socket.io Connection Handling
// ============================================
io.on("connection", (socket) => {
    console.log(`✅ New connection: ${socket.id}`);

    // ------------------------------------------
    // Event: "join-room"
    // The client sends { username, pin } to join.
    // ------------------------------------------
    socket.on("join-room", ({ username, pin }) => {
        // Validate inputs
        if (!username || !pin) {
            socket.emit("join-error", "Username and PIN are required.");
            return;
        }

        // Make sure PIN is treated as a string
        const roomPin = String(pin);

        // Create room entry if it doesn't exist yet
        if (!rooms.has(roomPin)) {
            rooms.set(roomPin, []);
        }

        const room = rooms.get(roomPin);

        // Check: room already full (2 users max)
        if (room.length >= 2) {
            socket.emit("join-error", "This room is already full (2/2 users).");
            return;
        }

        // Check: same username already in the room
        if (room.some((u) => u.username === username)) {
            socket.emit(
                "join-error",
                `"${username}" is already in this room. Pick the other name.`
            );
            return;
        }

        // --- All checks passed — add user to the room ---
        room.push({ socketId: socket.id, username });
        socket.join(roomPin); // Socket.io room
        socket.roomPin = roomPin; // Store on socket for cleanup
        socket.username = username;

        console.log(`👤 ${username} joined room [${roomPin}]`);

        // Tell this user they joined successfully
        socket.emit("join-success", {
            username,
            usersInRoom: room.length,
        });

        // Notify everyone in the room that a new user joined
        io.to(roomPin).emit("user-joined", {
            username,
            usersInRoom: room.length,
        });
    });

    // ------------------------------------------
    // Event: "send-message"
    // The client sends { message }.
    // We broadcast it to everyone in the same room.
    // ------------------------------------------
    socket.on("send-message", ({ message }) => {
        if (!socket.roomPin || !message) return;

        // Build the message object with timestamp
        const now = new Date();
        const time = now.toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });

        const msgData = {
            sender: socket.username,
            message,
            time,
        };

        // Send to everyone in the room (including sender)
        io.to(socket.roomPin).emit("receive-message", msgData);
        console.log(`💬 [${socket.roomPin}] ${socket.username}: ${message}`);
    });

    // ------------------------------------------
    // Event: "typing"
    // Broadcast typing indicator to the other user.
    // ------------------------------------------
    socket.on("typing", () => {
        if (!socket.roomPin) return;
        socket.to(socket.roomPin).emit("user-typing", {
            username: socket.username,
        });
    });

    socket.on("stop-typing", () => {
        if (!socket.roomPin) return;
        socket.to(socket.roomPin).emit("user-stop-typing");
    });

    // ------------------------------------------
    // Event: "disconnect"
    // Clean up the room when a user leaves.
    // ------------------------------------------
    socket.on("disconnect", () => {
        console.log(`❌ Disconnected: ${socket.id}`);

        if (socket.roomPin && rooms.has(socket.roomPin)) {
            const room = rooms.get(socket.roomPin);

            // Remove this user from the room array
            const updatedRoom = room.filter((u) => u.socketId !== socket.id);
            rooms.set(socket.roomPin, updatedRoom);

            // Notify remaining users
            io.to(socket.roomPin).emit("user-left", {
                username: socket.username,
                usersInRoom: updatedRoom.length,
            });

            // If room is empty, delete it
            if (updatedRoom.length === 0) {
                rooms.delete(socket.roomPin);
                console.log(`🗑️  Room [${socket.roomPin}] deleted (empty).`);
            }
        }
    });
});

// ============================================
// Start the server
// ============================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 Chatroom server running at http://localhost:${PORT}\n`);
});
