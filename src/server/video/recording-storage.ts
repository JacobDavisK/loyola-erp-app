import "server-only";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/server/env";

/**
 * Where recordings live. OpenVidu's egress writes MP4 files into the S3-compatible bucket configured in
 * OpenVidu (MinIO in a default deployment). The ERP never hands out bucket URLs: it streams the object to
 * an authorised viewer itself (with HTTP Range support for seeking), so storage stays private.
 */

export interface StoredObject {
  body: ReadableStream<Uint8Array>;
  contentLength: number;
  contentRange?: string;
  totalSize?: number;
  status: 200 | 206;
}

export interface RecordingStorage {
  readonly name: string;
  readonly configured: boolean;
  read(key: string, range?: { start: number; end?: number }): Promise<StoredObject>;
  size(key: string): Promise<number | null>;
  remove(key: string): Promise<void>;
}

class S3RecordingStorage implements RecordingStorage {
  readonly name = "s3";
  readonly configured = true;
  private client = new S3Client({
    endpoint: env.RECORDING_S3_ENDPOINT,
    region: env.RECORDING_S3_REGION,
    forcePathStyle: env.RECORDING_S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: env.RECORDING_S3_ACCESS_KEY!, secretAccessKey: env.RECORDING_S3_SECRET_KEY! },
  });
  private bucket = env.RECORDING_S3_BUCKET;

  async read(key: string, range?: { start: number; end?: number }): Promise<StoredObject> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end ?? ""}` : undefined }));
    const total = r.ContentRange ? Number(r.ContentRange.split("/")[1]) : r.ContentLength;
    return { body: r.Body!.transformToWebStream(), contentLength: r.ContentLength ?? 0, contentRange: r.ContentRange, totalSize: total, status: range ? 206 : 200 };
  }

  async size(key: string) {
    try {
      const h = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return h.ContentLength ?? null;
    } catch {
      return null;
    }
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

class NoRecordingStorage implements RecordingStorage {
  readonly name = "none";
  readonly configured = false;
  read(): Promise<StoredObject> { return Promise.reject(new Error("Recording storage is not configured.")); }
  size() { return Promise.resolve(null); }
  remove() { return Promise.resolve(); }
}

let storage: RecordingStorage | null = null;
let override: RecordingStorage | null = null;

export function recordingStorage(): RecordingStorage {
  if (override) return override;
  storage ??= env.OPENVIDU_RECORDING_STORAGE === "s3" && env.RECORDING_S3_ENDPOINT && env.RECORDING_S3_ACCESS_KEY && env.RECORDING_S3_SECRET_KEY ? new S3RecordingStorage() : new NoRecordingStorage();
  return storage;
}

export function setRecordingStorage(s: RecordingStorage | null) {
  override = s;
}

/** Object key from an egress file location: "s3://bucket/key", "https://host/bucket/key" or a bare key. */
export function objectKeyFrom(location: string | undefined, fallback: string | null): string | null {
  if (!location) return fallback;
  if (location.startsWith("s3://")) return location.replace(/^s3:\/\/[^/]+\//, "");
  if (/^https?:\/\//.test(location)) {
    const path = new URL(location).pathname.replace(/^\//, "");
    const bucket = `${env.RECORDING_S3_BUCKET}/`;
    return path.startsWith(bucket) ? path.slice(bucket.length) : path;
  }
  return location.replace(/^\//, "");
}
