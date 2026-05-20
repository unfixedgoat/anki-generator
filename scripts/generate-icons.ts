import sharp from "sharp";
import path from "path";

const src = path.resolve(__dirname, "../public/favicon.png");
const out = path.resolve(__dirname, "../public");

const sizes = [
  { file: "favicon-32x32.png", size: 32 },
  { file: "favicon-16x16.png", size: 16 },
  { file: "icon-192x192.png", size: 192 },
  { file: "icon-512x512.png", size: 512 },
];

async function main() {
  for (const { file, size } of sizes) {
    await sharp(src).resize(size, size).png().toFile(path.join(out, file));
    console.log(`Generated ${file}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
