import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" }
  });

  // Basic API route
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  interface Player {
    id: string;
    name: string;
    colorIdx: number;
    isHost: boolean;
  }

  interface RoomInfo {
    roomId: string;
    players: Player[];
  }

  const rooms = new Map<string, RoomInfo>();

  // Multiplayer logic
  io.on("connection", (socket) => {
    console.log("User connected", socket.id);

    const getUniqueDefaultName = (currentPlayers: Player[]) => {
      let num = 1;
      while (currentPlayers.some(p => p.name === `PLAYER ${num}`)) {
        num++;
      }
      return `PLAYER ${num}`;
    };

    const handlePlayerLeave = (roomId: string, socketId: string) => {
      const room = rooms.get(roomId);
      if (room) {
        room.players = room.players.filter(p => p.id !== socketId);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          // If the host left, assign the first player as the new host
          if (!room.players.some(p => p.isHost)) {
            room.players[0].isHost = true;
          }
          io.to(roomId).emit("lobby_players", room.players);
          io.to(roomId).emit("player_left", socketId);
        }
      }
    };

    socket.on("create_room", (arg1, arg2) => {
      const cb = typeof arg1 === "function" ? arg1 : arg2;
      const clientData = typeof arg1 === "object" ? arg1 : { name: "PLAYER" };

      let roomId = "";
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      do {
        roomId = "";
        for (let i = 0; i < 4; i++) {
          roomId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
      } while (rooms.has(roomId));
      socket.join(roomId);

      const clientName = (clientData.name || "").trim().toUpperCase();
      const isDefaultName = !clientName || clientName === "PLAYER" || clientName === "HOST";
      const assignedName = isDefaultName ? "PLAYER 1" : clientData.name;

      const hostPlayer: Player = {
        id: socket.id,
        name: assignedName,
        colorIdx: 0, // Green (at index 0)
        isHost: true
      };

      rooms.set(roomId, {
        roomId,
        players: [hostPlayer]
      });

      io.to(roomId).emit("lobby_players", [hostPlayer]);
      if (cb) cb({ roomId, colorIdx: 0 });
    });

    socket.on("join_room", (roomId, arg2, arg3) => {
      const cb = typeof arg2 === "function" ? arg2 : arg3;
      const clientData = typeof arg2 === "object" ? arg2 : { name: "PLAYER" };
      const roomIdUpper = roomId.toUpperCase();
      const ioRoom = io.sockets.adapter.rooms.get(roomIdUpper);

      if (ioRoom) {
        socket.join(roomIdUpper);

        let room = rooms.get(roomIdUpper);
        if (!room) {
          room = { roomId: roomIdUpper, players: [] };
          rooms.set(roomIdUpper, room);
        }

        const isHost = room.players.length === 0 || !room.players.some(p => p.isHost);

        // Calculate available colors
        const usedColors = room.players.map(p => p.colorIdx);
        const availableColors = [0, 1, 2, 3, 4].filter(c => !usedColors.includes(c));
        let chosenColor = 0;

        if (isHost) {
          chosenColor = 0; // Green
        } else if (availableColors.length > 0) {
          // Assign random color that no other player is currently using
          chosenColor = availableColors[Math.floor(Math.random() * availableColors.length)];
        } else {
          chosenColor = Math.floor(Math.random() * 5);
        }

        const clientName = (clientData.name || "").trim().toUpperCase();
        const isDefaultName = !clientName || clientName === "PLAYER" || clientName === "HOST";
        const assignedName = isDefaultName ? getUniqueDefaultName(room.players) : clientData.name;

        const newPlayer: Player = {
          id: socket.id,
          name: assignedName,
          colorIdx: chosenColor,
          isHost
        };

        room.players.push(newPlayer);

        socket.to(roomIdUpper).emit("player_joined", socket.id);
        io.to(roomIdUpper).emit("lobby_players", room.players);

        if (cb) cb({ success: true, hostId: room.players.find(p => p.isHost)?.id || socket.id, colorIdx: chosenColor });
      } else {
        if (cb) cb({ success: false, error: "Room not found" });
      }
    });
    
    socket.on("update_profile", (roomId, data) => {
      if (!roomId || !data) return;
      const roomIdUpper = roomId.toUpperCase();
      const room = rooms.get(roomIdUpper);
      if (room) {
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
          if (data.name !== undefined) {
            player.name = data.name;
          }
          if (data.colorIdx !== undefined) {
            // Verify chosen color index is not currently taken by any other lobby player
            const isTaken = room.players.some(p => p.id !== socket.id && p.colorIdx === data.colorIdx);
            if (!isTaken) {
              player.colorIdx = data.colorIdx;
            }
          }
          io.to(roomIdUpper).emit("lobby_players", room.players);
        }
      }
    });

    socket.on("leave_room", (roomId) => {
      if (!roomId) return;
      socket.leave(roomId);
      handlePlayerLeave(roomId, socket.id);
    });

    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          handlePlayerLeave(room, socket.id);
        }
      }
    });

    // Host sends complete game state strictly for syncing visuals for clients
    socket.on("host_game_state", (roomId, state) => {
      if (!roomId) return;
      socket.to(roomId).volatile.emit("game_state", state);
    });

    // Client sends input states (keyboard/mouse) for movement
    socket.on("client_input", (roomId, input) => {
      if (!roomId) return;
      socket.to(roomId).volatile.emit("client_input", socket.id, input);
    });

    // Claim room host when current host is inactive/throttled
    socket.on("claim_host", (roomId) => {
      if (!roomId) return;
      const roomIdUpper = roomId.toUpperCase();
      const room = rooms.get(roomIdUpper);
      if (room) {
        // Demote existing hosts
        room.players.forEach(p => p.isHost = false);
        // Elevate the claimant
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
          player.isHost = true;
        }
        io.to(roomIdUpper).emit("lobby_players", room.players);
      }
    });

    // Client interaction triggers (shoot, build, dash)
    socket.on("client_action", (roomId, action) => {
      if (!roomId) return;
      socket.to(roomId).emit("client_action", socket.id, action);
    });

    // Host explicitly starts the game to sync all clients
    socket.on("start_game", (roomId, config) => {
      if (!roomId) return;
      socket.to(roomId).emit("start_game", config);
    });

    socket.on("disconnect", () => {
      console.log("User disconnected", socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
