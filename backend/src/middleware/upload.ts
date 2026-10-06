import multer from "multer";

const imageMimes = new Set(["image/jpeg", "image/png", "image/webp"]);
const PDF_MIME = "application/pdf";

// Use memory storage so files can be streamed directly to DigitalOcean Spaces.
// Nothing is kept on local disk — the Spaces URL is what gets stored in MongoDB.
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 6, fields: 40 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === "qualificationDoc") {
      if (file.mimetype !== PDF_MIME) return cb(new Error("Qualification document must be a PDF file."));
      return cb(null, true);
    }
    if (["photo", "employeeSignature", "aadharFront", "aadharBack", "hrSignature"].includes(file.fieldname)) {
      if (!imageMimes.has(file.mimetype)) return cb(new Error("Only JPG, PNG, and WebP images are allowed for photos/signatures/Aadhar."));
      return cb(null, true);
    }
    return cb(new Error(`Unexpected file field: ${file.fieldname}`));
  },
});

