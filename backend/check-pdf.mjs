import zlib from 'node:zlib';
import fs from 'node:fs';

const b = fs.readFileSync('/tmp/test-employee.pdf');
const asText = b.toString('latin1');
const re = /stream\r?\n/g;
let m, out = '';
while ((m = re.exec(asText))) {
  const start = m.index + m[0].length;
  const end = asText.indexOf('endstream', start);
  if (end < 0) break;
  try { out += zlib.inflateSync(b.subarray(start, end)).toString('latin1'); } catch { /* not flate */ }
}
const needles = ['Employee ID', 'EMP-001', 'DOB (DD-MM-YYYY)', '15-08-1998', 'Joining Date', '26-09-2026', 'marks_card.pdf', 'Qualification'];
for (const n of needles) console.log(n.padEnd(24), out.includes(n) ? 'FOUND' : 'MISSING');
