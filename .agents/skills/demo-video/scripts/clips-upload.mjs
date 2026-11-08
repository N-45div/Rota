// Send a video to Clips in chunks, using the plan create-recording-upload returned.
//   node clips-upload.mjs <plan.json> <video-file>
// Behind a proxy, run with NODE_USE_ENV_PROXY=1.
import { readFileSync } from "node:fs";

const [planPath, filePath] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const file = readFileSync(filePath);
const size = plan.chunkSizeBytes;
const total = Math.ceil(file.length / size);
if (total !== plan.totalChunks) throw new Error(`Expected ${plan.totalChunks} chunks, file makes ${total}`);

for (let index = 0; index < total; index++) {
  const chunk = file.subarray(index * size, Math.min(file.length, (index + 1) * size));
  const url = `${plan.chunkUrl}&index=${index}&isFinal=${index === total - 1 ? 1 : 0}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { method: plan.method || "POST", headers: plan.headers, body: chunk });
    const text = await res.text();
    if (res.ok) {
      console.log(`chunk ${index + 1}/${total}: ${res.status}${index === total - 1 ? ` ${text.slice(0, 300)}` : ""}`);
      break;
    }
    if (attempt >= 3) throw new Error(`chunk ${index}: HTTP ${res.status} ${text.slice(0, 300)}`);
    console.log(`chunk ${index}: HTTP ${res.status}, retrying`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}
console.log(`Uploaded. Share link: ${plan.shareUrl}`);
