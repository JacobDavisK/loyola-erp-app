import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileKind } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { invalid } from "@/server/errors";
import { decryptBuffer, encryptBuffer, hmac, randomToken, safeEqual, sha256 } from "@/server/security/crypto";

/** Storage abstraction. Swap LocalEncryptedStorage for an S3/GCS/Azure driver with private buckets. */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class LocalEncryptedStorage implements StorageDriver {
  constructor(private readonly root: string) {}
  private resolve(key: string) {
    // keys are server-generated ([a-z0-9/]); still guard against traversal
    if (!/^[a-z0-9][a-z0-9/_-]{0,200}$/i.test(key) || key.includes("..")) throw new Error("Invalid storage key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Path traversal blocked");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, encryptBuffer(data), { mode: 0o600 });
  }
  async get(key: string) {
    return decryptBuffer(await readFile(this.resolve(key)));
  }
  async remove(key: string) {
    await unlink(this.resolve(key)).catch(() => {});
  }
}

export const storage: StorageDriver = new LocalEncryptedStorage(path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.STORAGE_DIR));

const IMAGE_SIGNATURES: { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  { mime: "image/gif", test: (b) => b.subarray(0, 6).toString() === "GIF87a" || b.subarray(0, 6).toString() === "GIF89a" },
];
const PDF_SIGNATURE = (b: Buffer) => b.subarray(0, 5).toString() === "%PDF-";
const ZIP_SIGNATURE = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

export function sanitizeFileName(name: string): string {
  const base = path.basename(name).normalize("NFKC").replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s+/g, " ").trim();
  return (base || "file").slice(0, 120);
}

/** Validates content by magic bytes (never trusts the client-provided type). SVG is rejected (script risk). */
/** Office Open XML documents are ZIP containers; the extension decides which one. */
const OOXML: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** Documents accepted for course material and student submissions: PDF, images, Office files, ZIP and plain text. */
function detectDocument(buf: Buffer, name: string): string {
  if (PDF_SIGNATURE(buf)) return "application/pdf";
  const img = IMAGE_SIGNATURES.find((s) => s.test(buf));
  if (img) return img.mime;
  const ext = path.extname(name).slice(1).toLowerCase();
  if (ZIP_SIGNATURE(buf)) return OOXML[ext] ?? "application/zip";
  // Plain text: valid UTF-8 without NUL bytes, and a text extension.
  if (["txt", "md", "csv", "py", "java", "c", "cpp", "js", "ts", "sql"].includes(ext) && !buf.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buf);
      return "text/plain; charset=utf-8";
    } catch {
      /* fall through */
    }
  }
  throw invalid("Upload a PDF, image, Word/Excel/PowerPoint (.docx/.xlsx/.pptx), ZIP or plain-text file.");
}

export function detectMime(buf: Buffer, kind: FileKind, name = ""): string {
  if (kind === "COURSE_MATERIAL" || kind === "SUBMISSION" || kind === "EVIDENCE" || kind === "STUDENT_DOCUMENT") return detectDocument(buf, name);
  if (kind === "EXPORT") {
    if (PDF_SIGNATURE(buf)) return "application/pdf";
    throw invalid("Unsupported export format.");
  }
  if (kind === "PACKAGE") {
    if (ZIP_SIGNATURE(buf)) return "application/zip";
    if (PDF_SIGNATURE(buf)) return "application/pdf";
    throw invalid("Unsupported package format.");
  }
  const hit = IMAGE_SIGNATURES.find((s) => s.test(buf));
  if (!hit) throw invalid("Only PNG, JPEG, WebP or GIF images are accepted.");
  return hit.mime;
}

const MAX_SIZE: Record<FileKind, number> = {
  QUESTION_IMAGE: 3 * 1024 * 1024,
  COURSE_MATERIAL: 15 * 1024 * 1024,
  EVIDENCE: 15 * 1024 * 1024,
  STUDENT_DOCUMENT: 5 * 1024 * 1024,
  SUBMISSION: 10 * 1024 * 1024,
  LOGO: 1024 * 1024,
  AVATAR: 1024 * 1024,
  EXPORT: 40 * 1024 * 1024,
  PACKAGE: 200 * 1024 * 1024,
  OTHER: 5 * 1024 * 1024,
};

export async function saveFile(input: { data: Buffer; name: string; kind: FileKind; ownerId: string | null }) {
  if (input.data.length === 0) throw invalid("The file is empty.");
  if (input.data.length > MAX_SIZE[input.kind]) throw invalid(`File is too large (max ${Math.round(MAX_SIZE[input.kind] / 1024 / 1024)} MB).`);
  const mimeType = detectMime(input.data, input.kind, input.name);
  const now = new Date();
  const storageKey = `${input.kind.toLowerCase()}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomToken(18).replace(/[^a-z0-9]/gi, "x")}`;
  await storage.put(storageKey, input.data);
  return db.fileAsset.create({
    data: {
      storageKey,
      originalName: sanitizeFileName(input.name),
      mimeType,
      size: input.data.length,
      sha256: sha256(input.data),
      kind: input.kind,
      ownerId: input.ownerId,
    },
  });
}

/** Short-lived HMAC-signed URL. The file route also requires an authenticated session. */
export function signedAssetUrl(assetId: string, ttlSeconds = 600, disposition: "inline" | "attachment" = "inline"): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmac(`${assetId}.${exp}.${disposition}`);
  return `/api/files/${assetId}?exp=${exp}&d=${disposition}&sig=${sig}`;
}

export function verifySignedUrl(assetId: string, exp: string | null, disposition: string | null, sig: string | null): boolean {
  if (!exp || !sig || !disposition) return false;
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now() / 1000) return false;
  return safeEqual(sig, hmac(`${assetId}.${e}.${disposition}`));
}
