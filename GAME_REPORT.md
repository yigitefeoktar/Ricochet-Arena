# Ricochet Arena: Complete Game Design & Mechanics Report

## 1. Overview
**Ricochet Arena** is a fast-paced, top-down survival shooter built on HTML5 Canvas and React. The game heavily emphasizes bullet physics and trajectory prediction, spatial awareness, and strategic use of the environment. The core hook lies in its ricochet mechanic, where bullets bounce off walls and become neutral hazards to both the player and enemies.

## 2. Core Entities

### The Player (Blue)
*   **Locomotion:** Moves via WASD on desktop or an on-screen joystick on mobile.
*   **Offense:** Shoots projectiles towards the cursor/reticle.
*   **Dash Ability:** Players can trigger a high-speed dash (Spacebar or secondary thumbstick). 
    *   While dashing, the player gains a temporary shield.
    *   The dash destroys any bullets it intercepts.
    *   Dashing *through* enemies instantly destroys them.
    *   Dashing *through* Spawners deals massive continuous damage per frame, making it a high-risk, high-reward method for taking them down.

### Enemies (Red)
*   Standard hostiles that spawn from Spawners and hunt the player.
*   They periodically shoot red bullets aimed at the player's position.

### Spawners (Purple)
*   Stationary structures strategically placed across the map.
*   They periodically produce red enemies. 
*   **Dynamic Spawn Rate:** The global spawn rate naturally increases over time to put pressure on the player. However, the game balances the spawn frequency across surviving spawners. If you destroy 4 out of 5 spawners, the remaining spawner will not suddenly spew out enemies at 5x the rate. The total enemy influx scales fairly based on how many spawners remain.
*   **Win Condition:** Destroying all spawners on the map results in a "VICTORY".

### Bouncers (Green)
*   Geometric amoeba-like hazards roaming the map.
*   When shot, a large Bouncer splits into two smaller Bouncers, multiplying the threat.
*   Shooting the smallest Bouncer variant destroys it completely and rewards the player.
*   Over time, Bouncers will naturally multiply up to a map-defined capacity limits.

---

## 3. The Ricochet Bullet System

The defining mechanic of the game revolves around bullet states:
*   **Direct Player Bullets (Blue):** These are fresh bullets fired by the player. They can damage Enemies, Bouncers, and Spawners. They are the *only* bullet type that can damage Spawners.
*   **Enemy Bullets (Red):** Fired by enemies, dealing damage to the player upon contact.
*   **Neutral Bullets (Grey):** Once *any* bullet (Player or Enemy) hits a wall or block, it bounces and becomes a Neutral Bullet.
    *   Neutral bullets are highly lethal to the Player, Enemies, and Bouncers.
    *   **Crucial Rule:** Neutral bullets *cannot* damage Spawners. This design choice prevents players from hiding behind walls and randomly spamming bullets across the map in hopes of bouncing stray shots into spawners. Players must either get a clean line-of-sight (Blue Bullet) or risk a physical Dash attack to destroy a Spawner.

---

## 4. Scoring and Combo Multipliers

The game highly rewards trick shots and banked ricochets. If a bullet bounces off walls before hitting an enemy or bouncer, the point payout is heavily multiplied.

*   **Enemies:** Base 100 Points. (Plus 100 points per bounce the bullet made before hitting).
*   **Bouncers (Destroyed):** Base 250 Points. (Plus 250 points per bounce).
*   **Spawners:** Base 1000 Points. (Bonus blocks awarded upon destruction).

*Note: Overlapping dashes score base points without multiplier bonuses.*

---

## 5. Strategic Building System

As players accrue score, they cross invisible point thresholds that grant them **Blocks**.
*   Players can switch to "Build Mode" (pressing `Q` or clicking the hammer icon).
*   Blocks can be dynamically placed anywhere on the map grid.
*   **Utility:** Blocks act as permanent walls. They provide instant cover from enemy fire, and more importantly, they offer custom angular surfaces to bounce your own bullets into enemy clusters without exposing yourself.
*   Only fresh Player Bullets (Blue) can destroy a player-placed block to clear a path.

---

## 6. Maps and Progression

The game features 12 unique pre-designed maps categorized by difficulty (Easy, Medium, Hard, Expert). 

Map design fundamentally changes the gameplay flow:
*   **Open Maps (e.g., Easy Classic, Open Field):** Emphasize dodging, mobility, and crowd control.
*   **Maze Maps (e.g., The Maze, Crossroads):** Emphasize tight-corner combat, where understanding ricochet angles is the only way to clear out corridors safely.
*   **Hardcore Maps (e.g., Pinball, The Gauntlet):** Flood the arena with bouncing hazards or force the player through brutal choke points.

## 7. Technical Implementation Details
*   **Architecture:** Written entirely in TypeScript using React and HTML5 Canvas API. The rendering loop is decoupled from React state, directly animating via `requestAnimationFrame` for maximum 60fps+ performance.
*   **Resolution Independence:** The game internally simulates a coordinate map of 3000x3000px. The canvas uses a dynamic camera that transforms/scales relative to the browser window size, ensuring parity between 1440p monitors and mobile phones.
*   **Deterministic Timestep:** Movement and Dash collision calculations utilize a Delta Time (`dt`) multiplier. This ensures that a player running the game at 144hz monitors takes the same amount of dash damage against a spawner as a player running the game at 60hz, preventing framerate-tied advantages.
