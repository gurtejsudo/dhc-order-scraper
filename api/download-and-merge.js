const axios = require('axios');
const { PDFDocument } = require('pdf-lib');
const { BROWSER_HEADERS } = require('./_session');

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { orders, caseInfo } = req.body;

        if (!orders || orders.length === 0) {
            return res.status(400).json({ success: false, error: 'No orders to download.' });
        }

        const mergedPdf = await PDFDocument.create();
        const downloadedFiles = [];
        const errors = [];

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            try {
                const response = await axios.get(order.pdfUrl, {
                    headers: { ...BROWSER_HEADERS, 'Accept': 'application/pdf,*/*' },
                    responseType: 'arraybuffer',
                    timeout: 60000,
                });

                const pdfBytes = response.data;

                try {
                    const existingPdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
                    const pages = await mergedPdf.copyPages(existingPdf, existingPdf.getPageIndices());
                    pages.forEach(page => mergedPdf.addPage(page));
                    downloadedFiles.push({
                        date: order.date,
                        pages: pages.length,
                        size: pdfBytes.byteLength,
                    });
                } catch (pdfError) {
                    errors.push({ index: i + 1, date: order.date, error: `Could not merge: ${pdfError.message}` });
                    downloadedFiles.push({ date: order.date, pages: 0, size: pdfBytes.byteLength, mergeError: true });
                }

                // Polite delay between downloads
                if (i < orders.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

            } catch (downloadError) {
                errors.push({ index: i + 1, date: order.date, error: downloadError.message });
            }
        }

        // Save merged PDF as base64 data URL (no filesystem on Vercel)
        const mergedPdfBytes = await mergedPdf.save();
        const base64 = Buffer.from(mergedPdfBytes).toString('base64');
        const dataUrl = `data:application/pdf;base64,${base64}`;

        res.json({
            success: true,
            mergedFile: dataUrl,           // frontend uses this as href for download
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
