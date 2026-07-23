import re

with open('src/components/GameCanvas.tsx', 'r') as f:
    content = f.read()

# 1. Update MapDefinition type
content = content.replace(
    "spawnArea?: { x: number; y: number; w: number; h: number }",
    "spawnPoint?: { x: number; y: number }"
)

# 2. Update descriptions
content = content.replace(
    'description: "Enemies are well-entrenched. Penetrate the outer walls to reach the heavily guarded spawners.",',
    'description: "Begin outside the main gate. Breach the fortress to reach its heavily guarded spawners.",'
)
content = content.replace(
    'description: "A long winding zig-zag of endless bullets. Very little room for error.",',
    'description: "Begin in the bottom-left and fight through a winding zig-zag of ricochets with very little room for error.",'
)
content = content.replace(
    'description: "A serpentine, winding network of intricate corridors. Find your path and destroy the deep nested spawners.",',
    'description: "Begin near one end of a winding maze and fight toward the crystal-protected spawner at its far end.",'
)
content = content.replace(
    'description: "Begin in a secured bottom-left starting quadrant containing an integrated spawner, allowing you to prepare before venturing out into the wild arena.",',
    'description: "An open arena with a protected bottom-left refuge where players can regroup before returning to battle.",'
)
content = content.replace(
    'description: "High-intensity tactical layout. Start within a tight central bunker that contains a spawner but is surrounded by an active outer ring of hostiles.",',
    'description: "A tight central bunker surrounded by an active outer ring of hostile spawners.",'
)
content = content.replace(
    'description: "An intense grid network of tight 400x400 rooms. Players begin inside a safe bottom-left room containing a single spawner.",',
    'description: "An intense grid network of tight rooms that demand careful movement and precise ricochets.",'
)

# 3. Add spawnPoints and remove all spawnAreas
content = re.sub(r',\s*spawnArea:\s*\{\s*x:\s*\d+,\s*y:\s*\d+,\s*w:\s*\d+,\s*h:\s*\d+\s*\}', '', content)
content = re.sub(r'spawnArea:\s*\{\s*x:\s*\d+,\s*y:\s*\d+,\s*w:\s*\d+,\s*h:\s*\d+\s*\}\s*,?\s*', '', content)

# Now, we need to add spawnPoints to Fortress, The Gauntlet, and Serpentine Labyrinth.
def add_spawn_point(map_name, x, y, text):
    # Find the end of the spawners array for the specific map
    pattern = r'(name:\s*"' + map_name + r'".*?spawners:\s*\[.*?\])(\n\s*\})'
    replacement = r'\1,\n    spawnPoint: { x: ' + str(x) + r', y: ' + str(y) + r' }\2'
    new_text, count = re.subn(pattern, replacement, text, flags=re.DOTALL)
    if count == 0:
        print(f"Failed to add spawnPoint for {map_name}")
    return new_text

content = add_spawn_point("Fortress", 1500, 600, content)
content = add_spawn_point("The Gauntlet", 250, 2775, content)
content = add_spawn_point("Serpentine Labyrinth", 180, 600, content)

# 4. Remove spawnArea rendering in JSX
# Looking for {selMap.spawnArea && ( ... )} block
pattern_jsx = r'\{selMap\.spawnArea\s*&&\s*\(\s*<g>.*?</g>\s*\)\}'
content = re.sub(pattern_jsx, '', content, flags=re.DOTALL)

with open('src/components/GameCanvas.tsx', 'w') as f:
    f.write(content)
