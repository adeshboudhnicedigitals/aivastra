import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';

function generatePairingCode(): string {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return Array.from(randomBytes(10), (b) => a[b % a.length]).join('');
}

async function main() {
  const sql = postgres('postgres://tryon:tryon_dev_pw@127.0.0.1:5433/tryon_dev', { max: 1 });
  const code = generatePairingCode();
  const hash = createHash('sha256').update(code.toUpperCase()).digest('hex');
  await sql.unsafe(
    "INSERT INTO kiosk_devices (widget_client_id,label,status,pairing_code_hash,pairing_code_expires_at) VALUES ('1cf0fdea-c66e-49e0-be37-89ff1bd1e6ca','Mobile-3','pending',$1,NOW()+INTERVAL '15 min')",
    [hash],
  );
  console.log(code);
  await sql.end();
}
main();
