const mailchimp = require('@mailchimp/mailchimp_marketing');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');

// Initialize Mailchimp (list management only)
mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_SERVER_PREFIX || 'us1',
});

// Initialize Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getFormattedDuration(startTime, endTime) {
  const diffMs = new Date(endTime) - new Date(startTime);
  const diffMins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMins / 60);
  const minutes = diffMins % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function generatePDF(tripData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const NAVY = '#0c4a6e';
    const BLUE = '#0ea5e9';
    const LIGHT_BLUE = '#f0f9ff';
    const GRAY = '#64748b';
    const WHITE = '#ffffff';
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 50;
    const contentWidth = pageWidth - margin * 2;

    doc.rect(0, 0, pageWidth, 120).fill(NAVY);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(32).text('ENOCEAN TOURS', margin, 28, { align: 'center', width: contentWidth });
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(13).text('TRIP REPORT', margin, 68, { align: 'center', width: contentWidth });
    doc.fillColor(WHITE).font('Helvetica').fontSize(10).fillOpacity(0.75).text('Small by design. Unforgettable by nature.', margin, 90, { align: 'center', width: contentWidth });
    doc.fillOpacity(1);

    const statsY = 140;
    const cardW = (contentWidth - 15) / 2;
    const cardH = 55;
    const stats = [
      { label: 'DATE', value: new Date(tripData.startTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) },
      { label: 'DURATION', value: getFormattedDuration(tripData.startTime, tripData.endTime) },
      { label: 'PASSENGERS', value: String(tripData.passengers) },
      { label: 'TOTAL SIGHTINGS', value: String(tripData.sightings.length) },
    ];

    stats.forEach((stat, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = margin + col * (cardW + 15);
      const y = statsY + row * (cardH + 10);
      doc.rect(x, y, cardW, cardH).fill(LIGHT_BLUE);
      doc.rect(x, y, 4, cardH).fill(NAVY);
      doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(8).text(stat.label, x + 12, y + 10, { width: cardW - 20 });
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(14).text(stat.value, x + 12, y + 24, { width: cardW - 20 });
    });

    let currentY = statsY + 2 * (cardH + 10) + 15;

    if (tripData.waterTemp || tripData.visibility || tripData.conditions) {
      doc.rect(margin, currentY, contentWidth, 36).fill(LIGHT_BLUE);
      const conditions = [];
      if (tripData.waterTemp) conditions.push(`Water Temp: ${tripData.waterTemp}°F`);
      if (tripData.visibility) conditions.push(`Visibility: ${tripData.visibility}`);
      if (tripData.conditions) conditions.push(`Sea Conditions: ${tripData.conditions}`);
      doc.fillColor(NAVY).font('Helvetica').fontSize(10).text(conditions.join('   •   '), margin + 12, currentY + 12, { width: contentWidth - 24, align: 'center' });
      currentY += 50;
    }

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text('SIGHTINGS LOG', margin, currentY);
    currentY += 20;

    const colWidths = [220, 80, 100, contentWidth - 400];
    const colHeaders = ['SPECIES', 'COUNT', 'TIME', 'LOCATION'];
    const rowH = 28;

    doc.rect(margin, currentY, contentWidth, rowH).fill(NAVY);
    let colX = margin;
    colHeaders.forEach((header, i) => {
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(9).text(header, colX + 8, currentY + 9, { width: colWidths[i] - 10 });
      colX += colWidths[i];
    });
    currentY += rowH;

    if (tripData.sightings.length === 0) {
      doc.rect(margin, currentY, contentWidth, rowH).fill(LIGHT_BLUE);
      doc.fillColor(GRAY).font('Helvetica').fontSize(10).text('No sightings logged', margin + 8, currentY + 8);
      currentY += rowH;
    } else {
      tripData.sightings.forEach((sighting, i) => {
        const rowColor = i % 2 === 0 ? WHITE : LIGHT_BLUE;
        doc.rect(margin, currentY, contentWidth, rowH).fill(rowColor);
        const location = sighting.lat && sighting.lng ? `${sighting.lat.toFixed(4)}, ${sighting.lng.toFixed(4)}` : 'Monterey Bay';
        const rowData = [sighting.species, String(sighting.count), sighting.time, location];
        colX = margin;
        rowData.forEach((cell, j) => {
          doc.fillColor(NAVY).font(j === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(cell, colX + 8, currentY + 8, { width: colWidths[j] - 10 });
          colX += colWidths[j];
        });
        doc.rect(margin, currentY, contentWidth, rowH).stroke('#e2e8f0');
        currentY += rowH;
      });
    }

    const footerY = pageHeight - 80;
    doc.rect(0, footerY, pageWidth, 80).fill(NAVY);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11).text('Thank you for choosing Enocean Tours', margin, footerY + 15, { align: 'center', width: contentWidth });
    doc.fillColor(WHITE).font('Helvetica').fontSize(9).fillOpacity(0.8).text('Book your next adventure at enoceantours.com', margin, footerY + 35, { align: 'center', width: contentWidth });
    doc.fillColor(BLUE).font('Helvetica').fontSize(8).fillOpacity(1).text('Moss Landing Harbor, Monterey Bay, CA', margin, footerY + 55, { align: 'center', width: contentWidth });

    doc.end();
  });
}

async function addToMailchimp(email) {
  try {
    await mailchimp.lists.addListMember(process.env.MAILCHIMP_AUDIENCE_ID, {
      email_address: email,
      status: 'subscribed',
      tags: ['Trip Guest'],
    });
  } catch (err) {
    console.log('Mailchimp note:', err.message);
    // Don't throw — email still sends even if Mailchimp fails
  }
}

async function sendEmail(guestEmail, pdfBuffer, tripData) {
  const date = new Date(tripData.startTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const speciesList = tripData.sightings.map((s) => `${s.species} (×${s.count})`).join(', ') || 'No sightings logged';
  const duration = getFormattedDuration(tripData.startTime, tripData.endTime);

  const result = await transporter.sendMail({
    from: `"Enocean Tours" <${process.env.GMAIL_USER}>`,
    to: guestEmail,
    subject: `Your Enocean Tours Trip Report — ${date}`,
    html: `
      <body style="font-family:Arial,sans-serif;background:#f0f9ff;margin:0;padding:40px 20px;">
        <table width="600" style="margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
          <tr><td style="background:linear-gradient(135deg,#1e3a8a,#0c4a6e);padding:40px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;">ENOCEAN TOURS</h1>
            <p style="color:#0ea5e9;margin:8px 0 0;">TRIP REPORT</p>
            <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:11px;">Small by design. Unforgettable by nature.</p>
          </td></tr>
          <tr><td style="padding:40px;">
            <p style="color:#0c4a6e;font-size:16px;">Hi there,</p>
            <p style="color:#444;font-size:14px;line-height:1.6;">Thank you for joining us on the water. Your trip report PDF is attached below.</p>
            <table width="100%" style="margin:24px 0;">
              <tr>
                <td width="48%" style="background:#f0f9ff;padding:16px;border-left:4px solid #0c4a6e;"><p style="margin:0;color:#64748b;font-size:10px;font-weight:bold;text-transform:uppercase;">Date</p><p style="margin:4px 0 0;color:#0c4a6e;font-weight:bold;">${date}</p></td>
                <td width="4%"></td>
                <td width="48%" style="background:#f0f9ff;padding:16px;border-left:4px solid #0c4a6e;"><p style="margin:0;color:#64748b;font-size:10px;font-weight:bold;text-transform:uppercase;">Duration</p><p style="margin:4px 0 0;color:#0c4a6e;font-weight:bold;">${duration}</p></td>
              </tr>
              <tr><td colspan="3" style="height:12px;"></td></tr>
              <tr>
                <td width="48%" style="background:#f0f9ff;padding:16px;border-left:4px solid #0c4a6e;"><p style="margin:0;color:#64748b;font-size:10px;font-weight:bold;text-transform:uppercase;">Passengers</p><p style="margin:4px 0 0;color:#0c4a6e;font-weight:bold;">${tripData.passengers}</p></td>
                <td width="4%"></td>
                <td width="48%" style="background:#f0f9ff;padding:16px;border-left:4px solid #0c4a6e;"><p style="margin:0;color:#64748b;font-size:10px;font-weight:bold;text-transform:uppercase;">Sightings</p><p style="margin:4px 0 0;color:#0c4a6e;font-weight:bold;">${tripData.sightings.length}</p></td>
              </tr>
            </table>
            <div style="background:#f0f9ff;padding:16px;border-radius:4px;margin-bottom:24px;">
              <p style="margin:0 0 8px;color:#0c4a6e;font-weight:bold;font-size:12px;text-transform:uppercase;">What We Saw</p>
              <p style="margin:0;color:#444;font-size:14px;">${speciesList}</p>
            </div>
            <div style="text-align:center;margin:32px 0;">
              <a href="https://enoceantours.com" style="background:#0c4a6e;color:#fff;padding:14px 32px;text-decoration:none;border-radius:4px;font-weight:bold;">Book Your Next Trip</a>
            </div>
            <p style="color:#94a3b8;font-size:12px;text-align:center;">Moss Landing Harbor, Monterey Bay, CA<br><a href="https://enoceantours.com" style="color:#0ea5e9;">enoceantours.com</a></p>
          </td></tr>
        </table>
      </body>
    `,
    attachments: [{
      filename: `Enocean_Trip_${new Date(tripData.startTime).toISOString().split('T')[0]}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
  });

  console.log('Gmail sent:', result.messageId);
  return result;
}

module.exports = async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tripData, guestEmail } = req.body;
  if (!tripData || !guestEmail) return res.status(400).json({ error: 'Missing tripData or guestEmail' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(guestEmail)) return res.status(400).json({ error: 'Invalid email address' });

  try {
    console.log('Generating PDF...');
    const pdfBuffer = await generatePDF(tripData);
    console.log('PDF generated, size:', pdfBuffer.length);

    console.log('Adding to Mailchimp...');
    await addToMailchimp(guestEmail);

    console.log('Sending email via Gmail...');
    await sendEmail(guestEmail, pdfBuffer, tripData);

    return res.status(200).json({ success: true, message: `Trip report sent to ${guestEmail}` });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: 'Failed to send trip report', detail: err.message });
  }
};
