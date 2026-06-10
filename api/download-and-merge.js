const axios = require('axios');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { BROWSER_HEADERS } = require('./_session');

// ─────────────────────────────────────────────────────────────
// Convert a plain-text order string into a PDF page buffer
// ─────────────────────────────────────────────────────────────
async function textToPdf(orderText, caseNo, orderDate) {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Courier);
    const boldFont = await pdfDoc.embedFont(StandardFonts.CourierBold);

    const PAGE_W = 595;   // A4 width  (pts)
    const PAGE_H = 842;   // A4 height (pts)
    const MARGIN = 50;
    const LINE_HEIGHT = 14;
    const FONT_SIZE = 10;
    const HEADER_SIZE = 11;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    // Word-wrap a single line to fit CONTENT_W
    function wrapLine(text) {
        const words = text.split(' ');
        const lines = [];
        let current = '';
        for (const word of words) {
            const test = current ? current + ' ' + word : word;
            if (font.widthOfTextAtSize(test, FONT_SIZE) <= CONTENT_W) {
                current = test;
            } else {
                if (current) lines.push(current);
                // If a single word is too long, hard-break it
                if (font.widthOfTextAtSize(word, FONT_SIZE) > CONTENT_W) {
                    let chunk = '';
                    for (const ch of word) {
                        if (font.widthOfTextAtSize(chunk + ch, FONT_SIZE) <= CONTENT_W) {
                            chunk += ch;
                        } else {
                            lines.push(chunk);
                            chunk = ch;
                        }
                    }
                    current = chunk;
                } else {
                    current = word;
                }
            }
        }
        if (current) lines.push(current);
        return lines;
    }

    // Split the full text into wrapped lines
    const rawLines = orderText.split(/\r?\n/);
    const allLines = [];
    for (const raw of rawLines) {
        if (raw.trim() === '') {
            allLines.push('');
        } else {
            allLines.push(...wrapLine(raw));
        }
    }

    // Draw lines across as many pages as needed
    let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    // Header on first page
    const header = `${caseNo}  |  Order dated: ${orderDate}`;
    page.drawText(header, {
        x: MARGIN,
        y,
        size: HEADER_SIZE,
        font: boldFont,
        color: rgb(0.1, 0.1, 0.4),
    });
    y -= LINE_HEIGHT * 1.5;

    // Separator line
    page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_W - MARGIN, y },
        thickness: 0.5,
        color: rgb(0.6, 0.6, 0.6),
    });
    y -= LINE_HEIGHT;

    for (const line of allLines) {
        if (y < MARGIN + LINE_HEIGHT) {
            // New page
            page = pdfDoc.addPage([PAGE_W, PAGE_H]);
            y = PAGE_H - MARGIN;
        }
        if (line !== '') {
            page.drawText(line, {
                x: MARGIN,
                y,
                size: FONT_SIZE,
                font,
                color: rgb(0, 0, 0),
            });
        }
        y -= LINE_HEIGHT;
    }

    return await pdfDoc.save();
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    try {
        const { orders, caseInfo } = req.body;
        if (!orders || orders.length === 0)
            return res.status(400).json({ success: false, error: 'No orders to download.' });

        const mergedPdf = await PDFDocument.create();
        const downloadedFiles = [];
        const errors = [];

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            try {
                let pdfBytes;

                if (order.type === 'text') {
                    // ── Legacy text order → generate PDF from text ──────────
                    const text = order.orderText || '(No order text available)';
                    pdfBytes = await textToPdf(
                        text,
                        order.caseNo || caseInfo,
                        order.date || `Order ${i + 1}`
                    );
                } else {
                    // ── Modern PDF order → fetch from DHC ───────────────────
                    const response = await axios.get(order.pdfUrl, {
                        headers: { ...BROWSER_HEADERS, 'Accept': 'application/pdf,*/*' },
                        responseType: 'arraybuffer',
                        timeout: 60000,
                    });
                    pdfBytes = response.data;
                }

                // Merge into combined PDF
                try {
                    const existingPdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
                    const pages = await mergedPdf.copyPages(existingPdf, existingPdf.getPageIndices());
                    pages.forEach(page => mergedPdf.addPage(page));
                    downloadedFiles.push({
                        date: order.date,
                        pages: pages.length,
                        size: pdfBytes.byteLength || pdfBytes.length,
                        type: order.type,
                    });
                } catch (pdfError) {
                    errors.push({ index: i + 1, date: order.date, error: `Could not merge: ${pdfError.message}` });
                    downloadedFiles.push({
                        date: order.date,
                        pages: 0,
                        size: 0,
                        type: order.type,
                        mergeError: true,
                    });
                }

                // Polite delay only for PDF fetches
                if (order.type === 'pdf' && i < orders.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

            } catch (downloadError) {
                errors.push({ index: i + 1, date: order.date, error: downloadError.message });
            }
        }

        // Return merged PDF as base64 data URL (no filesystem on Vercel)
        const mergedPdfBytes = await mergedPdf.save();
        const base64 = Buffer.from(mergedPdfBytes).toString('base64');
        const dataUrl = `data:application/pdf;base64,${base64}`;

        res.json({
            success: true,
            mergedFile: dataUrl,
            mergedPages: mergedPdf.getPageCount(),
            mergedSize: mergedPdfBytes.byteLength,
            downloadedFiles,
            errors,
            totalDownloaded: downloadedFiles.length,
            totalFailed: errors.length,
        });

    } catch (error) {
        console.error('Error during download and merge:', error.message);
        res.status(500).json({ success: false, error: `Failed to download and merge: ${error.message}` });
    }
}
