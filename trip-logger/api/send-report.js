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
  const antonFont = null; // Using Helvetica-Bold

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

    const BLACK = '#000000';
    const WHITE = '#ffffff';
    const GRAY  = '#f2f2f2';
    const MID   = '#888888';
    const RULE  = '#cccccc';

    const W  = 612;
    const H  = 792;
    const M  = 48;
    const CW = W - M * 2;

    const bold  = 'Helvetica-Bold';
    const reg   = 'Helvetica';

    const date     = new Date(tripData.startTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const duration = getFormattedDuration(tripData.startTime, tripData.endTime);

    // ── Shared: thin rule helper ──
    function rule(y, x, w, color) {
      doc.rect(x || M, y, w || CW, 1).fill(color || BLACK);
    }

    // ═══════════════════════════════════════════════════════
    // PAGE 1
    // ═══════════════════════════════════════════════════════
    doc.addPage({ size: 'LETTER', margin: 0 });

    // Header
    doc.rect(0, 0, W, 130).fill(BLACK);

    // Logo circle
    doc.circle(W / 2, 64, 34).fill(WHITE);
    doc.fillColor(BLACK).font(bold).fontSize(8).text('ENOCEAN', W/2 - 22, 57, { lineBreak: false });
    doc.fillColor(BLACK).font(bold).fontSize(6).text('TOURS', W/2 - 12, 68, { lineBreak: false });

    doc.fillColor(WHITE).font(bold).fontSize(9)
       .text('TRIP REPORT', M, 110, { align: 'center', width: CW, lineBreak: false, characterSpacing: 3 });

    // Hero photo
    const photoY = 130;
    const photoH = tripData.photoData ? 300 : 160;

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

    // Left accent rule — carries black down from header into body
    doc.rect(M - 12, photoY + photoH, 3, H - (photoY + photoH) - 44).fill(BLACK);

    let y1 = photoY + photoH + 28; // extra padding above date

    // Date
    doc.fillColor(BLACK).font(bold).fontSize(20)
       .text(date.toUpperCase(), M, y1, { lineBreak: false, characterSpacing: 1 });
    y1 += 30;

    // Primary divider
    rule(y1);
    y1 += 16; // padding below divider

    // Stats row — 4 columns
    const statItems = [
      { label: 'DURATION',   value: duration },
      { label: 'PASSENGERS', value: String(tripData.passengers) },
      { label: 'SIGHTINGS',  value: String(tripData.sightings.length) },
      { label: 'WATER TEMP', value: tripData.waterTemp ? tripData.waterTemp + '°F' : 'N/A' },
    ];

    const statW = CW / 4;
    statItems.forEach((stat, i) => {
      const x = M + i * statW;
      doc.fillColor(MID).font(reg).fontSize(7)
         .text(stat.label, x, y1, { width: statW - 4, lineBreak: false, characterSpacing: 1.5 });
      doc.fillColor(BLACK).font(bold).fontSize(18)
         .text(stat.value, x, y1 + 12, { width: statW - 4, lineBreak: false });
    });
    y1 += 52; // generous padding below stats

    // Secondary divider
    rule(y1);
    y1 += 12;

    // Conditions — visually tied to stats via proximity + subtle separator above
    if (tripData.visibility || tripData.conditions) {
      const parts = [];
      if (tripData.visibility) parts.push('Visibility: ' + tripData.visibility);
      if (tripData.conditions)  parts.push('Sea: ' + tripData.conditions);
      doc.fillColor(MID).font(reg).fontSize(9)
         .text(parts.join('   •   '), M, y1, { width: CW, lineBreak: false, characterSpacing: 0.5 });
      y1 += 22;
    }

    // Tertiary thin rule
    rule(y1, M, CW, RULE);

    // Footer
    doc.rect(0, H - 44, W, 44).fill(BLACK);
    doc.fillColor(WHITE).font(bold).fontSize(7)
       .text('ENOCEAN TOURS  •  MOSS LANDING HARBOR, MONTEREY BAY  •  ENOCEANTOURS.COM', M, H - 26, { align: 'center', width: CW, lineBreak: false, characterSpacing: 1 });

    // ═══════════════════════════════════════════════════════
    // PAGE 2
    // ═══════════════════════════════════════════════════════
    doc.addPage({ size: 'LETTER', margin: 0 });

    // Header
    doc.rect(0, 0, W, 52).fill(BLACK);
    doc.fillColor(WHITE).font(bold).fontSize(10)
       .text('SIGHTING LOG  —  ENOCEAN TOURS', M, 18, { align: 'center', width: CW, lineBreak: false, characterSpacing: 2 });

    // Left accent rule — carries into page 2 body
    doc.rect(M - 12, 52, 3, H - 52 - 44).fill(BLACK);

    let y2 = 66;

    // Map section
    if (mapImageBuffer) {
      // Section heading + thin rule
      doc.fillColor(BLACK).font(bold).fontSize(11)
         .text('SIGHTING LOCATIONS', M, y2, { lineBreak: false, characterSpacing: 1.5 });
      y2 += 16;
      rule(y2);
      y2 += 10;

      const mapH = 200; // slightly reduced to avoid top-heavy feel
      try {
        doc.image(mapImageBuffer, M, y2, { width: CW, height: mapH });
        const withCoords = tripData.sightings.filter(s => s.lat && s.lng);
        y2 += mapH + 4;
        if (withCoords.length > 0) {
          doc.rect(M, y2, CW, 22).fill(GRAY);
          const legend = withCoords.map((s, i) => (i + 1) + '  ' + s.species.toUpperCase()).join('     ');
          doc.fillColor(BLACK).font(bold).fontSize(7)
             .text(legend, M + 8, y2 + 7, { width: CW - 16, lineBreak: false, characterSpacing: 0.8 });
          y2 += 28;
        }
      } catch(e) {
        console.error('Map error:', e.message);
      }
      y2 += 16;
    }

    // Sightings section heading + thin rule
    doc.fillColor(BLACK).font(bold).fontSize(11)
       .text('SIGHTINGS LOG', M, y2, { lineBreak: false, characterSpacing: 1.5 });
    y2 += 16;
    rule(y2);
    y2 += 10;

    // Table
    const cols   = [175, 50, 55, CW - 280];
    const headers = ['SPECIES', 'COUNT', 'TIME', 'NOTES'];
    const rowH    = 26;

    // Header row — solid black
    doc.rect(M, y2, CW, rowH).fill(BLACK);
    let cx = M;
    headers.forEach((h, i) => {
      doc.fillColor(WHITE).font(bold).fontSize(8)
         .text(h, cx + 8, y2 + 9, { width: cols[i] - 10, lineBreak: false, characterSpacing: 1 });
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
        doc.rect(M, y2, 3, rowH).fill(BLACK); // left accent per row
        const cells = [s.species, String(s.count), s.time, s.notes || ''];
        cx = M;
        cells.forEach((cell, j) => {
          doc.fillColor(BLACK)
             .font(j === 0 ? bold : reg)
             .fontSize(j === 0 ? 10 : 9)
             .text(j === 0 ? cell.toUpperCase() : cell, cx + 8, y2 + 8, { width: cols[j] - 12, lineBreak: false });
          cx += cols[j];
        });
        doc.rect(M, y2 + rowH - 1, CW, 1).fill(RULE); // subtle row divider
        y2 += rowH;
      });
    }

    // Bottom rule after table
    rule(y2 + 8, M, CW, RULE);

    // Footer
    doc.rect(0, H - 44, W, 44).fill(BLACK);
    doc.fillColor(WHITE).font(bold).fontSize(7)
       .text('BOOK YOUR NEXT ADVENTURE  •  ENOCEANTOURS.COM', M, H - 26, { align: 'center', width: CW, lineBreak: false, characterSpacing: 1 });

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
