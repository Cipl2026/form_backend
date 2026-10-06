import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import { config, spacesEnabled, publicSpacesUrl } from "../config.js";

let client: S3Client | null = null;

export function spacesClient(): S3Client | null {
  if (!spacesEnabled) return null;
  if (!client) {
    client = new S3Client({
      endpoint: config.spaces.endpoint,
      region: config.spaces.region,
      credentials: {
        accessKeyId: config.spaces.key,
        secretAccessKey: config.spaces.secret,
      },
      forcePathStyle: false,
    });
  }
  return client;
}

function extFor(mime: string) {
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "application/pdf") return ".pdf";
  return ".jpg";
}

export type UploadedImage = {
  key: string;
  url: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
};

export async function uploadBufferToSpaces(
  buffer: Buffer,
  mimeType: string,
  originalName: string,
  folder: "photo" | "employeeSignature" | "hrSignature" | string = "misc"
): Promise<UploadedImage> {
  const s3 = spacesClient();
  if (!s3) throw new Error("DigitalOcean Spaces is not configured.");
  const ext = extFor(mimeType);
  const key = `${config.spaces.prefix}/${folder}/${crypto.randomUUID()}${ext}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: config.spaces.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ACL: config.spaces.publicAcl ? "public-read" : "private",
    })
  );
  return {
    key,
    url: publicSpacesUrl(key),
    filename: key.split("/").pop() || key,
    originalName: originalName.slice(0, 200),
    mimeType,
    size: buffer.length,
  };
}

export async function deleteFromSpaces(key?: string | null) {
  const s3 = spacesClient();
  if (!s3 || !key) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: config.spaces.bucket, Key: key }));
  } catch {
    // ignore cleanup errors
  }
}

export function keyFromImage(image: any): string | null {
  if (!image) return null;
  if (typeof image.key === "string" && image.key) return image.key;
  // legacy local-disk records only have filename
  return null;
}
