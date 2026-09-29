import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function readScreenshot(file: string): Promise<{ text: string; confidence: number } | { error: string }> {
  try {
    const { stdout } = await execFileAsync("tesseract", [file, "stdout", "tsv"], {
      timeout: 30_000,
      maxBuffer: 8_000_000,
    });
    const lines = stdout.split("\n").slice(1).filter(Boolean);
    const words: { text: string; conf: number }[] = [];
    for (const line of lines) {
      const cols = line.split("\t");
      if (cols.length < 12) continue;
      const conf = Number(cols[10]);
      const text = cols[11]?.trim() ?? "";
      if (!text || text === " ") continue;
      if (Number.isFinite(conf) && conf >= 0) words.push({ text, conf });
    }
    if (!words.length) return { error: "No readable words were found in the screenshot." };
    const confidence = words.reduce((sum, word) => sum + word.conf, 0) / words.length / 100;
    return { text: words.map((word) => word.text).join(" "), confidence };
  } catch (error) {
    const missing = error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT";
    if (missing) return { error: "Screenshot reader is not installed. Paste the text from the image." };
    const message = error instanceof Error ? error.message : "Screenshot reader failed.";
    return { error: message.split("\n")[0] ?? "Screenshot reader failed." };
  }
}
