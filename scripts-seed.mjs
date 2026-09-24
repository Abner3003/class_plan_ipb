import { createHash, randomBytes } from 'node:crypto';
const names = ['Suellen', 'Samara', 'Julia', 'Agata'];
function hash(code, salt) {
  let out = Buffer.from(`${salt}:${code}`);
  for (let i = 0; i < 120000; i++) out = createHash('sha256').update(out).digest();
  return out.toString('base64url');
}
const missing = names.filter(name => !process.env[`CODE_${name.toUpperCase()}`]);
if (missing.length) {
  console.error(`Defina ${missing.map(name => `CODE_${name.toUpperCase()}`).join(', ')}`);
  process.exit(1);
}
// Preserve the teacher ID and associated plans when correcting the name.
console.log("UPDATE teachers SET name='Agata' WHERE name='Aghata';");
for (const name of names) {
  const code = process.env[`CODE_${name.toUpperCase()}`];
  const salt = randomBytes(16).toString('hex');
  console.log(`INSERT INTO teachers(name,access_code_hash,code_salt) VALUES('${name}','${hash(code, salt)}','${salt}') ON CONFLICT(name) DO UPDATE SET access_code_hash=excluded.access_code_hash,code_salt=excluded.code_salt;`);
}
