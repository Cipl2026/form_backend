import mongoose, { Schema } from "mongoose";

const ImageSchema = new Schema({
  // Spaces object key, e.g. "employees/photo/<uuid>.jpg"
  key: { type: String, required: true },
  // Public CDN / Spaces URL stored in MongoDB
  url: { type: String, required: true },
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
}, { _id: false });

const FileSchema = new Schema({
  key: { type: String, required: true },
  url: { type: String, required: true },
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
}, { _id: false });

const EmployeeSchema = new Schema({
  employeeId: { type: String, required: true, trim: true, maxlength: 50, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120, index: true },
  // Stored & validated in DD-MM-YYYY format (e.g. 26-09-2026)
  dob: { type: String, required: true, trim: true, match: /^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])-\d{4}$/ },
  joiningDate: { type: String, required: true, trim: true, match: /^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])-\d{4}$/ },
  contactNumber: { type: String, required: true, trim: true, match: /^[0-9]{10}$/ },
  // Strict format check at the schema level too (routes apply the full fake-email check)
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 180, index: true,
    match: [/^[^\s@]+@[^\s@-]+(\.[^\s@-]+)+$/, "Enter a valid email address."] },
  alternateContactNumber: { type: String, required: true, trim: true, match: /^[0-9]{10}$/ },
  address: { type: String, required: true, trim: true, maxlength: 500 },
  addressCity: { type: String, required: true, trim: true, maxlength: 120 },
  addressState: { type: String, required: true, trim: true, maxlength: 120 },
  addressPincode: { type: String, required: true, trim: true, match: /^[1-9][0-9]{5}$/ },
  alternateAddress: { type: String, required: true, trim: true, maxlength: 500 },
  alternateAddressCity: { type: String, required: true, trim: true, maxlength: 120 },
  alternateAddressState: { type: String, required: true, trim: true, maxlength: 120 },
  alternateAddressPincode: { type: String, required: true, trim: true, match: /^[1-9][0-9]{5}$/ },
  designation: { type: String, required: true, trim: true, maxlength: 120 },
  qualification: { type: String, required: true, trim: true, maxlength: 180 },
  fatherName: { type: String, required: true, trim: true, maxlength: 120 },
  fatherContactNumber: { type: String, required: true, trim: true, match: /^[0-9]{10}$/ },
  motherName: { type: String, required: true, trim: true, maxlength: 120 },
  motherContactNumber: { type: String, required: true, trim: true, match: /^[0-9]{10}$/ },
  photo: { type: ImageSchema, required: true, default: null },
  employeeSignature: { type: ImageSchema, required: true, default: null },
  aadharFront: { type: ImageSchema, required: true, default: null },
  aadharBack: { type: ImageSchema, required: true, default: null },
  qualificationDoc: { type: FileSchema, required: true, default: null },
  hrSignature: { type: ImageSchema, default: null },
  // Short-lived JWT that lets the employee download their own PDF right after submit
  pdfToken: { type: String, default: null, select: false },
  declarationAccepted: { type: Boolean, required: true, default: false },
  submittedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

EmployeeSchema.index({ name: "text", email: "text", designation: "text", employeeId: "text" });
export const Employee = mongoose.model("Employee", EmployeeSchema);


