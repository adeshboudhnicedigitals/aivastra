/**
 * Seed demo contact requests covering all entry points in the webtool:
 *   - Tryon page enquiry form: "Integrate with Website", "Retail Store Kiosk"
 *   - In-app support modal: "app-support"
 *   - Legacy / no source: null
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('Required: DATABASE_URL');
  process.exit(1);
}

const sql = postgres(DB_URL);

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

const rows = [
  // ── Integrate with Website ────────────────────────────────────────────
  {
    id: randomUUID(),
    name: 'Priya Sharma',
    email: 'priya.sharma@fashionhub.in',
    phone: '+91 98201 45678',
    source: 'Integrate with Website',
    message:
      'We run a D2C apparel brand and want to add virtual try-on to our Shopify store. Could you walk us through the integration process and pricing?',
    status: 'new',
    created_at: hoursAgo(1),
  },
  {
    id: randomUUID(),
    name: 'Rahul Mehta',
    email: 'rahul@trendwear.co',
    phone: '+91 99305 12345',
    source: 'Integrate with Website',
    message:
      'Hi, we have a WooCommerce store with about 2,000 SKUs. Is there a bulk upload option for garments or does each item need to be added manually?',
    status: 'read',
    created_at: hoursAgo(6),
  },
  {
    id: randomUUID(),
    name: 'Ananya Reddy',
    email: 'ananya@luxeethnic.com',
    phone: '+91 90001 67890',
    source: 'Integrate with Website',
    message:
      'We sell ethnic wear and kurtas. Does the try-on model selection support Indian traditional garments and varied skin tones?',
    status: 'done',
    created_at: daysAgo(3),
  },
  {
    id: randomUUID(),
    name: 'Kiran Joshi',
    email: 'kiran.joshi@boutique360.in',
    phone: '+91 80807 33210',
    source: 'Integrate with Website',
    message: null,
    status: 'new',
    created_at: hoursAgo(2),
  },

  // ── Retail Store Kiosk ────────────────────────────────────────────────
  {
    id: randomUUID(),
    name: 'Suresh Nair',
    email: 'suresh.nair@shopmax.in',
    phone: '+91 94456 78901',
    source: 'Retail Store Kiosk',
    message:
      'We have 12 store locations in Kerala and want to install kiosks in each one. What hardware spec do you recommend and is there offline support for low-connectivity areas?',
    status: 'new',
    created_at: hoursAgo(3),
  },
  {
    id: randomUUID(),
    name: 'Deepa Varghese',
    email: 'deepa@centralfashions.com',
    phone: '+91 98765 43210',
    source: 'Retail Store Kiosk',
    message:
      "We currently use a competitor's kiosk solution and want to migrate. Can you do a side-by-side demo before we commit to your platform?",
    status: 'read',
    created_at: daysAgo(1),
  },
  {
    id: randomUUID(),
    name: 'Amit Kulkarni',
    email: 'amit.k@malls-india.com',
    phone: '+91 97654 32198',
    source: 'Retail Store Kiosk',
    message:
      'We manage 5 retail chains across Maharashtra. Looking at kiosk deployment for the upcoming festive season. What is the lead time for setup?',
    status: 'new',
    created_at: hoursAgo(30),
  },

  // ── App Support (in-app authenticated modal) ──────────────────────────
  {
    id: randomUUID(),
    name: 'Meena Pillai',
    email: 'meena.pillai@gmail.com',
    phone: '+91 91234 56789',
    source: 'app-support',
    message:
      "The try-on result for my uploaded kurta looks blurry compared to the preview thumbnail. I've tried re-uploading in PNG but the issue persists. Attaching a screenshot.",
    status: 'new',
    created_at: hoursAgo(0.5),
  },
  {
    id: randomUUID(),
    name: 'Sanjay Gupta',
    email: 'sanjay.g@yahoo.com',
    phone: '+91 88001 22334',
    source: 'app-support',
    message:
      'I was charged credits for a job that failed. The error code was WORKER_TIMEOUT. Credits have not been refunded to my account after 24 hours.',
    status: 'read',
    created_at: hoursAgo(20),
  },
  {
    id: randomUUID(),
    name: 'Divya Nambiar',
    email: 'divya.nambiar@studio9.in',
    phone: '+91 99887 65432',
    source: 'app-support',
    message:
      'Can you add a saree category to the garment types? We shoot sarees and there is no matching garment type in the studio right now.',
    status: 'done',
    created_at: daysAgo(5),
  },
  {
    id: randomUUID(),
    name: 'Arjun Patel',
    email: 'arjun.patel@designerdrapes.com',
    phone: '+91 93001 44556',
    source: 'app-support',
    message:
      'How do I download all my completed try-on images in bulk? The current UI only lets me download one at a time.',
    status: 'new',
    created_at: hoursAgo(4),
  },
  {
    id: randomUUID(),
    name: 'Lakshmi Iyer',
    email: 'lakshmi.iyer@threadcraft.in',
    phone: '+91 80001 99887',
    source: 'app-support',
    message: null,
    status: 'read',
    created_at: daysAgo(2),
  },

  // ── General / Legacy (no source) ─────────────────────────────────────
  {
    id: randomUUID(),
    name: 'Vikram Singh',
    email: 'vikram.singh@outlook.com',
    phone: '+91 97001 33445',
    source: null,
    message: 'Interested in your virtual try-on product. Please send me your brochure and pricing.',
    status: 'done',
    created_at: daysAgo(10),
  },
  {
    id: randomUUID(),
    name: 'Pooja Agarwal',
    email: 'pooja@agarwalfashions.com',
    phone: '+91 92001 55667',
    source: null,
    message:
      'I saw your demo at the India Fashion Tech Summit. Very impressed. What is the minimum contract length?',
    status: 'read',
    created_at: daysAgo(7),
  },
  {
    id: randomUUID(),
    name: 'Naresh Kumar',
    email: 'naresh.k@textilepark.in',
    phone: '+91 98001 77889',
    source: null,
    message: null,
    status: 'new',
    created_at: daysAgo(4),
  },
];

void (async () => {
  console.log(`Seeding ${rows.length} demo contact requests…`);

  for (const r of rows) {
    await sql`
      INSERT INTO contact_requests
        (id, name, email, phone, source, message, status, created_at)
      VALUES
        (${r.id}, ${r.name}, ${r.email}, ${r.phone}, ${r.source}, ${r.message}, ${r.status}, ${r.created_at})
      ON CONFLICT (id) DO NOTHING
    `;
    console.log(`  ✓ ${r.name} (${r.source ?? 'general'})`);
  }

  console.log('\nDone.');
  await sql.end();
})();
