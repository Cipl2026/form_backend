import { Router } from "express";
import archiver from "archiver";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { Employee } from "../models/Employee.js";
import { requireAuth } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { createEmployeePdf, pdfToBuffer } from "../utils/pdf.js";
import { uploadBufferToSpaces, deleteFromSpaces, keyFromImage } from "../utils/spaces.js";
import { config, spacesEnabled } from "../config.js";

const router = Router();
const phone10 = z.string().trim().regex(/^[0-9]{10}$/, "Must be exactly 10 digits.");
const pincode6 = z.string().trim().regex(/^[1-9][0-9]{5}$/, "Pincode must be exactly 6 digits and cannot start with 0.");
const shortText = (label: string) => z.string().trim().min(1, `${label} is compulsory.`).max(120);

// Domains that are reserved for tests (RFC 2606) or well-known fake / temporary
// email providers — none of these should ever reach the database.
const FAKE_EMAIL_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "test.com", "test.org", "test.net",
  "localhost", "fakemail.com", "notanemail.com",
  "mailinator.com", "yopmail.com", "guerrillamail.com", "tempmail.com", "temp-mail.org",
  "10minutemail.com", "trashmail.com", "sharklasers.com", "dispostable.com", "maildrop.cc",
  "fakeinbox.com", "throwawaymail.com", "mailcatch.com", "tempr.email", "getnada.com",
]);

/**
 * Strict email validation — rejects fake / malformed addresses:
 * - exactly one "@", no whitespace anywhere
 * - local part: 1-64 chars, allowed symbols only, no leading/trailing/consecutive dots
 * - domain: valid labels (no leading/trailing hyphen), at least one dot,
 *   TLD of 2+ letters only (so "a@b.c", "a@b", "a@b.123" all fail)
 * - rejects RFC 2606 reserved domains (example/test/invalid/local…) and
 *   well-known disposable / fake-email providers
 */
function isValidEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  if (!email || email.length > 180) return false;
  if ((email.match(/@/g) || []).length !== 1) return false;
  const at = email.indexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  // local part rules
  if (local.length < 1 || local.length > 64) return false;
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  // domain rules
  if (domain.length < 4 || domain.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(domain)) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  if (domain.startsWith("-") || domain.endsWith("-")) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false; // must contain a TLD (rejects "user@localhost")
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
  }
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld)) return false; // TLD must be 2+ letters
  // reserved / fake domains: block anything using example, test, invalid, local…
  if (labels.slice(0, -1).some(l => ["example", "test", "invalid", "local", "localhost"].includes(l))) return false;
  if (FAKE_EMAIL_DOMAINS.has(domain)) return false;
  return true;
}
const emailStrict = z.string().trim().max(180, "Email is too long.").refine(
  isValidEmail,
  "Enter a valid email address (fake / temporary / reserved domains are not allowed)."
);
const dateDDMMYYYY = z.string().trim().regex(
  /^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])-\d{4}$/,
  "Use DD-MM-YYYY format (e.g. 26-09-2026)."
).refine((v) => {
  const [dd, mm, yyyy] = v.split("-").map(Number);
  if (yyyy < 1900 || yyyy > 2100) return false;
  const d = new Date(yyyy, mm - 1, dd);
  return d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd;
}, "Enter a valid calendar date in DD-MM-YYYY format.");
const schema = z.object({
  employeeId: z.string().trim().min(1, "Employee ID is compulsory.").max(50),
  name: z.string().trim().min(1, "Full Name is compulsory.").max(120),
  dob: dateDDMMYYYY,
  joiningDate: dateDDMMYYYY,
  contactNumber: phone10,
  email: emailStrict,
  alternateContactNumber: phone10,
  address: z.string().trim().min(1, "Address is compulsory.").max(500),
  addressCity: shortText("Address City"),
  addressState: shortText("Address State"),
  addressPincode: pincode6,
  alternateAddress: z.string().trim().min(1, "Alternate Address is compulsory.").max(500),
  alternateAddressCity: shortText("Alternate Address City"),
  alternateAddressState: shortText("Alternate Address State"),
  alternateAddressPincode: pincode6,
  designation: z.string().trim().min(1, "Designation is compulsory.").max(120),
  qualification: z.string().trim().min(1, "Qualification is compulsory.").max(180),
  fatherName: z.string().trim().min(1, "Father's Name is compulsory.").max(120),
  fatherContactNumber: phone10,
  motherName: z.string().trim().min(1, "Mother's Name is compulsory.").max(120),
  motherContactNumber: phone10,
  declarationAccepted: z.coerce.boolean().refine(Boolean, "Declaration must be accepted."),
});

async function uploadOne(file: Express.Multer.File | undefined, folder: string) {
  if (!file?.buffer) return null;
  if (!spacesEnabled) {
    throw new Error("DigitalOcean Spaces is not configured. Set DO_SPACES_ENDPOINT, DO_SPACES_BUCKET, DO_SPACES_KEY and DO_SPACES_SECRET.");
  }
  return uploadBufferToSpaces(file.buffer, file.mimetype, file.originalname, folder);
}

router.post("/", upload.fields([
  { name: "photo", maxCount: 1 },
  { name: "employeeSignature", maxCount: 1 },
  { name: "aadharFront", maxCount: 1 },
  { name: "aadharBack", maxCount: 1 },
  { name: "qualificationDoc", maxCount: 1 },
  // hrSignature no longer uploaded via form — kept only for old records
  { name: "hrSignature", maxCount: 1 },
]), async (req, res, next) => {
  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid form data." });
    const uploaded = req.files as Record<string, Express.Multer.File[]> | undefined;
    if (!uploaded?.photo?.[0]) return res.status(400).json({ message: "Passport Size Photo is compulsory." });
    if (!uploaded?.employeeSignature?.[0]) return res.status(400).json({ message: "Employee Signature is compulsory." });
    if (!uploaded?.aadharFront?.[0]) return res.status(400).json({ message: "Aadhar Front image is compulsory." });
    if (!uploaded?.aadharBack?.[0]) return res.status(400).json({ message: "Aadhar Back image is compulsory." });
    if (!uploaded?.qualificationDoc?.[0]) return res.status(400).json({ message: "Qualification document (PDF) is compulsory." });
    const qDoc = uploaded?.qualificationDoc?.[0];
    if (qDoc && qDoc.mimetype !== "application/pdf") return res.status(400).json({ message: "Qualification document must be a PDF file." });
    if (qDoc && qDoc.size > 10 * 1024 * 1024) return res.status(400).json({ message: "Qualification PDF must be under 10 MB." });
    for (const key of ["photo", "employeeSignature", "aadharFront", "aadharBack"] as const) {
      const f = uploaded?.[key]?.[0];
      if (f && f.size > 5 * 1024 * 1024) return res.status(400).json({ message: `${key} image must be under 5 MB.` });
    }
    // Employee ID must be unique
    const existing = await Employee.findOne({ employeeId: parsed.data.employeeId.trim() }).lean();
    if (existing) return res.status(400).json({ message: "This Employee ID is already registered." });
    let photo: any = null;
    let employeeSignature: any = null;
    let aadharFront: any = null;
    let aadharBack: any = null;
    let qualificationDoc: any = null;
    let hrSignature: any = null;
    try {
      photo = await uploadOne(uploaded?.photo?.[0], "photo");
      employeeSignature = await uploadOne(uploaded?.employeeSignature?.[0], "employeeSignature");
      aadharFront = await uploadOne(uploaded?.aadharFront?.[0], "aadharFront");
      aadharBack = await uploadOne(uploaded?.aadharBack?.[0], "aadharBack");
      qualificationDoc = await uploadOne(uploaded?.qualificationDoc?.[0], "qualificationDoc");
      hrSignature = await uploadOne(uploaded?.hrSignature?.[0], "hrSignature");
    } catch (err: any) {
      await Promise.all([photo, employeeSignature, aadharFront, aadharBack, qualificationDoc, hrSignature].map((img) => deleteFromSpaces(img?.key)));
      return res.status(500).json({ message: err?.message || "File upload failed. Please try again." });
    }
    const employee = await Employee.create({
      ...parsed.data,
      employeeId: parsed.data.employeeId.trim(),
      email: parsed.data.email.toLowerCase(),
      photo,
      employeeSignature,
      aadharFront,
      aadharBack,
      qualificationDoc,
      hrSignature,
    });
    const pdfToken = jwt.sign({ scope: "employee-pdf", employeeId: employee.id }, config.jwtSecret, { expiresIn: "7d" });
    await Employee.findByIdAndUpdate(employee.id, { pdfToken });
    res.status(201).json({
      message: "Employee form submitted successfully.",
      employee: {
        _id: employee.id, name: employee.name, email: employee.email,
        designation: employee.designation, submittedAt: employee.submittedAt,
        photoUrl: photo?.url || null,
        signatureUrl: employeeSignature?.url || null,
      },
      pdfToken,
      pdfUrl: `/api/employees/${employee.id}/pdf?token=${pdfToken}`,
    });
  } catch (error) { next(error); }
});

router.get("/:id/pdf", async (req, res, next) => {
  try {
    const employee: any = await Employee.findById(req.params.id).select("+pdfToken").lean();
    if (!employee) return res.status(404).json({ message: "Employee not found." });
    const token = String(req.query.token || "");
    const authHeader = req.header("authorization") || "";
    let allowed = false;
    if (/^Bearer\s+/i.test(authHeader)) {
      try {
        const payload = jwt.verify(authHeader.replace(/^Bearer\s+/i, ""), config.jwtSecret) as jwt.JwtPayload;
        if (payload?.sub && payload.role === "HR") allowed = true;
      } catch { /* try pdf token next */ }
    }
    if (!allowed && token) {
      try {
        const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
        if (payload?.scope === "employee-pdf" && String(payload.employeeId) === String(employee._id)) allowed = true;
      } catch {
        return res.status(401).json({ message: "This download link has expired. Please ask HR for your PDF." });
      }
    }
    if (!allowed) return res.status(401).json({ message: "Authentication required." });
    const filename = `Employee_${safeFilename(employee.name)}_${employee._id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    const pdf = await createEmployeePdf(employee as Record<string, any>);
    pdf.pipe(res);
    pdf.end();
  } catch (error) { next(error); }
});

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search || "").trim().slice(0, 120);
    const filter = search ? { $or: [
      { name: { $regex: escapeRegex(search), $options: "i" } },
      { email: { $regex: escapeRegex(search), $options: "i" } },
      { designation: { $regex: escapeRegex(search), $options: "i" } },
      { employeeId: { $regex: escapeRegex(search), $options: "i" } },
    ] } : {};
    const [items, total] = await Promise.all([
      Employee.find(filter).select("employeeId name email designation contactNumber dob joiningDate submittedAt photo employeeSignature aadharFront aadharBack qualificationDoc hrSignature").sort({ submittedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Employee.countDocuments(filter),
    ]);
    res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const item = await Employee.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ message: "Employee not found." });
    res.json({ employee: item });
  } catch (error) { next(error); }
});

router.post("/bulk-pdf", async (req, res, next) => {
  try {
    const ids = z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(500).safeParse(req.body?.ids);
    if (!ids.success) return res.status(400).json({ message: "Select between 1 and 500 valid employee records." });
    const employees = await Employee.find({ _id: { $in: ids.data } }).lean();
    if (!employees.length) return res.status(404).json({ message: "No matching employees found." });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="Employee_Forms.zip"');
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (err) => { if (!res.headersSent) next(err); else res.destroy(err); });
    archive.pipe(res);

    for (const employee of employees) {
      const pdf = await createEmployeePdf(employee as Record<string, any>);
      const buffer = await pdfToBuffer(pdf);
      archive.append(buffer, { name: `${safeFilename(employee.name)}_${employee._id}.pdf` });
    }
    await archive.finalize();
  } catch (error) { next(error); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const employee = await Employee.findByIdAndDelete(req.params.id);
    if (!employee) return res.status(404).json({ message: "Employee not found." });
    for (const image of [employee.photo, employee.employeeSignature, employee.aadharFront, employee.aadharBack, employee.qualificationDoc, employee.hrSignature]) {
      await deleteFromSpaces(keyFromImage(image as any));
    }
    res.json({ message: "Employee record deleted." });
  } catch (error) { next(error); }
});

// HR: download ALL (or filtered/searched) employee details as CSV
router.get("/export/csv", async (req, res, next) => {
  try {
    const search = String(req.query.search || "").trim().slice(0, 120);
    const filter = search ? { $or: [
      { name: { $regex: escapeRegex(search), $options: "i" } },
      { email: { $regex: escapeRegex(search), $options: "i" } },
      { designation: { $regex: escapeRegex(search), $options: "i" } },
      { employeeId: { $regex: escapeRegex(search), $options: "i" } },
    ] } : {};
    const employees = await Employee.find(filter).sort({ submittedAt: -1 }).lean();
    const headers = [
      "Employee ID", "Full Name", "DOB (DD-MM-YYYY)", "Joining Date (DD-MM-YYYY)",
      "Email", "Contact Number", "Alternate Contact",
      "Address", "Address City", "Address State", "Address Pincode",
      "Alternate Address", "Alternate Address City", "Alternate Address State", "Alternate Address Pincode",
      "Designation", "Qualification", "Father Name", "Father Contact",
      "Mother Name", "Mother Contact", "Photo URL", "Signature URL",
      "Aadhar Front URL", "Aadhar Back URL", "Qualification Doc URL", "Submitted At",
    ];
    const esc = (v: any) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(esc).join(",")];
    for (const e of employees as any[]) {
      lines.push([
        e.employeeId || "", e.name || "", e.dob || "", e.joiningDate || "",
        e.email || "", e.contactNumber || "", e.alternateContactNumber || "",
        e.address || "", e.addressCity || "", e.addressState || "", e.addressPincode || "",
        e.alternateAddress || "", e.alternateAddressCity || "", e.alternateAddressState || "", e.alternateAddressPincode || "",
        e.designation || "",
        e.qualification || "", e.fatherName || "", e.fatherContactNumber || "",
        e.motherName || "", e.motherContactNumber || "",
        e.photo?.url || "", e.employeeSignature?.url || "",
        e.aadharFront?.url || "", e.aadharBack?.url || "",
        e.qualificationDoc?.url || "",
        e.submittedAt ? new Date(e.submittedAt).toISOString() : "",
      ].map(esc).join(","));
    }
    const csv = "﻿" + lines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="Employees.csv"');
    res.send(csv);
  } catch (error) { next(error); }
});

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function safeFilename(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70) || "Employee";
}
export default router;
