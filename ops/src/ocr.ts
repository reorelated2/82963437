import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface OcrResult {
  text: string;
  confidence: number | null;
  unclearSpans: string[];
  engine: 'tesseract' | 'unavailable';
}

export function readScreenshot(image: Buffer): OcrResult {
  const version = spawnSync('tesseract', ['--version'], { encoding: 'utf8' });
  if (version.error || version.status !== 0) {
    return { text: '', confidence: null, unclearSpans: [], engine: 'unavailable' };
  }
  const dir = mkdtempSync(join(tmpdir(), 'kleinman-ocr-'));
  const imagePath = join(dir, 'lead.png');
  writeFileSync(imagePath, image);
  const result = spawnSync('tesseract', [imagePath, 'stdout', '-l', 'eng', '--psm', '6', 'tsv'], {
    encoding: 'utf8',
    maxBuffer: 8_000_000,
  });
  if (result.status !== 0) {
    return { text: '', confidence: 0, unclearSpans: ['OCR failed'], engine: 'tesseract' };
  }
  return parseTsv(result.stdout ?? '');
}

function parseTsv(tsv: string): OcrResult {
  const lines = tsv.split(/\r?\n/).slice(1).filter(Boolean);
  const words: Array<{ line: string; conf: number; text: string }> = [];
  for (const line of lines) {
    const cols = line.split('\t');
    if (cols.length < 12) continue;
    if (cols[0] !== '5') continue;
    const conf = Number(cols[10]);
    const value = cols[11] ?? '';
    if (!value.trim() || conf < 0) continue;
    words.push({ line: `${cols[1]}-${cols[2]}-${cols[3]}-${cols[4]}`, conf, text: value });
  }
  if (words.length === 0) return { text: '', confidence: 0, unclearSpans: [], engine: 'tesseract' };
  const grouped = new Map<string, Array<{ conf: number; text: string }>>();
  for (const word of words) {
    const list = grouped.get(word.line) ?? [];
    list.push({ conf: word.conf, text: word.text });
    grouped.set(word.line, list);
  }
  const unclearSpans: string[] = [];
  const textLines: string[] = [];
  for (const group of grouped.values()) {
    const lineText = group.map((word) => word.text).join(' ');
    const avg = group.reduce((sum, word) => sum + word.conf, 0) / group.length;
    textLines.push(lineText);
    if (avg < 60) unclearSpans.push(lineText);
  }
  const confidence = words.reduce((sum, word) => sum + word.conf, 0) / words.length;
  return { text: textLines.join('\n'), confidence, unclearSpans, engine: 'tesseract' };
}

export function decodeImage(body: string): Buffer | null {
  const match = body.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  const base64 = (match ? match[1] : body).trim();
  if (!base64) return null;
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length < 16) return null;
    return buffer;
  } catch {
    return null;
  }
}
