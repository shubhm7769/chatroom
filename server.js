// ============================================
// server.js — Multi-User Chatroom Backend
// ============================================
// Supports 10+ users per room with Admin/User roles.
// Admin creates the room; Users join with the same PIN.

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
// rooms Map:
//   key   = PIN (string)
//   value = {
//     admin: username (string),
//     users: [ { socketId, username, role } ]
//   }

const rooms = new Map();

// ============================================
// Socket.io Connection Handling
// ============================================
io.on("connection", (socket) => {
    console.log(`✅ New connection: ${socket.id}`);

    // ------------------------------------------
    // Event: "join-room"
    // Client sends { username, pin, role }
    // role = "admin" or "user"
    // ------------------------------------------
    socket.on("join-room", ({ username, pin, role }) => {
        // Validate inputs
        if (!username || !pin || !role) {
            socket.emit("join-error", "All fields are required.");
            return;
        }

        // Sanitize
        const roomPin = String(pin).trim();
        const cleanName = String(username).trim();
        const cleanRole = String(role).toLowerCase();

        if (cleanName.length < 1 || cleanName.length > 20) {
            socket.emit("join-error", "Username must be 1–20 characters.");
            return;
        }

        // --- ADMIN wants to create a room ---
        if (cleanRole === "admin") {
            if (rooms.has(roomPin)) {
                socket.emit("join-error", "A room with this PIN already exists. Choose a different PIN.");
                return;
            }

            // Create the room with this user as admin
            rooms.set(roomPin, {
                admin: cleanName,
                users: [{ socketId: socket.id, username: cleanName, role: "admin" }],
            });

            socket.join(roomPin);
            socket.roomPin = roomPin;
            socket.username = cleanName;
            socket.role = "admin";

            console.log(`👑 Admin "${cleanName}" created room [${roomPin}]`);

            socket.emit("join-success", {
                username: cleanName,
                role: "admin",
                users: [{ username: cleanName, role: "admin" }],
            });

            return;
        }

        // --- USER wants to join an existing room ---
        if (cleanRole === "user") {
            if (!rooms.has(roomPin)) {
                socket.emit("join-error", "No room found with this PIN. Ask your Admin for the correct PIN.");
                return;
            }

            const room = rooms.get(roomPin);

            // Check duplicate username
            if (room.users.some((u) => u.username.toLowerCase() === cleanName.toLowerCase())) {
                socket.emit("join-error", `"${cleanName}" is already taken. Choose a different name.`);
                return;
            }

            // Add user to room
            room.users.push({ socketId: socket.id, username: cleanName, role: "user" });

            socket.join(roomPin);
            socket.roomPin = roomPin;
            socket.username = cleanName;
            socket.role = "user";

            console.log(`👤 User "${cleanName}" joined room [${roomPin}]`);

            // Build user list for broadcast
            const userList = room.users.map((u) => ({ username: u.username, role: u.role }));

            // Tell joining user they're in
            socket.emit("join-success", {
                username: cleanName,
                role: "user",
                users: userList,
            });

            // Notify everyone in the room
            io.to(roomPin).emit("user-joined", {
                username: cleanName,
                role: "user",
                users: userList,
            });

            return;
        }

        socket.emit("join-error", "Invalid role selected.");
    });

    // ------------------------------------------
    // Event: "send-message"
    // ------------------------------------------
    socket.on("send-message", ({ message }) => {
        if (!socket.roomPin || !message) return;

        const now = new Date();
        const time = now.toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });

        const msgData = {
            sender: socket.username,
            role: socket.role,
            message,
            time,
        };

        io.to(socket.roomPin).emit("receive-message", msgData);
        console.log(`💬 [${socket.roomPin}] ${socket.username}: ${message}`);
    });

    // ------------------------------------------
    // Event: "kick-user" (Admin only)
    // ------------------------------------------
    socket.on("kick-user", ({ targetUsername }) => {
        if (!socket.roomPin || socket.role !== "admin") return;

        const room = rooms.get(socket.roomPin);
        if (!room) return;

        const target = room.users.find(
            (u) => u.username === targetUsername && u.role !== "admin"
        );
        if (!target) return;

        // Notify the kicked user
        const targetSocket = io.sockets.sockets.get(target.socketId);
        if (targetSocket) {
            targetSocket.emit("kicked", "You have been removed by the Admin.");
            targetSocket.leave(socket.roomPin);
            targetSocket.roomPin = null;
            targetSocket.username = null;
            targetSocket.role = null;
        }

        // Remove from room
        room.users = room.users.filter((u) => u.socketId !== target.socketId);

        const userList = room.users.map((u) => ({ username: u.username, role: u.role }));

        io.to(socket.roomPin).emit("user-left", {
            username: targetUsername,
            kicked: true,
            users: userList,
        });

        console.log(`🚫 Admin kicked "${targetUsername}" from room [${socket.roomPin}]`);
    });

    // ------------------------------------------
    // Event: "typing"
    // ------------------------------------------
    socket.on("typing", () => {
        if (!socket.roomPin) return;
        socket.to(socket.roomPin).emit("user-typing", {
            username: socket.username,
        });
    });

    socket.on("stop-typing", () => {
        if (!socket.roomPin) return;
        socket.to(socket.roomPin).emit("user-stop-typing", {
            username: socket.username,
        });
    });

    // ------------------------------------------
    // Event: "disconnect"
    // ------------------------------------------
    socket.on("disconnect", () => {
        console.log(`❌ Disconnected: ${socket.id}`);

        if (socket.roomPin && rooms.has(socket.roomPin)) {
            const room = rooms.get(socket.roomPin);

            // Remove user
            room.users = room.users.filter((u) => u.socketId !== socket.id);

            const userList = room.users.map((u) => ({ username: u.username, role: u.role }));

            // If admin left, close the entire room
            if (socket.role === "admin") {
                io.to(socket.roomPin).emit("room-closed", "Admin has left. The room is now closed.");
                // Disconnect all remaining sockets from the room
                for (const u of room.users) {
                    const s = io.sockets.sockets.get(u.socketId);
                    if (s) {
                        s.leave(socket.roomPin);
                        s.roomPin = null;
                    }
                }
                rooms.delete(socket.roomPin);
                console.log(`🗑️  Room [${socket.roomPin}] closed (admin left).`);
            } else {
                // Normal user left
                io.to(socket.roomPin).emit("user-left", {
                    username: socket.username,
                    kicked: false,
                    users: userList,
                });

                // If room is empty, delete it
                if (room.users.length === 0) {
                    rooms.delete(socket.roomPin);
                    console.log(`🗑️  Room [${socket.roomPin}] deleted (empty).`);
                }
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
