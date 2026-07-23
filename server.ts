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
    lastHostStateTime?: number; // Server-side tracker of last valid host game state emit
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
      const roomIdUpper = roomId.trim().toUpperCase();
      const room = rooms.get(roomIdUpper);
      if (room) {
        room.players = room.players.filter(p => p.id !== socketId);
        if (room.players.length === 0) {
          rooms.delete(roomIdUpper);
        } else {
          // If the host left or no host is present, assign the first player as the new host
          let foundHost = false;
          room.players.forEach(p => {
            if (p.isHost) {
              if (foundHost) {
                p.isHost = false; // Never allow multiple hosts
              } else {
                foundHost = true;
              }
            }
          });
          if (!foundHost && room.players.length > 0) {
            room.players[0].isHost = true;
          }
          io.to(roomIdUpper).emit("lobby_players", room.players);
          io.to(roomIdUpper).emit("player_left", socketId);
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
        players: [hostPlayer],
        lastHostStateTime: Date.now()
      });

      io.to(roomId).emit("lobby_players", [hostPlayer]);
      if (cb) cb({ roomId, colorIdx: 0 });
    });

    socket.on("join_room", (roomId, arg2, arg3) => {
      const cb = typeof arg2 === "function" ? arg2 : arg3;
      const clientData = typeof arg2 === "object" ? arg2 : { name: "PLAYER" };
      if (!roomId || typeof roomId !== "string") {
        if (cb) cb({ success: false, error: "Invalid Room ID" });
        return;
      }
      const roomIdUpper = roomId.trim().toUpperCase();
      const ioRoom = io.sockets.adapter.rooms.get(roomIdUpper);

      if (ioRoom) {
        socket.join(roomIdUpper);

        let room = rooms.get(roomIdUpper);
        if (!room) {
          room = { roomId: roomIdUpper, players: [], lastHostStateTime: Date.now() };
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
      if (!roomId || typeof roomId !== "string" || !data) return;
      const roomIdUpper = roomId.trim().toUpperCase();
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
      if (!roomId || typeof roomId !== "string") return;
      const roomIdUpper = roomId.trim().toUpperCase();
      socket.leave(roomIdUpper);
      handlePlayerLeave(roomIdUpper, socket.id);
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
      if (!roomId || typeof roomId !== "string") return;
      const roomIdUpper = roomId.trim().toUpperCase();
      const room = rooms.get(roomIdUpper);
      if (!room) return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player || !player.isHost) return;
      
      // Update server state timing tracker
      room.lastHostStateTime = Date.now();
      
      socket.to(roomIdUpper).volatile.emit("game_state", state);
    });

    // Client sends input states (keyboard/mouse) for movement
    socket.on("client_input", (roomId, input) => {
      if (!roomId || typeof roomId !== "string") return;
      const roomIdUpper = roomId.trim().toUpperCase();
      const room = rooms.get(roomIdUpper);
      if (!room) return;
      
      // Verify sender is in player list
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;

      // Reject non-finite coordinate values
      if (input) {
        if (input.x !== undefined && (typeof input.x !== "number" || !Number.isFinite(input.x))) return;
        if (input.y !== undefined && (typeof input.y !== "number" || !Number.isFinite(input.y))) return;
      }

      // Send gameplay input strictly to the room's host
      const host = room.players.find(p => p.isHost);
      if (host && host.id !== socket.id) {
        io.to(host.id).volatile.emit("client_input", socket.id, input);
      }
    });

    // Claim room host when current host is inactive/throttled
    socket.on("claim_host", (roomId) => {
      if (!roomId || typeof roomId !== "string") return;
      const roomIdUpper = roomId.trim().toUpperCase();
      const room = rooms.get(roomIdUpper);
      if (!room) return;

      // Validate the claimant is currently inside the room
      const claimant = room.players.find(p => p.id === socket.id);
      if (!claimant) return;

      // If claimant is already host, ignore
      if (claimant.isHost) return;

      const currentHost = room.players.find(p => p.isHost);
      const now = Date.now();

      // Permit claim only when host is absent or hasn't emitted state for 1000ms
      const isHostAbsent = !currentHost || !io.sockets.sockets.has(currentHost.id);
      const stoppedStateBroadcast = room.lastHostStateTime !== undefined && (now - room.lastHostStateTime > 1000);

      if (isHostAbsent || stoppedStateBroadcast) {
        // Demote other hosts completely
        room.players.forEach(p => p.isHost = false);
        // Elevate claimant
        claimant.isHost = true;
        
        // Reset last state time to now so consecutive simultaneous claims are safely throttled/resolved
        room.lastHostStateTime = now;

        io.to(roomIdUpper).emit("lobby_players", room.players);
      }
    });

    // Client interaction triggers (shoot, build, dash)
    socket.on("client_action", (roomId, action) => {
      if (!roomId || typeof roomId !== "string" || !action) return;
      const roomIdUpper = roomId.trim().toUpperCase();
      const room = rooms.get(roomIdUpper);
      if (!room) return;

      // Verify sender is in the player roster
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;

      // Reject unknown action types
      const knownActionTypes = ["lobby_update", "lobby_request_sync", "shoot", "build", "build_remove", "special"];
      if (typeof action.type !== "string" || !knownActionTypes.includes(action.type)) return;

      // Reject non-finite coordinates or directions
      if (action.x !== undefined && (typeof action.x !== "number" || !Number.isFinite(action.x))) return;
      if (action.y !== undefined && (typeof action.y !== "number" || !Number.isFinite(action.y))) return;
      if (action.dx !== undefined && (typeof action.dx !== "number" || !Number.isFinite(action.dx))) return;
      if (action.dy !== undefined && (typeof action.dy !== "number" || !Number.isFinite(action.dy))) return;

      // Lobby actions are broadcast to all members, gameplay actions go strictly to the host
      if (action.type === "lobby_update" || action.type === "lobby_request_sync") {
        socket.to(roomIdUpper).emit("client_action", socket.id, action);
      } else {
        const host = room.players.find(p => p.isHost);
        if (host && host.id !== socket.id) {
          io.to(host.id).emit("client_action", socket.id, action);
        }
      }
    });

    // Host explicitly starts the game to sync all clients
    socket.on("start_game", (roomId, config, callback) => {
      const cb = typeof config === "function" ? config : (typeof callback === "function" ? callback : undefined);
      const gameConfig = typeof config === "object" && config !== null ? config : {};

      if (!roomId || typeof roomId !== "string") {
        if (cb) cb({ success: false, error: "INVALID_ROOM_ID" });
        return;
      }

      const roomIdUpper = roomId.trim().toUpperCase();
      const room = rooms.get(roomIdUpper);
      if (!room) {
        if (cb) cb({ success: false, error: "ROOM_NOT_FOUND" });
        return;
      }

      const player = room.players.find(p => p.id === socket.id);
      if (!player || !player.isHost) {
        if (cb) cb({ success: false, error: "NOT_HOST" });
        return;
      }

      const spawnAssignments = gameConfig.spawnAssignments;
      if (!spawnAssignments || typeof spawnAssignments !== "object") {
        if (cb) cb({ success: false, error: "NO_SPAWN_ASSIGNMENTS" });
        return;
      }

      const roomPlayerIds = room.players.map(p => p.id);
      const assignedIds = Object.keys(spawnAssignments);

      const hasExactPlayers =
        roomPlayerIds.length === assignedIds.length &&
        roomPlayerIds.every(id => id in spawnAssignments);

      if (!hasExactPlayers) {
        io.to(roomIdUpper).emit("lobby_players", room.players);
        if (cb) cb({ success: false, error: "ROSTER_MISMATCH" });
        return;
      }

      for (const pid of roomPlayerIds) {
        const pos = spawnAssignments[pid];
        if (
          !pos ||
          typeof pos.x !== "number" ||
          typeof pos.y !== "number" ||
          !Number.isFinite(pos.x) ||
          !Number.isFinite(pos.y) ||
          pos.x < 0 ||
          pos.x > 3000 ||
          pos.y < 0 ||
          pos.y > 3000
        ) {
          if (cb) cb({ success: false, error: "INVALID_SPAWN_COORDINATES" });
          return;
        }
      }

      socket.to(roomIdUpper).emit("start_game", gameConfig);
      if (cb) cb({ success: true });
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
