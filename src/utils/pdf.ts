import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Hardcoded default HR stamp/signature applied to EVERY pdf (no upload needed).
const DEFAULT_HR_SIGNATURE_PATH = path.join(here, "..", "..", "assets", "hr-signature.jpg");
let defaultHrSigCache: Buffer | null | undefined;

function defaultHrSignatureBuffer(): Buffer | null {
  if (defaultHrSigCache !== undefined) return defaultHrSigCache;
  try {
    if (fs.existsSync(DEFAULT_HR_SIGNATURE_PATH)) {
      defaultHrSigCache = fs.readFileSync(DEFAULT_HR_SIGNATURE_PATH);
    } else {
      defaultHrSigCache = null;
    }
  } catch {
    defaultHrSigCache = null;
  }
  return defaultHrSigCache;
}

type ImageMeta = { key?: string; url?: string; filename: string; mimeType: string } | null;
type EmployeeLike = Record<string, any>;

async function imageBuffer(meta: ImageMeta): Promise<Buffer | null> {
  if (!meta) return null;
  // 1) Remote Spaces / CDN URL (new records)
  if (meta.url && /^https?:\/\//i.test(meta.url)) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(meta.url, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      if (ab.byteLength > 0 && ab.byteLength < 8 * 1024 * 1024) return Buffer.from(ab);
      return null;
    } catch {
      // fall through to local fallback
    }
  }
  // 2) Legacy local-disk records (filename only)
  if (meta.filename && !meta.filename.includes("/")) {
    try {
      const localPath = path.join(config.uploadDir, path.basename(meta.filename));
      if (fs.existsSync(localPath)) return fs.readFileSync(localPath);
    } catch {
      // ignore
    }
  }
  return null;
}

/** Builds the A4 employee PDF. Images are fetched from Spaces URLs (or legacy disk). */
export async function createEmployeePdf(employee: EmployeeLike): Promise<InstanceType<typeof PDFDocument>> {
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: false, info: { Title: `Employee Details - ${employee.name}` } });
  const pageWidth = doc.page.width;
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;
  const labelW = 112;
  const valueW = (contentWidth - labelW * 2) / 2;

  // ---- Title (full width, centered) ----
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#111827")
    .text("EMPLOYEE DETAILS FORM", margin, 38, { align: "center", width: contentWidth });
  // thin divider under title
  doc.moveTo(margin, 66).lineTo(pageWidth - margin, 66).lineWidth(0.6).strokeColor("#D1D5DB").stroke();

  // ---- Photo box: top-right, BELOW title so it never overlaps the table ----
  // NOTE: openImage() inside createEmployeePdf was pre-allocating an extra buffered
  // page (count=2 even for tiny content). Photo is drawn directly below instead.
  const photo = employee.photo as ImageMeta;
  const photoW = 86;
  const photoH = 100;
  const photoX = pageWidth - margin - photoW;
  const photoY = 76;
  let photoBuf: Buffer | null = null;
  if (photo) photoBuf = await imageBuffer(photo);
  // white background (so empty frame is clean)
  doc.save();
  doc.fillColor("#FFFFFF").rect(photoX, photoY, photoW, photoH).fill();
  doc.restore();

  if (photoBuf) {
    try {
      doc.save();
      doc.rect(photoX, photoY, photoW, photoH).clip();
      // CONTAIN fit: whole photo visible, no cropping, centered with white padding.
      doc.image(photoBuf, photoX + 3, photoY + 3, { fit: [photoW - 6, photoH - 6], align: "center", valign: "center" });
      doc.restore();
    } catch {
      // unsupported image (e.g. webp) -> leave white frame + fallback text
      doc.font("Helvetica").fontSize(7.5).fillColor("#9CA3AF")
        .text("Photo not available", photoX + 4, photoY + photoH / 2 - 8, { width: photoW - 8, align: "center" });
    }
  } else if (photo) {
    doc.font("Helvetica").fontSize(7.5).fillColor("#9CA3AF")
      .text("Photo not available", photoX + 4, photoY + photoH / 2 - 8, { width: photoW - 8, align: "center" });
  } else {
    doc.font("Helvetica").fontSize(8).fillColor("#9CA3AF")
      .text("PASSPORT SIZE PHOTO", photoX + 4, photoY + photoH / 2 - 10, { width: photoW - 8, align: "center" });
  }
  // border on top of image so edges look crisp
  doc.lineWidth(0.8).strokeColor("#4B5563").rect(photoX, photoY, photoW, photoH).stroke();

  // ---- Tables always start BELOW the photo -> no overlap, single page ----
  let y = photoY + photoH + 12;

  const section = (label: string) => {
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#111827").text(label, margin + 2, y);
    y += 16;
  };

  const measureH = (text: string, w: number): number => {
    const t = String(text ?? "—") || "—";
    try {
      // heightOfString respects wrapping width
      const h = doc.heightOfString(t, { width: w - 10 });
      return h;
    } catch {
      return 12;
    }
  };

  const cell = (x: number, yy: number, w: number, h: number, text: string, isLabel = false) => {
    if (isLabel) doc.fillColor("#F3F4F6").rect(x, yy, w, h).fill();
    doc.lineWidth(0.5).strokeColor("#374151").rect(x, yy, w, h).stroke();
    doc.font(isLabel ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor("#111827")
      // allow wrapping (no ellipsis) + vertical padding, centered vertically-ish
      .text(String(text ?? "—") || "—", x + 5, yy + 5, { width: w - 10, height: h - 10 });
  };

  const row = (a: string, av: string, b: string, bv: string) => {
    const x = margin;
    const pad = 8; // compact single-page layout
    const hAv = measureH(av, valueW);
    const hBv = measureH(bv, valueW);
    const hA = measureH(a, labelW);
    const hB = measureH(b, labelW);
    const h = Math.max(24, Math.ceil(Math.max(hAv, hBv, hA, hB) + pad));
    cell(x, y, labelW, h, a, true);
    cell(x + labelW, y, valueW, h, av);
    cell(x + labelW + valueW, y, labelW, h, b, true);
    cell(x + labelW * 2 + valueW, y, valueW, h, bv);
    y += h;
  };

  section("1. Personal Details");
  row("Employee ID", employee.employeeId, "Name", employee.name);
  row("DOB (DD-MM-YYYY)", employee.dob, "Joining Date (DD-MM-YYYY)", employee.joiningDate);
  row("Contact Number", employee.contactNumber, "Alternate Contact", employee.alternateContactNumber);
  row("Email", employee.email, "Designation", employee.designation);
  row("Address", employee.address, "Alternate Address", employee.alternateAddress);
  row("City", employee.addressCity, "Alternate City", employee.alternateAddressCity);
  row("State", employee.addressState, "Alternate State", employee.alternateAddressState);
  row("Pincode", employee.addressPincode, "Alternate Pincode", employee.alternateAddressPincode);
  row("Qualification", employee.qualification, "Qualification Doc (PDF)", employee.qualificationDoc?.originalName || employee.qualificationDoc?.url || "—");

  y += 10;
  section("2. Family Details");
  row("Father's Name", employee.fatherName, "Father's Contact", employee.fatherContactNumber);
  row("Mother's Name", employee.motherName, "Mother's Contact", employee.motherContactNumber);

  y += 12;
  section("3. Declaration");
  doc.font("Helvetica").fontSize(8.5).fillColor("#111827").text(
    "I hereby declare that the information provided above is true and correct to the best of my knowledge.",
    margin, y, { width: contentWidth, lineGap: 2 }
  );
  y = doc.y + 16;

  const drawSignature = async (meta: ImageMeta, x: number, title: string, fallback?: Buffer | null) => {
    const w = 172;
    const sigY = y;
    let drawn = false;
    if (meta) {
      const buf = await imageBuffer(meta);
      if (buf) {
        try { doc.image(buf, x + 16, sigY, { fit: [w - 32, 32], align: "center", valign: "bottom" }); drawn = true; } catch {}
      }
    }
    // Hardcoded HR stamp when no uploaded signature (or upload failed to load)
    if (!drawn && fallback) {
      try { doc.image(fallback, x + 16, sigY, { fit: [w - 32, 32], align: "center", valign: "bottom" }); } catch {}
    }
    doc.moveTo(x, sigY + 36).lineTo(x + w, sigY + 36).lineWidth(0.6).strokeColor("#333").stroke();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827").text(title, x, sigY + 41, { width: w, align: "center" });
  };
  await drawSignature(employee.employeeSignature, margin + 8, "Employee Signature");
  // Default hardcoded HR stamp on every PDF. Old records with an uploaded hrSignature keep it; new forms have none.
  await drawSignature(employee.hrSignature, pageWidth - margin - 180, "HR / Authorized Signatory", defaultHrSignatureBuffer());

  const bottomY = doc.page.height - 36;
  doc.font("Helvetica").fontSize(7).fillColor("#9CA3AF")
    .text(`Submitted: ${new Date(employee.submittedAt || Date.now()).toLocaleDateString("en-IN")}`, margin, bottomY, { width: contentWidth, align: "center" });

  return doc;
}

/** Renders a PDFDocument to a Buffer (for ZIP archives). */
export function pdfToBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

