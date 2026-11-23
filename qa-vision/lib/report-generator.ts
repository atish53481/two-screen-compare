import 'server-only';
import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts, rgb, PDFImage, PDFPage, RGB } from 'pdf-lib';

export type ReportLog = {
  id?: string;
  timestamp: string;
  action: string;
  devResult: string;
  prodResult: string;
  status: 'match' | 'mismatch' | string;
};

export type ReportMismatch = {
  id?: string;
  timestamp: string;
  page?: string;
  component: string;
  type: string;
  devValue: string;
  prodValue: string;
  severity: string;
  description?: string;
  aiAnalysis?: string;
  devScreenshotPath?: string;
  prodScreenshotPath?: string;
  diffScreenshotPath?: string;
  diffPercent?: number;
  classification?: string;
  occurrences?: number;
  stepIds?: string[];
};

export type ReportInput = {
  reportId: string;
  projectName: string;
  devUrl: string;
  prodUrl: string;
  generatedAt: string;
  sessionId?: string | null;
  logs: ReportLog[];
  mismatches: ReportMismatch[];
};

/** Helvetica/WinAnsi cannot draw emoji or many Unicode glyphs — sanitize for PDF text. */
function pdfSafe(text: string): string {
  const input = String(text ?? '');
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // Skip surrogate pairs (emoji) entirely
    if (code >= 0xd800 && code <= 0xdfff) {
      // skip low surrogate if present
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) i++;
      continue;
    }
    // Allow tab/newline already normalized away; keep printable ASCII + Latin-1
    if (code === 0x20 || (code >= 0x21 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      out += input[i];
    } else if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += ' ';
    }
    // else drop (emoji, symbols, CJK, etc.)
  }
  return out.replace(/\s+/g, ' ').trim();
}

function drawSafeText(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: any; color: RGB; maxWidthChars?: number }
) {
  const safe = pdfSafe(text);
  if (!safe) return;
  page.drawText(safe, {
    x: opts.x,
    y: opts.y,
    size: opts.size,
    font: opts.font,
    color: opts.color,
  });
}

function wrapText(text: string, maxChars: number): string[] {
  const raw = pdfSafe(text);
  if (!raw) return [''];
  const words = raw.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      if (current) lines.push(current);
      // hard-split very long tokens
      if (word.length > maxChars) {
        for (let i = 0; i < word.length; i += maxChars) {
          lines.push(word.slice(i, i + maxChars));
        }
        current = '';
      } else {
        current = word;
      }
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function severityColor(severity: string): RGB {
  switch ((severity || '').toLowerCase()) {
    case 'critical':
      return rgb(0.75, 0.1, 0.1);
    case 'high':
      return rgb(0.85, 0.35, 0.1);
    case 'medium':
      return rgb(0.8, 0.55, 0.05);
    default:
      return rgb(0.2, 0.45, 0.75);
  }
}

async function tryEmbedPng(
  pdfDoc: PDFDocument,
  filePath?: string,
  maxWidth = 1600
): Promise<PDFImage | null> {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    let bytes: Buffer = fs.readFileSync(filePath);
    // Re-encode via sharp for clearer, reasonably sized PNG in the PDF
    try {
      const sharp = (await import('sharp')).default;
      bytes = await sharp(bytes)
        .resize({ width: maxWidth, withoutEnlargement: true })
        .png({ compressionLevel: 6 })
        .toBuffer();
    } catch {
      /* use original bytes */
    }
    return await pdfDoc.embedPng(bytes);
  } catch {
    return null;
  }
}

function drawExactTextBox(
  page: PDFPage,
  opts: {
    x: number;
    y: number;
    width: number;
    title: string;
    titleColor: RGB;
    body: string;
    font: any;
    fontBold: any;
  }
): number {
  const { x, y, width, title, titleColor, body, font, fontBold } = opts;
  const lines = wrapText(body || '(empty)', Math.floor((width - 24) / 6));
  const boxH = 28 + lines.length * 13 + 12;

  page.drawRectangle({
    x,
    y: y - boxH,
    width,
    height: boxH,
    color: rgb(0.97, 0.97, 0.98),
    borderColor: titleColor,
    borderWidth: 1.5,
  });
  page.drawRectangle({
    x,
    y: y - 22,
    width,
    height: 22,
    color: titleColor,
  });
  page.drawText(title, {
    x: x + 10,
    y: y - 15,
    size: 10,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  let ty = y - 38;
  for (const line of lines.slice(0, 12)) {
    page.drawText(line, {
      x: x + 10,
      y: ty,
      size: 11,
      font,
      color: rgb(0.08, 0.08, 0.08),
    });
    ty -= 13;
  }
  return boxH;
}

function drawFooter(page: PDFPage, reportId: string, pageIndex: number, total: number, font: any) {
  const { width } = page.getSize();
  page.drawText(`QA Vision AI  |  ${reportId}  |  Page ${pageIndex + 1} of ${total}`, {
    x: 40,
    y: 24,
    size: 8,
    font,
    color: rgb(0.45, 0.45, 0.45),
  });
  page.drawLine({
    start: { x: 40, y: 36 },
    end: { x: width - 40, y: 36 },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });
}

export async function generateComparisonPdf(rawInput: ReportInput): Promise<Uint8Array> {
  // Sanitize all user/DOM-derived strings up front (PDF Helvetica = WinAnsi only)
  const input: ReportInput = {
    ...rawInput,
    reportId: pdfSafe(rawInput.reportId) || `report-${Date.now()}`,
    projectName: pdfSafe(rawInput.projectName) || 'Comparison Session',
    devUrl: pdfSafe(rawInput.devUrl),
    prodUrl: pdfSafe(rawInput.prodUrl),
    generatedAt: rawInput.generatedAt,
    sessionId: rawInput.sessionId ? pdfSafe(String(rawInput.sessionId)) : rawInput.sessionId,
    logs: (rawInput.logs || []).map((l) => ({
      ...l,
      action: pdfSafe(l.action),
      devResult: pdfSafe(l.devResult),
      prodResult: pdfSafe(l.prodResult),
      status: pdfSafe(l.status) || 'match',
    })),
    mismatches: (rawInput.mismatches || []).map((m) => ({
      ...m,
      page: pdfSafe(m.page || ''),
      component: pdfSafe(m.component),
      type: pdfSafe(m.type) || 'Difference',
      devValue: pdfSafe(m.devValue),
      prodValue: pdfSafe(m.prodValue),
      severity: pdfSafe(m.severity) || 'medium',
      description: pdfSafe(m.description || ''),
      aiAnalysis: pdfSafe(m.aiAnalysis || ''),
    })),
  };

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const matchCount = input.logs.filter((l) => l.status === 'match').length;
  const mismatchLogCount = input.logs.filter((l) => l.status === 'mismatch').length;
  const visualCount = input.mismatches.filter((m) => (m.type || '').toLowerCase() === 'visual').length;
  const interactionCount = input.mismatches.filter((m) => (m.type || '').toLowerCase() !== 'visual').length;

  // ---------- Cover / summary page ----------
  let page = pdfDoc.addPage([612, 792]); // Letter
  let y = 740;

  page.drawRectangle({
    x: 0,
    y: 720,
    width: 612,
    height: 72,
    color: rgb(0.05, 0.08, 0.14),
  });
  page.drawText('QA VISION AI', {
    x: 40,
    y: 752,
    size: 22,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText('DEV vs PRODUCTION Comparison Report', {
    x: 40,
    y: 732,
    size: 11,
    font,
    color: rgb(0.7, 0.8, 0.95),
  });

  y = 680;
  page.drawText(input.projectName || 'Comparison Session', {
    x: 40,
    y,
    size: 16,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 22;
  page.drawText(`Generated: ${new Date(input.generatedAt).toLocaleString()}`, {
    x: 40,
    y,
    size: 10,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });
  y -= 16;
  page.drawText(`Report ID: ${input.reportId}`, {
    x: 40,
    y,
    size: 10,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });
  if (input.sessionId) {
    y -= 16;
    page.drawText(`Session: ${input.sessionId}`, {
      x: 40,
      y,
      size: 10,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
  }

  y -= 36;
  page.drawText('Environments', {
    x: 40,
    y,
    size: 13,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 20;
  page.drawText(`DEV (primary):  ${input.devUrl}`, {
    x: 40,
    y,
    size: 10,
    font,
    color: rgb(0.05, 0.45, 0.3),
  });
  y -= 16;
  page.drawText(`PROD (mirror):  ${input.prodUrl}`, {
    x: 40,
    y,
    size: 10,
    font,
    color: rgb(0.65, 0.15, 0.2),
  });

  y -= 36;
  page.drawText('Executive Summary', {
    x: 40,
    y,
    size: 13,
    font: fontBold,
  });
  y -= 8;

  const cards: Array<{ label: string; value: string; color: RGB }> = [
    { label: 'Actions logged', value: String(input.logs.length), color: rgb(0.15, 0.15, 0.15) },
    { label: 'Matched steps', value: String(matchCount), color: rgb(0.05, 0.45, 0.25) },
    { label: 'Failed steps', value: String(mismatchLogCount), color: rgb(0.7, 0.15, 0.15) },
    { label: 'Differences found', value: String(input.mismatches.length), color: rgb(0.75, 0.35, 0.05) },
    { label: 'Visual diffs', value: String(visualCount), color: rgb(0.55, 0.25, 0.55) },
    { label: 'Interaction diffs', value: String(interactionCount), color: rgb(0.2, 0.35, 0.65) },
  ];

  let cardX = 40;
  const cardW = 165;
  const cardH = 58;
  for (let i = 0; i < cards.length; i++) {
    if (i > 0 && i % 3 === 0) {
      cardX = 40;
      y -= cardH + 12;
    }
    const c = cards[i];
    page.drawRectangle({
      x: cardX,
      y: y - cardH,
      width: cardW,
      height: cardH,
      color: rgb(0.96, 0.97, 0.98),
      borderColor: rgb(0.85, 0.87, 0.9),
      borderWidth: 1,
    });
    page.drawText(c.label.toUpperCase(), {
      x: cardX + 12,
      y: y - 20,
      size: 8,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
    page.drawText(c.value, {
      x: cardX + 12,
      y: y - 44,
      size: 20,
      font: fontBold,
      color: c.color,
    });
    cardX += cardW + 12;
  }
  y -= cardH + 28;

  page.drawText('Severity breakdown', {
    x: 40,
    y,
    size: 12,
    font: fontBold,
  });
  y -= 18;

  const severities = ['critical', 'high', 'medium', 'low'] as const;
  for (const sev of severities) {
    const count = input.mismatches.filter((m) => (m.severity || '').toLowerCase() === sev).length;
    page.drawText(`${sev.toUpperCase()}: ${count}`, {
      x: 50,
      y,
      size: 10,
      font,
      color: severityColor(sev),
    });
    y -= 14;
  }

  y -= 16;
  const summaryNote =
    input.mismatches.length === 0
      ? 'No differences were recorded for this session. If you expected diffs, run Launch Environments and interact only in the Playwright DEV window before exporting.'
      : 'This report lists every recorded difference with DEV vs PROD values. Visual mismatches include pixel-diff evidence when available.';
  for (const line of wrapText(summaryNote, 90)) {
    page.drawText(line, { x: 40, y, size: 9, font, color: rgb(0.25, 0.25, 0.25) });
    y -= 12;
  }

  // ---------- Exact text differences table ----------
  page = pdfDoc.addPage([612, 792]);
  y = 740;
  page.drawText('Exact Text Differences (DEV vs PROD)', {
    x: 40,
    y,
    size: 16,
    font: fontBold,
  });
  y -= 18;
  page.drawText('Each row shows the exact on-screen text captured from both environments.', {
    x: 40,
    y,
    size: 9,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });
  y -= 22;

  const textMismatches = input.mismatches.filter(
    (m) => (m.type || '').toLowerCase() === 'text' || (m.devValue && m.prodValue && m.devValue !== m.prodValue)
  );
  const listSource = textMismatches.length > 0 ? textMismatches : input.mismatches;

  if (listSource.length === 0) {
    page.drawText('No differences were captured in this session.', {
      x: 40,
      y,
      size: 11,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
  } else {
    // Table header
    page.drawRectangle({
      x: 40,
      y: y - 18,
      width: 532,
      height: 18,
      color: rgb(0.12, 0.14, 0.2),
    });
    page.drawText('#', { x: 46, y: y - 13, size: 8, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('What differs', { x: 70, y: y - 13, size: 8, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('DEV exact text', { x: 200, y: y - 13, size: 8, font: fontBold, color: rgb(0.6, 1, 0.8) });
    page.drawText('PROD exact text', { x: 400, y: y - 13, size: 8, font: fontBold, color: rgb(1, 0.7, 0.75) });
    y -= 26;

    for (let i = 0; i < listSource.length; i++) {
      const m = listSource[i];
      const devLines = wrapText(String(m.devValue ?? ''), 32);
      const prodLines = wrapText(String(m.prodValue ?? ''), 32);
      const compLines = wrapText(String(m.component ?? ''), 20);
      const rowLines = Math.max(devLines.length, prodLines.length, compLines.length, 1);
      const rowH = Math.max(28, rowLines * 11 + 10);

      if (y - rowH < 50) {
        page = pdfDoc.addPage([612, 792]);
        y = 740;
        page.drawText('Exact Text Differences (continued)', {
          x: 40,
          y,
          size: 14,
          font: fontBold,
        });
        y -= 28;
      }

      page.drawRectangle({
        x: 40,
        y: y - rowH,
        width: 532,
        height: rowH,
        color: i % 2 === 0 ? rgb(0.96, 0.97, 0.98) : rgb(1, 1, 1),
        borderColor: rgb(0.88, 0.88, 0.9),
        borderWidth: 0.5,
      });

      page.drawText(String(i + 1), {
        x: 46,
        y: y - 14,
        size: 9,
        font: fontBold,
        color: rgb(0.2, 0.2, 0.2),
      });

      for (let li = 0; li < compLines.length; li++) {
        page.drawText(compLines[li], {
          x: 70,
          y: y - 14 - li * 11,
          size: 8,
          font,
          color: rgb(0.15, 0.15, 0.15),
        });
      }
      for (let li = 0; li < devLines.length; li++) {
        page.drawText(devLines[li], {
          x: 200,
          y: y - 14 - li * 11,
          size: 9,
          font: fontBold,
          color: rgb(0.02, 0.4, 0.28),
        });
      }
      for (let li = 0; li < prodLines.length; li++) {
        page.drawText(prodLines[li], {
          x: 400,
          y: y - 14 - li * 11,
          size: 9,
          font: fontBold,
          color: rgb(0.65, 0.12, 0.18),
        });
      }

      y -= rowH + 4;
    }
  }

  // ---------- Per-difference detail + large screenshots ----------
  if (input.mismatches.length === 0) {
    // already handled
  } else {
    // Deduplicate screenshot sets so we don't repeat the same images for every text row
    const shownShotKeys = new Set<string>();

    for (let i = 0; i < input.mismatches.length; i++) {
      const m = input.mismatches[i];
      page = pdfDoc.addPage([612, 792]);
      y = 750;

      page.drawText(`Finding ${i + 1} of ${input.mismatches.length}`, {
        x: 40,
        y,
        size: 14,
        font: fontBold,
      });
      y -= 20;

      page.drawRectangle({
        x: 40,
        y: y - 16,
        width: 70,
        height: 16,
        color: severityColor(m.severity),
      });
      page.drawText((m.severity || 'info').toUpperCase(), {
        x: 46,
        y: y - 12,
        size: 8,
        font: fontBold,
        color: rgb(1, 1, 1),
      });
      page.drawText(`${m.type || 'Difference'}  ·  ${m.component || 'Unknown'}`, {
        x: 120,
        y: y - 12,
        size: 10,
        font,
        color: rgb(0.25, 0.25, 0.25),
      });
      y -= 28;

      page.drawText('EXACT TEXT COMPARISON', {
        x: 40,
        y,
        size: 11,
        font: fontBold,
        color: rgb(0.15, 0.15, 0.2),
      });
      y -= 8;

      const boxW = 255;
      const h1 = drawExactTextBox(page, {
        x: 40,
        y,
        width: boxW,
        title: 'DEV — exact text',
        titleColor: rgb(0.02, 0.55, 0.4),
        body: String(m.devValue ?? ''),
        font,
        fontBold,
      });
      const h2 = drawExactTextBox(page, {
        x: 40 + boxW + 22,
        y,
        width: boxW,
        title: 'PROD — exact text',
        titleColor: rgb(0.75, 0.15, 0.22),
        body: String(m.prodValue ?? ''),
        font,
        fontBold,
      });
      y -= Math.max(h1, h2) + 16;

      // Clear one-line statement of the difference
      page.drawRectangle({
        x: 40,
        y: y - 40,
        width: 532,
        height: 40,
        color: rgb(1, 0.97, 0.9),
        borderColor: rgb(0.9, 0.7, 0.2),
        borderWidth: 1,
      });
      const statement = `Difference: DEV has "${String(m.devValue ?? '').slice(0, 60)}" but PROD has "${String(m.prodValue ?? '').slice(0, 60)}"`;
      let sy = y - 16;
      for (const line of wrapText(statement, 88)) {
        page.drawText(line, {
          x: 50,
          y: sy,
          size: 10,
          font: fontBold,
          color: rgb(0.35, 0.2, 0.05),
        });
        sy -= 12;
      }
      y -= 52;

      const meta = [
        m.classification ? pdfSafe(m.classification) : '',
        (m.occurrences || 1) > 1 ? `Seen ${m.occurrences} times` : '',
        m.stepIds && m.stepIds.length
          ? `Steps: ${pdfSafe(m.stepIds.slice(0, 8).join(', '))}${m.stepIds.length > 8 ? '...' : ''}`
          : '',
      ]
        .filter(Boolean)
        .join('  |  ');
      if (meta) {
        page.drawText(meta.slice(0, 120), { x: 40, y, size: 8, font, color: rgb(0.4, 0.4, 0.45) });
        y -= 12;
      }

      if (m.aiAnalysis) {
        for (const line of wrapText(`Analysis: ${m.aiAnalysis}`, 95)) {
          page.drawText(line, { x: 40, y, size: 9, font, color: rgb(0.25, 0.25, 0.3) });
          y -= 11;
        }
        y -= 8;
      }

      // Screenshots — large, clear; full-width stack if possible
      const shotKey = `${m.devScreenshotPath || ''}|${m.prodScreenshotPath || ''}|${m.diffScreenshotPath || ''}`;
      const alreadyShown = shotKey !== '||' && shownShotKeys.has(shotKey);
      if (!alreadyShown && shotKey !== '||') shownShotKeys.add(shotKey);

      if (!alreadyShown) {
        page.drawText('Screenshots (high clarity)', {
          x: 40,
          y,
          size: 11,
          font: fontBold,
        });
        y -= 14;

        // Prefer side-by-side composite if present (stored as diffScreenshotPath when available)
        const sideImg = await tryEmbedPng(pdfDoc, m.diffScreenshotPath, 1800);
        if (sideImg) {
          const maxW = 532;
          const maxH = Math.min(320, y - 50);
          const scale = Math.min(maxW / sideImg.width, maxH / sideImg.height);
          const w = sideImg.width * scale;
          const h = sideImg.height * scale;
          page.drawText('DEV  |  PROD  |  DIFF overlay', {
            x: 40,
            y,
            size: 8,
            font,
            color: rgb(0.4, 0.4, 0.4),
          });
          y -= 6;
          page.drawImage(sideImg, {
            x: 40,
            y: y - h,
            width: w,
            height: h,
          });
          y -= h + 10;
        } else {
          const devImg = await tryEmbedPng(pdfDoc, m.devScreenshotPath, 1400);
          const prodImg = await tryEmbedPng(pdfDoc, m.prodScreenshotPath, 1400);
          const pair = [
            { label: 'DEV screenshot', img: devImg },
            { label: 'PROD screenshot', img: prodImg },
          ].filter((x) => x.img) as Array<{ label: string; img: PDFImage }>;

          if (pair.length) {
            const maxW = pair.length === 1 ? 532 : 258;
            const maxH = Math.min(280, y - 50);
            let ix = 40;
            for (const item of pair) {
              const scale = Math.min(maxW / item.img.width, maxH / item.img.height);
              const w = item.img.width * scale;
              const h = item.img.height * scale;
              page.drawText(item.label, {
                x: ix,
                y,
                size: 8,
                font: fontBold,
                color: rgb(0.3, 0.3, 0.3),
              });
              page.drawImage(item.img, {
                x: ix,
                y: y - 12 - h,
                width: w,
                height: h,
              });
              ix += maxW + 16;
            }
          } else {
            page.drawText('No screenshot files were available for this finding.', {
              x: 40,
              y,
              size: 9,
              font,
              color: rgb(0.45, 0.45, 0.45),
            });
          }
        }
      } else {
        page.drawText('Screenshots for this capture set are shown on an earlier finding page.', {
          x: 40,
          y,
          size: 9,
          font,
          color: rgb(0.45, 0.45, 0.45),
        });
      }
    }
  }

  // ---------- Execution log page(s) ----------
  page = pdfDoc.addPage([612, 792]);
  y = 740;
  page.drawText('Execution Timeline', {
    x: 40,
    y,
    size: 16,
    font: fontBold,
  });
  y -= 24;

  if (input.logs.length === 0) {
    page.drawText('No actions were logged.', {
      x: 40,
      y,
      size: 11,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  } else {
    const logsChrono = [...input.logs].reverse();
    for (const log of logsChrono.slice(0, 80)) {
      if (y < 70) {
        page = pdfDoc.addPage([612, 792]);
        y = 740;
        page.drawText('Execution Timeline (continued)', {
          x: 40,
          y,
          size: 14,
          font: fontBold,
        });
        y -= 24;
      }

      const ts = (() => {
        try {
          return new Date(log.timestamp).toLocaleTimeString();
        } catch {
          return log.timestamp;
        }
      })();

      const statusColor =
        log.status === 'match' ? rgb(0.05, 0.45, 0.25) : rgb(0.75, 0.15, 0.15);

      page.drawText(ts, {
        x: 40,
        y,
        size: 8,
        font,
        color: rgb(0.45, 0.45, 0.45),
      });
      page.drawText((log.status || '').toUpperCase(), {
        x: 100,
        y,
        size: 8,
        font: fontBold,
        color: statusColor,
      });

      const actionLines = wrapText(log.action || '', 70);
      let ax = 160;
      for (let li = 0; li < actionLines.length; li++) {
        page.drawText(actionLines[li], {
          x: ax,
          y: y - li * 10,
          size: 9,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
      }
      y -= Math.max(14, actionLines.length * 10 + 4);

      page.drawText(`DEV: ${log.devResult || ''}   |   PROD: ${log.prodResult || ''}`, {
        x: 160,
        y,
        size: 8,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
      y -= 16;
    }
  }

  // Footers
  const pages = pdfDoc.getPages();
  pages.forEach((p, idx) => drawFooter(p, input.reportId, idx, pages.length, font));

  // Persist a copy under reports/
  const bytes = await pdfDoc.save();
  try {
    const outDir = path.join(process.cwd(), 'reports', input.reportId);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'comparison-report.pdf'), bytes);
    fs.writeFileSync(
      path.join(outDir, 'comparison-report.json'),
      JSON.stringify(
        {
          ...input,
          summary: {
            actions: input.logs.length,
            matches: matchCount,
            failedSteps: mismatchLogCount,
            differences: input.mismatches.length,
            visual: visualCount,
            interaction: interactionCount,
          },
        },
        null,
        2
      )
    );
  } catch (err) {
    console.warn('Could not write report files to disk', err);
  }

  return bytes;
}
