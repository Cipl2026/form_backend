import { createEmployeePdf, pdfToBuffer } from './dist/utils/pdf.js';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';

// 1) date validation (mirrors src/routes/employees.ts)
const dateDDMMYYYY = z.string().trim().regex(/^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])-\d{4}$/, 'format').refine((v) => {
  const [dd, mm, yyyy] = v.split('-').map(Number);
  if (yyyy < 1900 || yyyy > 2100) return false;
  const d = new Date(yyyy, mm - 1, dd);
  return d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd;
}, 'valid');
const cases = ['26-09-2026', '01-01-1990', '2026-09-26', '31-02-2026', '29-02-2025', '29-02-2024', '5-9-2026'];
for (const c of cases) console.log(c.padEnd(12), dateDDMMYYYY.safeParse(c).success ? 'ACCEPT' : 'REJECT');

// 2) PDF renders with the new fields
const emp = {
  name: 'Test User', employeeId: 'EMP-001', dob: '15-08-1998', joiningDate: '26-09-2026',
  email: 't@e.com', contactNumber: '1234567890', alternateContactNumber: '9876543210',
  address: 'Address One, City', addressCity: 'Mumbai', addressState: 'Maharashtra', addressPincode: '400001',
  alternateAddress: 'Address Two, City', alternateAddressCity: 'Pune', alternateAddressState: 'Maharashtra', alternateAddressPincode: '411001',
  designation: 'Engineer',
  qualification: 'B.Tech', qualificationDoc: { originalName: 'marks_card.pdf', url: 'https://example.com/marks_card.pdf' },
  fatherName: 'Father', fatherContactNumber: '1111111111', motherName: 'Mother', motherContactNumber: '2222222222',
  submittedAt: new Date(),
};
const buf = await pdfToBuffer(await createEmployeePdf(emp));
writeFileSync('/tmp/test-employee.pdf', buf);
console.log('PDF bytes:', buf.length);
