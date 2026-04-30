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
    const GRAY  = '#f0f0f0';
    const MID   = '#777777';
    const RULE  = '#cccccc';

    const W  = 612;
    const H  = 792;
    const M  = 40;
    const CW = W - M * 2;
    const bold = 'Helvetica-Bold';
    const reg  = 'Helvetica';

    const date     = new Date(tripData.startTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const duration = getFormattedDuration(tripData.startTime, tripData.endTime);

    doc.addPage({ size: 'LETTER', margin: 0 });

    // ── HEADER ──
    const headerH = 72;
    doc.rect(0, 0, W, headerH).fill(BLACK);

    doc.circle(M + 24, headerH / 2, 22).fill(WHITE);
    doc.fillColor(BLACK).font(bold).fontSize(6).text('ENOCEAN', M + 6, headerH/2 - 6, { lineBreak: false });
    doc.fillColor(BLACK).font(bold).fontSize(5).text('TOURS', M + 10, headerH/2 + 2, { lineBreak: false });

    doc.fillColor(WHITE).font(bold).fontSize(18)
       .text('TRIP REPORT', 0, headerH/2 - 10, { align: 'center', width: W, lineBreak: false, characterSpacing: 3 });

    doc.fillColor(WHITE).font(reg).fontSize(8)
       .text(date.toUpperCase(), M, headerH/2 + 10, { align: 'right', width: CW, lineBreak: false, characterSpacing: 0.5 });

    let y = headerH;

    // ── PHOTO (left) + STATS (right) ──
    const photoW = Math.round(W * 0.58);
    const photoH = 200;

    if (tripData.photoData) {
      try {
        const b64 = tripData.photoData.replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(b64, 'base64');
        doc.save();
        doc.rect(0, y, photoW, photoH).clip();
        doc.image(buf, 0, y, { cover: [photoW, photoH], align: 'center', valign: 'center' });
        doc.restore();
      } catch(e) {
        doc.rect(0, y, photoW, photoH).fill('#111');
      }
    } else {
      doc.rect(0, y, photoW, photoH).fill('#111');
      doc.fillColor(MID).font(reg).fontSize(9)
         .text('No photo', 0, y + photoH/2 - 6, { align: 'center', width: photoW, lineBreak: false });
    }

    // Stats panel right
    const statsX = photoW + 1;
    const statsW = W - photoW - 1;
    doc.rect(statsX, y, statsW, photoH).fill(GRAY);

    const statItems = [
      { label: 'DURATION',   value: duration },
      { label: 'PASSENGERS', value: String(tripData.passengers) },
      { label: 'SIGHTINGS',  value: String(tripData.sightings.length) },
      { label: 'WATER TEMP', value: tripData.waterTemp ? tripData.waterTemp + '°F' : 'N/A' },
    ];

    const statBlockH = photoH / statItems.length;
    statItems.forEach((stat, i) => {
      const sy = y + i * statBlockH;
      if (i > 0) doc.rect(statsX + 12, sy, statsW - 24, 0.5).fill(RULE);
      doc.fillColor(MID).font(reg).fontSize(7)
         .text(stat.label, statsX + 16, sy + 10, { width: statsW - 24, lineBreak: false, characterSpacing: 1 });
      doc.fillColor(BLACK).font(bold).fontSize(20)
         .text(stat.value, statsX + 16, sy + 22, { width: statsW - 24, lineBreak: false });
    });

    y += photoH;

    // ── CONDITIONS STRIP ──
    doc.rect(0, y, W, 26).fill(BLACK);
    const condParts = [];
    if (tripData.visibility) condParts.push('Visibility: ' + tripData.visibility);
    if (tripData.conditions)  condParts.push('Sea: ' + tripData.conditions);
    if (tripData.waterTemp)   condParts.push('Water: ' + tripData.waterTemp + '°F');
    doc.fillColor(WHITE).font(reg).fontSize(8)
       .text(condParts.join('   •   ') || 'Monterey Bay', 0, y + 8, { align: 'center', width: W, lineBreak: false, characterSpacing: 0.8 });
    y += 26;

    // ── MAP — full width horizontal ──
    const mapH = 180;
    if (mapImageBuffer) {
      try {
        doc.image(mapImageBuffer, 0, y, { width: W, height: mapH });
      } catch(e) {
        doc.rect(0, y, W, mapH).fill('#ddd');
        console.error('Map error:', e.message);
      }
    } else {
      doc.rect(0, y, W, mapH).fill('#e5e5e5');
      doc.fillColor(MID).font(reg).fontSize(9)
         .text('Map unavailable', 0, y + mapH/2, { align: 'center', width: W, lineBreak: false });
    }
    y += mapH;

    // ── SIGHTINGS LIST — full width below map ──
    // Thin rule + heading
    y += 12;
    doc.fillColor(BLACK).font(bold).fontSize(9)
       .text('SIGHTINGS LOG', M, y, { lineBreak: false, characterSpacing: 1.5 });
    y += 13;
    doc.rect(M, y, CW, 1).fill(BLACK);
    y += 8;

    // Column headers
    const cols = [200, 60, 60, CW - 320];
    const headers = ['SPECIES', 'COUNT', 'TIME', 'NOTES & LOCATION'];
    let cx = M;
    headers.forEach((h, i) => {
      doc.fillColor(MID).font(bold).fontSize(7)
         .text(h, cx, y, { width: cols[i], lineBreak: false, characterSpacing: 0.8 });
      cx += cols[i];
    });
    y += 14;
    doc.rect(M, y, CW, 0.5).fill(RULE);
    y += 6;

    // Sighting rows
    if (tripData.sightings.length === 0) {
      doc.fillColor(MID).font(reg).fontSize(9).text('No sightings logged', M, y, { lineBreak: false });
    } else {
      tripData.sightings.forEach((s, i) => {
        const bg = i % 2 === 0 ? WHITE : GRAY;
        const rowH = 28;
        doc.rect(M - 4, y - 4, CW + 8, rowH).fill(bg);
        doc.rect(M - 4, y - 4, 3, rowH).fill(BLACK);

        // Species
        doc.fillColor(BLACK).font(bold).fontSize(9)
           .text(s.species.toUpperCase(), M, y, { width: cols[0] - 8, lineBreak: false });

        // Count
        doc.fillColor(BLACK).font(reg).fontSize(9)
           .text('×' + s.count, M + cols[0], y, { width: cols[1], lineBreak: false });

        // Time
        doc.fillColor(BLACK).font(reg).fontSize(9)
           .text(s.time, M + cols[0] + cols[1], y, { width: cols[2], lineBreak: false });

        // Notes + coords inline
        const notesX = M + cols[0] + cols[1] + cols[2];
        let noteText = s.notes || '';
        if (s.lat && s.lng) {
          const coords = s.lat.toFixed(4) + ', ' + s.lng.toFixed(4);
          noteText = noteText ? noteText + '  •  ' + coords : coords;
        }
        doc.fillColor(MID).font(reg).fontSize(8)
           .text(noteText, notesX, y, { width: cols[3], lineBreak: false });

        y += rowH;
        doc.rect(M, y - 4, CW, 0.5).fill(RULE);
      });
    }

    // ── FOOTER ──
    doc.rect(0, H - 44, W, 44).fill(BLACK);
    doc.fillColor(WHITE).font(bold).fontSize(7)
       .text('ENOCEAN TOURS  •  MOSS LANDING HARBOR, MONTEREY BAY  •  ENOCEANTOURS.COM', M, H - 26, { align: 'center', width: CW, lineBreak: false, characterSpacing: 1 });

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
