const fs = require('fs');
console.log(fs.readFileSync('src/components/GameCanvas.tsx', 'utf8').substring(0, 100));
