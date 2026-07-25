import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import { MatchSettings, DEFAULT_MATCH_SETTINGS, isValidGameMode, isValidMapId } from "./src/shared/matchSettings.js";

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
    matchActive?: boolean;
    matchSettings: MatchSettings;
  }

  const rooms = new Map<string, RoomInfo>();

  function sanitizeName(rawName: any, fallback: string): string {
    if (typeof rawName !== "string") {
      return fallback;
    }
    let clean = rawName.trim().replace(/[\x00-\x1F\x7F-\x9F]/g, "");
    if (clean.length > 12) {
      clean = clean.substring(0, 12);
    }
    if (!clean) {
      return fallback;
    }
    return clean;
  }

  function sanitizeColor(rawColor: any, currentPlayers: Player[], currentPlayerId?: string): number {
    if (typeof rawColor !== "number" || !Number.isInteger(rawColor) || rawColor < 0 || rawColor > 4) {
      return -1;
    }
    const isTaken = currentPlayers.some(p => p.id !== currentPlayerId && p.colorIdx === rawColor);
    if (isTaken) {
      return -1;
    }
    return rawColor;
  }

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
          let hostChanged = false;
          let foundHost = false;
          room.players.forEach(p => {
            if (p.isHost) {
              if (foundHost) {
                p.isHost = false; // Never allow multiple hosts
                hostChanged = true;
              } else {
                foundHost = true;
              }
            }
          });
          if (!foundHost && room.players.length > 0) {
            room.players[0].isHost = true;
            hostChanged = true;
          }
          if (hostChanged) {
            room.lastHostStateTime = Date.now();
          }
          io.to(roomIdUpper).emit("lobby_players", room.players);
          io.to(roomIdUpper).emit("player_left", socketId);
        }
      }
    };

    socket.on("create_room", (arg1, arg2) => {
      const cb = typeof arg1 === "function" ? arg1 : arg2;
      const clientData = typeof arg1 === "object" && arg1 !== null ? arg1 : { name: "PLAYER" };

      let roomId = "";
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      do {
        roomId = "";
        for (let i = 0; i < 4; i++) {
          roomId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
      } while (rooms.has(roomId));
      socket.join(roomId);

      const rawName = clientData.name;
      const clean = sanitizeName(rawName, "PLAYER 1");
      const upper = clean.toUpperCase();
      const assignedName = (upper === "PLAYER" || upper === "HOST") ? "PLAYER 1" : clean;

      let chosenColor = 0;
      if (clientData.colorIdx !== undefined) {
        const validColor = sanitizeColor(clientData.colorIdx, []);
        if (validColor !== -1) {
          chosenColor = validColor;
        }
      }

      const hostPlayer: Player = {
        id: socket.id,
        name: assignedName,
        colorIdx: chosenColor,
        isHost: true
      };

      let initialMapId = DEFAULT_MATCH_SETTINGS.mapId;
      let initialGameMode = DEFAULT_MATCH_SETTINGS.gameMode;

      if (clientData.matchSettings && typeof clientData.matchSettings === "object") {
        if (isValidMapId(clientData.matchSettings.mapId)) {
          initialMapId = clientData.matchSettings.mapId;
        }
        if (isValidGameMode(clientData.matchSettings.gameMode)) {
          initialGameMode = clientData.matchSettings.gameMode;
        }
      } else {
        if (isValidMapId(clientData.mapId)) {
          initialMapId = clientData.mapId;
        }
        if (isValidGameMode(clientData.gameMode)) {
          initialGameMode = clientData.gameMode;
        } else if (typeof clientData.hardMode === "boolean") {
          initialGameMode = clientData.hardMode ? 'hard' : 'normal';
        }
      }

      const matchSettings: MatchSettings = {
        mapId: initialMapId,
        gameMode: initialGameMode,
      };

      rooms.set(roomId, {
        roomId,
        players: [hostPlayer],
        lastHostStateTime: Date.now(),
        matchActive: false,
        matchSettings,
      });

      io.to(roomId).emit("lobby_players", [hostPlayer]);
      if (cb) cb({ roomId, colorIdx: chosenColor, matchSettings });
    });

    socket.on("join_room", (roomId, arg2, arg3) => {
      const cb = typeof arg2 === "function" ? arg2 : arg3;
      const clientData = typeof arg2 === "object" && arg2 !== null ? arg2 : { name: "PLAYER" };
      if (!roomId || typeof roomId !== "string") {
        if (cb) cb({ success: false, error: "ROOM_NOT_FOUND" });
        return;
      }
      const roomIdUpper = roomId.trim().toUpperCase();
      const room = rooms.get(roomIdUpper);

      if (!room) {
        if (cb) cb({ success: false, error: "ROOM_NOT_FOUND" });
        return;
      }

      if (room.matchActive) {
        if (cb) cb({ success: false, error: "MATCH_IN_PROGRESS" });
        return;
      }

      socket.join(roomIdUpper);

      const isHost = room.players.length === 0 || !room.players.some(p => p.isHost);

      // Calculate available colors
      const usedColors = room.players.map(p => p.colorIdx);
      const availableColors = [0, 1, 2, 3, 4].filter(c => !usedColors.includes(c));
      let chosenColor = 0;

      if (clientData && typeof clientData === "object" && clientData.colorIdx !== undefined) {
        const requestedColor = sanitizeColor(clientData.colorIdx, room.players);
        if (requestedColor !== -1) {
          chosenColor = requestedColor;
        } else if (availableColors.length > 0) {
          chosenColor = availableColors[0];
        } else {
          chosenColor = Math.floor(Math.random() * 5);
        }
      } else if (isHost) {
        chosenColor = 0;
      } else if (availableColors.length > 0) {
        chosenColor = availableColors[0];
      } else {
        chosenColor = Math.floor(Math.random() * 5);
      }

      const defaultName = getUniqueDefaultName(room.players);
      const rawName = clientData && typeof clientData === "object" ? clientData.name : undefined;
      const cleanName = sanitizeName(rawName, defaultName);
      const upper = cleanName.toUpperCase();
      const assignedName = (upper === "PLAYER" || upper === "HOST") ? defaultName : cleanName;

      const newPlayer: Player = {
        id: socket.id,
        name: assignedName,
        colorIdx: chosenColor,
        isHost
      };

      room.players.push(newPlayer);

      socket.to(roomIdUpper).emit("player_joined", socket.id);
      io.to(roomIdUpper).emit("lobby_players", room.players);

      if (cb) cb({
        success: true,
        hostId: room.players.find(p => p.isHost)?.id || socket.id,
        colorIdx: chosenColor,
        matchSettings: room.matchSettings
      });
    });

    socket.on("update_match_settings", (roomId, proposedSettings, callback) => {
      const cb = typeof callback === "function" ? callback : undefined;

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

      if (room.matchActive) {
        if (cb) cb({ success: false, error: "MATCH_ALREADY_STARTED" });
        return;
      }

      if (!proposedSettings || typeof proposedSettings !== "object") {
        if (cb) cb({ success: false, error: "INVALID_SETTINGS" });
        return;
      }

      if (!isValidMapId(proposedSettings.mapId)) {
        if (cb) cb({ success: false, error: "INVALID_MAP" });
        return;
      }

      if (!isValidGameMode(proposedSettings.gameMode)) {
        if (cb) cb({ success: false, error: "INVALID_MODE" });
        return;
      }

      const sanitizedSettings: MatchSettings = {
        mapId: proposedSettings.mapId,
        gameMode: proposedSettings.gameMode,
      };

      room.matchSettings = sanitizedSettings;

      io.to(roomIdUpper).emit("match_settings", sanitizedSettings);

      if (cb) cb({ success: true, matchSettings: sanitizedSettings });
    });
    
    socket.on("update_profile", (roomId, data) => {
      if (!roomId || typeof roomId !== "string" || !data || typeof data !== "object") return;
      const roomIdUpper = roomId.trim().toUpperCase();
      const room = rooms.get(roomIdUpper);
      if (room) {
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
          if (data.name !== undefined) {
            const cleanName = sanitizeName(data.name, player.name);
            const upper = cleanName.toUpperCase();
            if (upper !== "PLAYER" && upper !== "HOST") {
              player.name = cleanName;
            }
          }
          if (data.colorIdx !== undefined) {
            const validColor = sanitizeColor(data.colorIdx, room.players, socket.id);
            if (validColor !== -1) {
              player.colorIdx = validColor;
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

      // Sanitization:
      // Require input to be a non-null object.
      if (!input || typeof input !== "object") return;

      // Require x and y to be finite numbers.
      if (typeof input.x !== "number" || !Number.isFinite(input.x)) return;
      if (typeof input.y !== "number" || !Number.isFinite(input.y)) return;

      // Require isDead to be a boolean when supplied.
      if (input.isDead !== undefined && typeof input.isDead !== "boolean") return;

      const sanitizedInput: { x: number; y: number; isDead?: boolean } = {
        x: input.x,
        y: input.y
      };

      if (input.isDead !== undefined) {
        sanitizedInput.isDead = input.isDead;
      }

      // Send gameplay input strictly to the room's host
      const host = room.players.find(p => p.isHost);
      if (host && host.id !== socket.id) {
        io.to(host.id).volatile.emit("client_input", socket.id, sanitizedInput);
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

      // Permit claim only when host is absent or, during an active match, hasn't emitted state for 1000ms
      const isHostAbsent = !currentHost || !io.sockets.sockets.has(currentHost.id);
      const isMatchActive = !!room.matchActive;
      const stoppedStateBroadcast = isMatchActive && room.lastHostStateTime !== undefined && (now - room.lastHostStateTime > 1000);

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
      const knownActionTypes = ["shoot", "build", "build_remove", "special", "build_start"];
      if (typeof action.type !== "string" || !knownActionTypes.includes(action.type)) return;

      // Reject non-finite coordinates or directions
      if (action.x !== undefined && (typeof action.x !== "number" || !Number.isFinite(action.x))) return;
      if (action.y !== undefined && (typeof action.y !== "number" || !Number.isFinite(action.y))) return;
      if (action.dx !== undefined && (typeof action.dx !== "number" || !Number.isFinite(action.dx))) return;
      if (action.dy !== undefined && (typeof action.dy !== "number" || !Number.isFinite(action.dy))) return;

      const host = room.players.find(p => p.isHost);
      if (host && host.id !== socket.id) {
        io.to(host.id).emit("client_action", socket.id, action);
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

      const ioRoom = io.sockets.adapter.rooms.get(roomIdUpper);
      const connectedCount = ioRoom ? ioRoom.size : 0;
      if (connectedCount < 2) {
        if (cb) cb({ success: false, error: "NOT_ENOUGH_PLAYERS" });
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

      // Construct authoritative start configuration from room's stored settings
      const mapId = room.matchSettings.mapId;
      const gameMode = room.matchSettings.gameMode;
      const hardMode = gameMode !== "normal";

      const startPayload = {
        mapId,
        gameMode,
        hardMode,
        spawnAssignments,
      };

      room.matchActive = true;
      room.lastHostStateTime = Date.now();
      socket.to(roomIdUpper).emit("start_game", startPayload);
      if (cb) cb({ success: true, config: startPayload });
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
