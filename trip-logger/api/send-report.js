const mailchimp = require('@mailchimp/mailchimp_marketing');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const https = require('https');

// Initialize Mailchimp
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

// ─── Fetch Google Maps Static Image ──────────────────────────────────────────

function fetchMapImage(sightings) {
  return new Promise((resolve) => {
    const sightingsWithCoords = sightings.filter(s => s.lat && s.lng);

    if (sightingsWithCoords.length === 0) {
      // Default center of Monterey Bay
      const url = `https://maps.googleapis.com/maps/api/staticmap?center=36.8,-122.0&zoom=10&size=520x300&maptype=satellite&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      fetchURL(url).then(resolve).catch(() => resolve(null));
      return;
    }

    // Build markers for each sighting
    const markers = sightingsWithCoords.map((s, i) =>
      `markers=color:0x0ea5e9|label:${i + 1}|${s.lat},${s.lng}`
    ).join('&');

    // Center on average of sighting coords
    const avgLat = sightingsWithCoords.reduce((sum, s) => sum + s.lat, 0) / sightingsWithCoords.length;
    const avgLng = sightingsWithCoords.reduce((sum, s) => sum + s.lng, 0) / sightingsWithCoords.length;

    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${avgLat},${avgLng}&zoom=11&size=520x300&maptype=satellite&${markers}&key=${process.env.GOOGLE_MAPS_API_KEY}`;

    fetchURL(url).then(resolve).catch(() => resolve(null));
  });
}

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── PDF Generator ───────────────────────────────────────────────────────────

async function generatePDF(tripData) {
  const mapImageBuffer = await fetchMapImage(tripData.sightings);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
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

    // ─────────────────────────────────────────────────────────────────────────
    // PAGE 1: Header + Stats + Conditions + Photo
    // ─────────────────────────────────────────────────────────────────────────

    // ── Header ──
    doc.rect(0, 0, pageWidth, 100).fill(NAVY);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(28).text('ENOCEAN TOURS', margin, 20, { align: 'center', width: contentWidth });
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(11).text('TRIP REPORT', margin, 57, { align: 'center', width: contentWidth });
    doc.fillColor(WHITE).font('Helvetica').fontSize(8).fillOpacity(0.7).text('Small by design. Unforgettable by nature.', margin, 76, { align: 'center', width: contentWidth });
    doc.fillOpacity(1);

    // ── Stats Grid (4 cards in a row) ──
    const statsY = 116;
    const cardW = (contentWidth - 30) / 4;
    const cardH = 48;
    const stats = [
      { label: 'DATE', value: new Date(tripData.startTime).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) },
      { label: 'DURATION', value: getFormattedDuration(tripData.startTime, tripData.endTime) },
      { label: 'PASSENGERS', value: String(tripData.passengers) },
      { label: 'SIGHTINGS', value: String(tripData.sightings.length) },
    ];

    stats.forEach((stat, i) => {
      const x = margin + i * (cardW + 10);
      doc.rect(x, statsY, cardW, cardH).fill(LIGHT_BLUE);
      doc.rect(x, statsY, 4, cardH).fill(NAVY);
      doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(7).text(stat.label, x + 8, statsY + 8, { width: cardW - 12 });
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(stat.value, x + 8, statsY + 22, { width: cardW - 12 });
    });

    let currentY = statsY + cardH + 10;

    // ── Conditions ──
    if (tripData.waterTemp || tripData.visibility || tripData.conditions) {
      doc.rect(margin, currentY, contentWidth, 28).fill(LIGHT_BLUE);
      const conditions = [];
      if (tripData.waterTemp) conditions.push(`Water Temp: ${tripData.waterTemp}°F`);
      if (tripData.visibility) conditions.push(`Visibility: ${tripData.visibility}`);
      if (tripData.conditions) conditions.push(`Sea: ${tripData.conditions}`);
      doc.fillColor(NAVY).font('Helvetica').fontSize(9).text(conditions.join('   •   '), margin + 10, currentY + 9, { width: contentWidth - 20, align: 'center' });
      currentY += 36;
    }

    // ── Group Photo (fills remaining page 1 space) ──
    if (tripData.photoData) {
      try {
        const base64Data = tripData.photoData.replace(/^data:image\/\w+;base64,/, '');
        const photoBuffer = Buffer.from(base64Data, 'base64');
        const photoH = 480; // fixed height, fits page 1
        doc.save();
        doc.rect(margin, currentY, contentWidth, photoH).clip();
        doc.image(photoBuffer, margin, currentY, {
          cover: [contentWidth, photoH],
          align: 'center',
          valign: 'center',
        });
        doc.restore();
        // No currentY increment - footer is absolute positioned
      } catch (e) {
        console.error('Photo error:', e.message);
      }
    }

    // ── Page 1 Footer ──
    const footer1Y = pageHeight - 60;
    doc.rect(0, footer1Y, pageWidth, 60).fill(NAVY);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(9).text('Thank you for choosing Enocean Tours', margin, footer1Y + 10, { align: 'center', width: contentWidth });
    doc.fillColor(WHITE).font('Helvetica').fontSize(8).fillOpacity(0.8).text('enoceantours.com  •  Moss Landing Harbor, Monterey Bay, CA', margin, footer1Y + 28, { align: 'center', width: contentWidth });
    doc.fillOpacity(1);

    // ─────────────────────────────────────────────────────────────────────────
    // PAGE 2: Map + Sightings Table
    // ─────────────────────────────────────────────────────────────────────────
    doc.addPage();

    // ── Page 2 Header ──
    doc.rect(0, 0, pageWidth, 50).fill(NAVY);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(16).text('ENOCEAN TOURS — TRIP REPORT', margin, 16, { align: 'center', width: contentWidth });

    currentY = 66;

    // ── Map ──
    if (mapImageBuffer) {
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text('SIGHTING LOCATIONS', margin, currentY);
      currentY += 12;
      try {
        const mapH = 220;
        doc.image(mapImageBuffer, margin, currentY, {
          width: contentWidth,
          height: mapH,
        });
        // Legend
        const sightingsWithCoords = tripData.sightings.filter(s => s.lat && s.lng);
        if (sightingsWithCoords.length > 0) {
          currentY += mapH + 4;
          doc.rect(margin, currentY, contentWidth, 20).fill(LIGHT_BLUE);
          const legendItems = sightingsWithCoords.map((s, i) => `${i + 1}. ${s.species}`).join('   ');
          doc.fillColor(NAVY).font('Helvetica').fontSize(8).text(legendItems, margin + 8, currentY + 6, { width: contentWidth - 16 });
          currentY += 28;
        } else {
          currentY += mapH + 12;
        }
      } catch (e) {
        console.error('Map error:', e.message);
        currentY += 12;
      }
    }

    // ── Sightings Table ──
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text('SIGHTINGS LOG', margin, currentY);
    currentY += 12;

    const colWidths = [160, 50, 60, contentWidth - 270];
    const colHeaders = ['SPECIES', 'COUNT', 'TIME', 'NOTES'];
    const rowH = 26;

    doc.rect(margin, currentY, contentWidth, rowH).fill(NAVY);
    let colX = margin;
    colHeaders.forEach((header, i) => {
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(8).text(header, colX + 7, currentY + 8, { width: colWidths[i] - 10 });
      colX += colWidths[i];
    });
    currentY += rowH;

    if (tripData.sightings.length === 0) {
      doc.rect(margin, currentY, contentWidth, rowH).fill(LIGHT_BLUE);
      doc.fillColor(GRAY).font('Helvetica').fontSize(9).text('No sightings logged', margin + 7, currentY + 8);
      currentY += rowH;
    } else {
      tripData.sightings.forEach((sighting, i) => {
        const rowColor = i % 2 === 0 ? WHITE : LIGHT_BLUE;
        doc.rect(margin, currentY, contentWidth, rowH).fill(rowColor);
        const rowData = [sighting.species, String(sighting.count), sighting.time, sighting.notes || ''];
        colX = margin;
        rowData.forEach((cell, j) => {
          doc.fillColor(NAVY).font(j === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(cell, colX + 7, currentY + 8, { width: colWidths[j] - 10 });
          colX += colWidths[j];
        });
        doc.rect(margin, currentY, contentWidth, rowH).stroke('#e2e8f0');
        currentY += rowH;
      });
    }

    // ── Page 2 Footer ──
    const footer2Y = pageHeight - 60;
    doc.rect(0, footer2Y, pageWidth, 60).fill(NAVY);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(9).text('Thank you for choosing Enocean Tours', margin, footer2Y + 10, { align: 'center', width: contentWidth });
    doc.fillColor(WHITE).font('Helvetica').fontSize(8).fillOpacity(0.8).text('enoceantours.com  •  Moss Landing Harbor, Monterey Bay, CA', margin, footer2Y + 28, { align: 'center', width: contentWidth });
    doc.fillOpacity(1);

    doc.end();
  });
}

// ─── Mailchimp ────────────────────────────────────────────────────────────────

async function addToMailchimp(email) {
  try {
    await mailchimp.lists.addListMember(process.env.MAILCHIMP_AUDIENCE_ID, {
      email_address: email,
      status: 'subscribed',
      tags: ['Trip Guest'],
    });
  } catch (err) {
    console.log('Mailchimp note:', err.message);
  }
}

// ─── Send Email ───────────────────────────────────────────────────────────────

async function sendEmail(guestEmail, pdfBuffer, tripData) {
  const date = new Date(tripData.startTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const speciesList = tripData.sightings.map(s => `${s.species} (×${s.count})`).join(', ') || 'No sightings logged';
  const duration = getFormattedDuration(tripData.startTime, tripData.endTime);

  const result = await transporter.sendMail({
    from: `"Enocean Tours" <${process.env.GMAIL_USER}>`,
    to: guestEmail,
    subject: `Your Enocean Tours Trip Report — ${date}`,
    html: `
      <body style="font-family:Arial,sans-serif;background:#f0f9ff;margin:0;padding:40px 20px;">
        <table width="600" style="margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
          <tr><td style="background:linear-gradient(135deg,#1e3a8a,#0c4a6e);padding:40px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;letter-spacing:2px;">ENOCEAN TOURS</h1>
            <p style="color:#0ea5e9;margin:8px 0 0;font-weight:bold;">TRIP REPORT</p>
            <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:11px;">Small by design. Unforgettable by nature.</p>
          </td></tr>
          <tr><td style="padding:40px;">
            <p style="color:#0c4a6e;font-size:16px;">Hi there,</p>
            <p style="color:#444;font-size:14px;line-height:1.6;">Thank you for joining us on the water today. Your trip report PDF is attached.</p>
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

// ─── Main Handler ─────────────────────────────────────────────────────────────

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
    console.log('PDF done, size:', pdfBuffer.length);

    await addToMailchimp(guestEmail);
    await sendEmail(guestEmail, pdfBuffer, tripData);

    return res.status(200).json({ success: true, message: `Trip report sent to ${guestEmail}` });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: 'Failed to send trip report', detail: err.message });
  }
};
