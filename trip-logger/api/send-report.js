const mailchimp = require('@mailchimp/mailchimp_marketing');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const sharp = require('sharp');
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
    const withCoords = sightings.filter(s => s.lat && s.lng);

    // Always fixed Monterey Bay view — full bay + submarine canyon visible
    // Center: 36.78, -122.05 | Zoom 10 shows full bay from SC to Monterey
    const CENTER = '36.78,-122.05';
    const ZOOM   = '10';

    if (withCoords.length === 0) {
      const url = `https://maps.googleapis.com/maps/api/staticmap?center=${CENTER}&zoom=${ZOOM}&size=640x400&scale=2&maptype=hybrid&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      fetchURL(url).then(resolve).catch(() => resolve(null));
      return;
    }

    // Pin sightings on the fixed bay view
    const markers = withCoords.map((s, i) =>
      `markers=color:white|label:${i + 1}|${s.lat},${s.lng}`
    ).join('&');

    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${CENTER}&zoom=${ZOOM}&size=640x400&scale=2&maptype=hybrid&${markers}&key=${process.env.GOOGLE_MAPS_API_KEY}`;

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

  // Fetch logo outside Promise so await works
  let logoBuffer = null;
  try {
    logoBuffer = await fetchURL('https://trip-logger-backend.vercel.app/public/Enocean_Tours_logo-05.png');
  } catch(e) {
    console.log('Logo fetch failed:', e.message);
  }

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

    // Logo — centered in white circle
    const logoRadius = 24;
    const logoCX = M + logoRadius;
    const logoCY = headerH / 2;
    doc.circle(logoCX, logoCY, logoRadius).fill(WHITE);
    if (logoBuffer) {
      try {
        const logoSize = logoRadius * 2 - 4;
        doc.image(logoBuffer, logoCX - logoSize/2, logoCY - logoSize/2, { width: logoSize, height: logoSize });
      } catch(e) {
        console.log('Logo image error:', e.message);
        doc.fillColor(BLACK).font(bold).fontSize(6).text('ENOCEAN', logoCX - 18, logoCY - 6, { lineBreak: false });
        doc.fillColor(BLACK).font(bold).fontSize(5).text('TOURS', logoCX - 12, logoCY + 2, { lineBreak: false });
      }
    } else {
      doc.fillColor(BLACK).font(bold).fontSize(6).text('ENOCEAN', logoCX - 18, logoCY - 6, { lineBreak: false });
      doc.fillColor(BLACK).font(bold).fontSize(5).text('TOURS', logoCX - 12, logoCY + 2, { lineBreak: false });
    }

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

    const distanceNM = tripData.distanceNM ? tripData.distanceNM.toFixed(2) + ' NM' : 'N/A';
    const statItems = [
      { label: 'DURATION',   value: duration },
      { label: 'DISTANCE',   value: distanceNM },
      { label: 'PASSENGERS', value: String(tripData.passengers) },
      { label: 'SIGHTINGS',  value: String(tripData.sightings.length) },
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







// ─── Social Card Generator (1080x1920 Story JPG) ─────────────────────────────

async function generateSocialCard(tripData) {
  const W = 1080;
  const H = 1920;

  const speciesList = [...new Set(tripData.sightings.map(s => s.species))];
  const date = new Date(tripData.startTime).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  }).toUpperCase();

  try {
    // Build base image
    let base;
    if (tripData.photoData) {
      const b64 = tripData.photoData.replace(/^data:image\/\w+;base64,/, '');
      const photoBuf = Buffer.from(b64, 'base64');
      base = await sharp(photoBuf)
        .resize(W, H, { fit: 'cover', position: 'center' })
        .toBuffer();
    } else {
      base = await sharp({
        create: { width: W, height: H, channels: 3, background: { r: 10, g: 20, b: 40 } }
      }).png().toBuffer();
    }

    // Layer 1: gradient overlay
    const gradient = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#000" stop-opacity="0.3"/>
          <stop offset="40%" stop-color="#000" stop-opacity="0.05"/>
          <stop offset="65%" stop-color="#000" stop-opacity="0.6"/>
          <stop offset="100%" stop-color="#000" stop-opacity="0.95"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
    </svg>`;

    // Layer 2: top bar
    const topBar = `<svg width="${W}" height="160" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="160" fill="black" fill-opacity="0.6"/>
    </svg>`;

    // Layer 3: bottom bar
    const bottomBar = `<svg width="${W}" height="110" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="110" fill="black" fill-opacity="0.6"/>
    </svg>`;

    // Layer 4: "TODAY WE SAW" label box
    const labelBox = `<svg width="400" height="50" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="50" fill="white" fill-opacity="0.15" rx="4"/>
    </svg>`;

    // Layer 5: species colored blocks
    const speciesBlocks = speciesList.map((_, i) => {
      const blockH = 90;
      return `<svg width="${W - 160}" height="${blockH}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${W - 160}" height="${blockH}" fill="white" fill-opacity="${i % 2 === 0 ? '0.08' : '0'}"/>
        <rect width="6" height="${blockH}" fill="white" fill-opacity="0.6"/>
      </svg>`;
    });

    // Composite everything
    const composites = [
      { input: Buffer.from(gradient), top: 0, left: 0 },
      { input: Buffer.from(topBar), top: 0, left: 0 },
      { input: Buffer.from(bottomBar), top: H - 110, left: 0 },
      { input: Buffer.from(labelBox), top: 860, left: 80 },
      ...speciesList.map((_, i) => ({
        input: Buffer.from(speciesBlocks[i]),
        top: 940 + (i * 100),
        left: 80,
      })),
    ];

    const withOverlays = await sharp(base)
      .composite(composites)
      .toBuffer();

    // Now add text as a single SVG on top of everything
    // Use monospace/generic fonts that ARE available in Node environment
    const speciesTextLines = speciesList.map((species, i) =>
      `<text x="100" y="${975 + (i * 100)}" font-family="Arial, sans-serif" font-weight="bold" font-size="62" fill="white">${species.toUpperCase()}</text>`
    ).join('');

    const textSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <!-- Top branding -->
      <text x="${W/2}" y="92" font-family="Arial, sans-serif" font-weight="bold" font-size="44" fill="white" text-anchor="middle">ENOCEAN TOURS</text>
      <text x="${W/2}" y="136" font-family="Arial, sans-serif" font-size="24" fill="white" text-anchor="middle" opacity="0.75">MONTEREY BAY, CALIFORNIA</text>

      <!-- TODAY WE SAW -->
      <text x="100" y="895" font-family="Arial, sans-serif" font-size="28" fill="white" opacity="0.8">TODAY WE SAW</text>

      <!-- Species -->
      ${speciesTextLines}

      <!-- Date -->
      <text x="80" y="${940 + (speciesList.length * 100) + 70}" font-family="Arial, sans-serif" font-size="34" fill="white" opacity="0.65">${date}</text>

      <!-- Bottom -->
      <text x="${W/2}" y="${H - 38}" font-family="Arial, sans-serif" font-weight="bold" font-size="30" fill="white" text-anchor="middle">ENOCEANTOURS.COM</text>
    </svg>`;

    const result = await sharp(withOverlays)
      .composite([{ input: Buffer.from(textSvg), top: 0, left: 0 }])
      .jpeg({ quality: 92 })
      .toBuffer();

    return result;

  } catch(e) {
    console.error('Social card error:', e.message);
    return null;
  }
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
  }
}

// ─── Send Email ───────────────────────────────────────────────────────────────

async function sendEmail(guestEmail, pdfBuffer, socialCardBuffer, tripData) {
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
    attachments: [
      {
        filename: `Enocean_Trip_${new Date(tripData.startTime).toISOString().split('T')[0]}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
      ...(socialCardBuffer ? [{
        filename: `Enocean_Story_${new Date(tripData.startTime).toISOString().split('T')[0]}.jpg`,
        content: socialCardBuffer,
        contentType: 'image/jpeg',
      }] : []),
    ],
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

    console.log('Generating social card...');
    const socialCardBuffer = await generateSocialCard(tripData);
    console.log('Social card done:', socialCardBuffer ? socialCardBuffer.length : 'failed');

    await addToMailchimp(guestEmail);
    await sendEmail(guestEmail, pdfBuffer, socialCardBuffer, tripData);

    return res.status(200).json({ success: true, message: `Trip report sent to ${guestEmail}` });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: 'Failed to send trip report', detail: err.message });
  }
};
