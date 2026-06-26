import fs from "fs";
import path from "path";
import axios from "axios";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGES_JSON = path.join(__dirname, "image.json");
const OUTPUT_DIR = path.join(__dirname, "downloaded_images");
const CONCURRENCY = 5;

function getExtensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (ext && ext.length <= 5) return ext;
  } catch {}
  return ".jpg";
}

async function downloadOne(item) {
  const ext = getExtensionFromUrl(item.urls);
  const filePath = path.join(OUTPUT_DIR, `${item.name}${ext}`);

  if (fs.existsSync(filePath)) {
    console.log(`SKIP (exists): ${path.basename(filePath)}`);
    return;
  }

  const response = await axios.get(item.urls, {
    responseType: "stream",
    timeout: 30000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
    response.data.on("error", reject);
  });

  console.log(`OK: ${path.basename(filePath)}`);
}

async function run() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const items = JSON.parse(fs.readFileSync(IMAGES_JSON, "utf-8"));
  console.log(`Downloading ${items.length} images to ${OUTPUT_DIR}`);

  let index = 0;
  let success = 0;
  let failed = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      const item = items[i];
      try {
        await downloadOne(item);
        success++;
      } catch (err) {
        failed++;
        console.error(`FAIL: ${item.name} -> ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`\nDone. Success: ${success}, Failed: ${failed}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
