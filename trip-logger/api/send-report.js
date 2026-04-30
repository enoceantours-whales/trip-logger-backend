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

function getBayZoom(sightings) {
  if (sightings.length <= 1) return 11;
  const lats = sightings.map(s => s.lat);
  const lngs = sightings.map(s => s.lng);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const lngSpan = Math.max(...lngs) - Math.min(...lngs);
  const span = Math.max(latSpan, lngSpan);
  if (span > 0.3) return 9;
  if (span > 0.15) return 10;
  if (span > 0.07) return 11;
  return 12;
}

function fetchMapImage(sightings) {
  return new Promise((resolve) => {
    const withCoords = sightings.filter(s => s.lat && s.lng);

    // Default: full Monterey Bay view matching the canyon/coastline view
    if (withCoords.length === 0) {
      const url = `https://maps.googleapis.com/maps/api/staticmap?center=36.82,-122.05&zoom=10&size=640x400&scale=2&maptype=satellite&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      fetchURL(url).then(resolve).catch(() => resolve(null));
      return;
    }

    // Dynamic zoom based on spread of sightings
    const zoom = getBayZoom(withCoords);

    // Center on average coords
    const avgLat = withCoords.reduce((sum, s) => sum + s.lat, 0) / withCoords.length;
    const avgLng = withCoords.reduce((sum, s) => sum + s.lng, 0) / withCoords.length;

    // White markers with black labels for bold B&W aesthetic
    const markers = withCoords.map((s, i) =>
      `markers=color:white|label:${i + 1}|${s.lat},${s.lng}`
    ).join('&');

    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${avgLat},${avgLng}&zoom=${zoom}&size=640x400&scale=2&maptype=satellite&${markers}&key=${process.env.GOOGLE_MAPS_API_KEY}`;

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

  // No custom font - using Helvetica-Bold
  const antonFont = null;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 0,
      size: 'LETTER',
      autoFirstPage: false,
      bufferPages: true,
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Using built-in fonts only

    const BLACK  = '#000000';
    const WHITE  = '#ffffff';
    const GRAY   = '#f2f2f2';
    const MID    = '#888888';
    const ACCENT = '#0ea5e9'; // keep blue accent for map pins/highlights only

    const W  = 612;
    const H  = 792;
    const M  = 48;   // margin
    const CW = W - M * 2;

    const bold   = 'Helvetica-Bold';
    const reg    = 'Helvetica';
    const semib  = 'Helvetica-Bold';

    const date = new Date(tripData.startTime).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const duration = getFormattedDuration(tripData.startTime, tripData.endTime);

    // ═══════════════════════════════════════════════════════════
    // PAGE 1 — Cover + Trip Details
    // ═══════════════════════════════════════════════════════════
    doc.addPage({ size: 'LETTER', margin: 0 });

    // Full black header band
    doc.rect(0, 0, W, 130).fill(BLACK);

    // Logo area — white circle
    doc.circle(W / 2, 62, 34).fill(WHITE);
    // We can't embed the logo image easily without fetching it, so use text placeholder
    doc.fillColor(BLACK).font(semib).fontSize(8)
       .text('ENOCEAN', W/2 - 22, 55, { lineBreak: false });
    doc.fillColor(BLACK).font(semib).fontSize(6)
       .text('TOURS', W/2 - 12, 66, { lineBreak: false });

    doc.fillColor(WHITE).font(bold).fontSize(9).text('TRIP REPORT', M, 108, { align: 'center', width: CW, lineBreak: false });

    // Photo — full width, big
    const photoY = 130;
    const photoH = tripData.photoData ? 310 : 180;

    if (tripData.photoData) {
      try {
        const base64Data = tripData.photoData.replace(/^data:image\/\w+;base64,/, '');
        const photoBuffer = Buffer.from(base64Data, 'base64');
        doc.save();
        doc.rect(0, photoY, W, photoH).clip();
        doc.image(photoBuffer, 0, photoY, { cover: [W, photoH], align: 'center', valign: 'center' });
        doc.restore();
      } catch(e) {
        doc.rect(0, photoY, W, photoH).fill('#111');
      }
    } else {
      doc.rect(0, photoY, W, photoH).fill('#111');
      doc.fillColor(MID).font(reg).fontSize(11)
         .text('No group photo', 0, photoY + photoH/2 - 8, { align: 'center', width: W, lineBreak: false });
    }

    // Trip info block below photo
    let y1 = photoY + photoH + 24;

    // Date + Duration side by side
    doc.fillColor(BLACK).font(bold).fontSize(22)
       .text(date.toUpperCase(), M, y1, { lineBreak: false });
    y1 += 28;

    // Divider line
    doc.rect(M, y1, CW, 1.5).fill(BLACK);
    y1 += 12;

    // Stats row
    const statItems = [
      { label: 'DURATION', value: duration },
      { label: 'PASSENGERS', value: String(tripData.passengers) },
      { label: 'SIGHTINGS', value: String(tripData.sightings.length) },
      { label: 'WATER TEMP', value: tripData.waterTemp ? `${tripData.waterTemp}°F` : 'N/A' },
    ];

    const statW = CW / 4;
    statItems.forEach((stat, i) => {
      const x = M + i * statW;
      doc.fillColor(MID).font(reg).fontSize(7)
         .text(stat.label, x, y1, { width: statW - 4, lineBreak: false });
      doc.fillColor(BLACK).font(bold).fontSize(16)
         .text(stat.value, x, y1 + 10, { width: statW - 4, lineBreak: false });
    });
    y1 += 44;

    // Conditions
    if (tripData.visibility || tripData.conditions) {
      doc.rect(M, y1, CW, 1).fill('#ddd');
      y1 += 10;
      const condParts = [];
      if (tripData.visibility) condParts.push(`Visibility: ${tripData.visibility}`);
      if (tripData.conditions) condParts.push(`Sea: ${tripData.conditions}`);
      doc.fillColor(MID).font(reg).fontSize(9)
         .text(condParts.join('   •   '), M, y1, { width: CW, lineBreak: false });
      y1 += 20;
    }

    // Footer
    doc.rect(0, H - 44, W, 44).fill(BLACK);
    doc.fillColor(WHITE).font(bold).fontSize(8)
       .text('ENOCEAN TOURS  •  MOSS LANDING HARBOR, MONTEREY BAY, CA  •  ENOCEANTOURS.COM', M, H - 27, { align: 'center', width: CW, lineBreak: false });

    // ═══════════════════════════════════════════════════════════
    // PAGE 2 — Map + Sightings Log
    // ═══════════════════════════════════════════════════════════
    doc.addPage({ size: 'LETTER', margin: 0 });

    // Header
    doc.rect(0, 0, W, 52).fill(BLACK);
    doc.fillColor(WHITE).font(bold).fontSize(11)
       .text('SIGHTING LOG  —  ENOCEAN TOURS', M, 18, { align: 'center', width: CW, lineBreak: false });

    let y2 = 68;

    // Section label
    doc.fillColor(BLACK).font(bold).fontSize(13)
       .text('SIGHTING LOCATIONS', M, y2, { lineBreak: false });
    y2 += 16;

    // Map — full width high res
    if (mapImageBuffer) {
      const mapH = 230;
      try {
        doc.image(mapImageBuffer, M, y2, { width: CW, height: mapH });
        // Legend strip
        const withCoords = tripData.sightings.filter(s => s.lat && s.lng);
        y2 += mapH;
        if (withCoords.length > 0) {
          doc.rect(M, y2, CW, 22).fill(GRAY);
          const legend = withCoords.map((s, i) => `${i + 1}  ${s.species.toUpperCase()}`).join('     ');
          doc.fillColor(BLACK).font(semib).fontSize(7)
             .text(legend, M + 8, y2 + 7, { width: CW - 16, lineBreak: false });
          y2 += 30;
        } else {
          y2 += 12;
        }
      } catch(e) {
        console.error('Map error:', e.message);
        y2 += 12;
      }
    }

    y2 += 8;

    // Section label
    doc.fillColor(BLACK).font(bold).fontSize(13)
       .text('SIGHTINGS LOG', M, y2, { lineBreak: false });
    y2 += 14;

    // Table
    const cols = [175, 50, 55, CW - 280];
    const headers = ['SPECIES', 'COUNT', 'TIME', 'NOTES'];
    const rowH = 26;

    // Header row — black
    doc.rect(M, y2, CW, rowH).fill(BLACK);
    let cx = M;
    headers.forEach((h, i) => {
      doc.fillColor(WHITE).font(semib).fontSize(8)
         .text(h, cx + 8, y2 + 9, { width: cols[i] - 10, lineBreak: false });
      cx += cols[i];
    });
    y2 += rowH;

    // Data rows
    if (tripData.sightings.length === 0) {
      doc.rect(M, y2, CW, rowH).fill(GRAY);
      doc.fillColor(MID).font(reg).fontSize(9)
         .text('No sightings logged', M + 8, y2 + 8, { lineBreak: false });
    } else {
      tripData.sightings.forEach((s, i) => {
        const bg = i % 2 === 0 ? WHITE : GRAY;
        doc.rect(M, y2, CW, rowH).fill(bg);
        // Left border accent
        doc.rect(M, y2, 3, rowH).fill(BLACK);
        const cells = [s.species, String(s.count), s.time, s.notes || ''];
        cx = M;
        cells.forEach((cell, j) => {
          doc.fillColor(BLACK)
             .font(j === 0 ? semib : reg)
             .fontSize(j === 0 ? 10 : 9)
             .text(j === 0 ? cell.toUpperCase() : cell, cx + 8, y2 + 8, { width: cols[j] - 12, lineBreak: false });
          cx += cols[j];
        });
        // Bottom border
        doc.rect(M, y2 + rowH - 1, CW, 1).fill('#e5e5e5');
        y2 += rowH;
      });
    }

    // Footer
    doc.rect(0, H - 44, W, 44).fill(BLACK);
    doc.fillColor(WHITE).font(bold).fontSize(8)
       .text('BOOK YOUR NEXT ADVENTURE  •  ENOCEANTOURS.COM', M, H - 27, { align: 'center', width: CW, lineBreak: false });

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
