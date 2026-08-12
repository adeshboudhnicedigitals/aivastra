import PDFDocument from 'pdfkit';

export interface InvoiceData {
  invoiceNumber: string;
  issuedAt: Date;
  seller: { gstin: string; legalName: string; address: string };
  customer: { email: string; gstin: string | null };
  planName: string;
  credits: number;
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
}

// Apr 1 - Mar 31 Indian GST financial year, e.g. "2026-27" for any date
// from 2026-04-01 through 2027-03-31.
export function financialYearFor(date: Date): string {
  const y = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 3 ? y : y - 1; // getUTCMonth() is 0-indexed; 3 = April
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function fmtRupees(paise: number): string {
  return `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

export function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text('TAX INVOICE', { align: 'center' });
    doc.moveDown();

    doc.fontSize(10);
    doc.text(`Invoice Number: ${data.invoiceNumber}`);
    doc.text(
      `Invoice Date: ${data.issuedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    );
    doc.moveDown();

    doc.fontSize(12).text('Seller', { underline: true });
    doc.fontSize(10);
    doc.text(data.seller.legalName || '—');
    doc.text(data.seller.address || '—');
    doc.text(`GSTIN: ${data.seller.gstin || '—'}`);
    doc.moveDown();

    doc.fontSize(12).text('Customer', { underline: true });
    doc.fontSize(10);
    doc.text(data.customer.email);
    doc.text(`GSTIN: ${data.customer.gstin || '—'}`);
    doc.moveDown();

    const tableTop = doc.y + 10;
    doc.fontSize(10);
    doc.text('Description', 50, tableTop);
    doc.text('Amount', 450, tableTop, { width: 100, align: 'right' });
    doc
      .moveTo(50, tableTop + 15)
      .lineTo(550, tableTop + 15)
      .stroke();

    let y = tableTop + 25;
    doc.text(`${data.planName} — ${data.credits.toLocaleString('en-IN')} Credits`, 50, y);
    doc.text(fmtRupees(data.basePaise), 450, y, { width: 100, align: 'right' });
    y += 20;
    doc.text('GST (18%)', 50, y);
    doc.text(fmtRupees(data.gstPaise), 450, y, { width: 100, align: 'right' });
    y += 15;
    doc.moveTo(50, y).lineTo(550, y).stroke();
    y += 10;
    doc.fontSize(11).text('Total', 50, y);
    doc.text(fmtRupees(data.totalPaise), 450, y, { width: 100, align: 'right' });

    doc.end();
  });
}
