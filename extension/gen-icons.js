const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];
const outDir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of sizes) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#4F46E5';
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.15);
  ctx.fill();

  // Letter "B"
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${Math.round(size * 0.6)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('B', size / 2, size / 2);

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), buffer);
  console.log(`Created icon${size}.png`);
}
