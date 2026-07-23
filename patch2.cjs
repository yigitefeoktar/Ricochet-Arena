const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/components/GameCanvas.tsx');
let content = fs.readFileSync(filePath, 'utf8');

const targetStr = `
      const drawObjectiveTag = (
        text: string,
        worldTargetX: number | null,
        worldTargetY: number | null,
        targetRadius: number,
        showPointer: boolean,
        alpha: number
      ) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '500 18px "JetBrains Mono", monospace';
        const textW = ctx.measureText(text).width;
        const padX = 14;
        const h = 36;
        const w = textW + padX * 2;
        
        const floatOffset = Math.sin(currentTime * Math.PI * 2 / 2200) * 2.5;
        const glowPulse = Math.sin(currentTime * Math.PI * 2 / 2200) * 0.5 + 0.5;
        
        let tagX = canvas.width / 2;
        let tagY = 100 + h / 2;
        let placement = 'top';
        
        if (showPointer && worldTargetX !== null && worldTargetY !== null) {
            const screenX = worldTargetX - state.camera.x;
            const screenY = worldTargetY - state.camera.y;
            
            const trScreen = targetRadius + 40; // extra padding for HP bar/relic
            
            tagX = screenX;
            tagY = screenY - trScreen - h/2 - 10;
            
            const isOverlapping = (px: number, py: number) => {
                const margin = 10;
                if (px - w/2 < margin || px + w/2 > canvas.width - margin ||
                    py - h/2 < margin || py + h/2 > canvas.height - margin) return true;
                if (py - h/2 < 80) return true; // HUD
                
                const wx = px + state.camera.x;
                const wy = py + state.camera.y;
                for (const wall of activeWalls) {
                   if (wx + w/2 > wall.x && wx - w/2 < wall.x + wall.w &&
                       wy + h/2 > wall.y && wy - h/2 < wall.y + wall.h) {
                       return true;
                   }
                }
                return false;
            };
            
            if (isOverlapping(tagX, tagY)) {
                placement = 'bottom';
                tagX = screenX;
                tagY = screenY + trScreen + h/2 + 10;
                if (isOverlapping(tagX, tagY)) {
                    placement = 'left';
                    tagX = screenX - trScreen - w/2 - 10;
                    tagY = screenY;
                    if (isOverlapping(tagX, tagY)) {
                        placement = 'right';
                        tagX = screenX + trScreen + w/2 + 10;
                        tagY = screenY;
                        if (isOverlapping(tagX, tagY)) {
                            placement = 'top';
                            tagX = screenX;
                            tagY = screenY - trScreen - h/2 - 10;
                        }
                    }
                }
            }
            
            tagX = Math.max(w/2 + 10, Math.min(canvas.width - w/2 - 10, tagX));
            tagY = Math.max(h/2 + 10, Math.min(canvas.height - h/2 - 10, tagY));
        }
        
        tagY += floatOffset;
        
        ctx.translate(tagX, tagY);
        
        ctx.beginPath();
        const chamfer = 6;
        ctx.moveTo(-w/2 + chamfer, -h/2);
        ctx.lineTo(w/2 - chamfer, -h/2);
        ctx.lineTo(w/2, -h/2 + chamfer);
        ctx.lineTo(w/2, h/2 - chamfer);
        ctx.lineTo(w/2 - chamfer, h/2);
        ctx.lineTo(-w/2 + chamfer, h/2);
        ctx.lineTo(-w/2, h/2 - chamfer);
        ctx.lineTo(-w/2, -h/2 + chamfer);
        ctx.closePath();
        
        ctx.fillStyle = 'rgba(8, 10, 18, 0.88)';
        ctx.fill();
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#D946EF';
        ctx.shadowColor = '#D946EF';
        ctx.shadowBlur = 4 + glowPulse * 6;
        ctx.stroke();
        
        if (showPointer && worldTargetX !== null && worldTargetY !== null) {
            ctx.beginPath();
            const ptrSize = 8;
            if (placement === 'top') {
                ctx.moveTo(-ptrSize, h/2);
                ctx.lineTo(ptrSize, h/2);
                ctx.lineTo(0, h/2 + ptrSize);
            } else if (placement === 'bottom') {
                ctx.moveTo(-ptrSize, -h/2);
                ctx.lineTo(ptrSize, -h/2);
                ctx.lineTo(0, -h/2 - ptrSize);
            } else if (placement === 'left') {
                ctx.moveTo(w/2, -ptrSize);
                ctx.lineTo(w/2, ptrSize);
                ctx.lineTo(w/2 + ptrSize, 0);
            } else {
                ctx.moveTo(-w/2, -ptrSize);
                ctx.lineTo(-w/2, ptrSize);
                ctx.lineTo(-w/2 - ptrSize, 0);
            }
            ctx.closePath();
            ctx.fillStyle = '#D946EF';
            ctx.fill();
            ctx.stroke();
        }
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#F3E8FF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 1);
        
        ctx.restore();
      };
`;

const replacement = `
      const drawObjectiveTag = (
        text: string,
        worldTargetX: number | null,
        worldTargetY: number | null,
        targetRadius: number,
        showPointer: boolean,
        alpha: number
      ) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '500 18px "JetBrains Mono", monospace';
        const textW = ctx.measureText(text).width;
        const padX = 14;
        const h = 36;
        const w = textW + padX * 2;
        
        const glowPulse = Math.sin(currentTime * Math.PI * 2 / 2200) * 0.5 + 0.5;
        const accentColor = state.hardMode ? '#ff3300' : '#D946EF';
        
        let tagX = canvas.width / 2;
        let tagY = 100 + h / 2;
        
        if (showPointer && worldTargetX !== null && worldTargetY !== null) {
            const screenX = worldTargetX - state.camera.x;
            const screenY = worldTargetY - state.camera.y;
            
            const trScreen = targetRadius + 40; // extra padding for HP bar/relic
            
            tagX = screenX;
            tagY = screenY - trScreen - h/2 - 10;
        }
        
        ctx.translate(tagX, tagY);
        
        ctx.beginPath();
        const chamfer = 6;
        ctx.moveTo(-w/2 + chamfer, -h/2);
        ctx.lineTo(w/2 - chamfer, -h/2);
        ctx.lineTo(w/2, -h/2 + chamfer);
        ctx.lineTo(w/2, h/2 - chamfer);
        ctx.lineTo(w/2 - chamfer, h/2);
        ctx.lineTo(-w/2 + chamfer, h/2);
        ctx.lineTo(-w/2, h/2 - chamfer);
        ctx.lineTo(-w/2, -h/2 + chamfer);
        ctx.closePath();
        
        ctx.fillStyle = 'rgba(8, 10, 18, 0.88)';
        ctx.fill();
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = accentColor;
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 3.2 + glowPulse * 4.8;
        ctx.stroke();
        
        if (showPointer && worldTargetX !== null && worldTargetY !== null) {
            ctx.beginPath();
            const ptrSize = 6;
            ctx.moveTo(-ptrSize, h/2);
            ctx.lineTo(ptrSize, h/2);
            ctx.lineTo(0, h/2 + ptrSize);
            ctx.closePath();
            ctx.fillStyle = accentColor;
            ctx.fill();
            ctx.stroke();
        }
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#F3E8FF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 1);
        
        ctx.restore();
      };
`;

const escapeRegExp = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
};

const targetRegex = new RegExp(escapeRegExp(targetStr.trim()).replace(/\\s+/g, '\\s+'));
if (targetRegex.test(content)) {
    content = content.replace(targetRegex, replacement.trim());
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Patched successfully using regex');
} else {
    console.log('Could not find target string to replace.');
}
