const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { PDFDocument } = require('pdf-lib');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * 🔐 Restrict direct access
 */
app.use((req, res, next) => {
    const allowedHost = "gurtejpalsingh.com";
    const referer = req.headers.referer || "";

    // Allow health checks (Render)
    if (req.path === "/") {
        return res.status(403).send("Access restricted.");
    }

// Serve downloads directory
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}
app.use('/downloads', express.static(DOWNLOADS_DIR));

// Common headers to mimic browser
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
    'Referer': 'https://delhihighcourt.nic.in/app/get-case-type-status',
};

/**
 * Helper: Create a session by loading the page to get cookies + CSRF token.
 * Returns { cookies, csrfToken, captchaCode }
 */
async function createSession() {
    // Step 1: GET the search page
    const pageResponse = await axios.get('https://delhihighcourt.nic.in/app/get-case-type-status', {
        headers: BROWSER_HEADERS,
        timeout: 15000,
        withCredentials: true,
    });

    // Extract set-cookie headers for session
    const rawCookies = pageResponse.headers['set-cookie'] || [];
    const cookieStr = rawCookies.map(c => c.split(';')[0]).join('; ');

    const $ = cheerio.load(pageResponse.data);

    // Extract CSRF token — it's embedded in the inline JavaScript as _token
    let csrfToken = '';

    // Try meta tag first
    csrfToken = $('meta[name="csrf-token"]').attr('content') || '';

    // If not in meta, search inline scripts for _token value
    if (!csrfToken) {
        const html = pageResponse.data;
        // Pattern: "_token": "XXXXX" or '_token': 'XXXXX'
        const tokenMatch = html.match(/"_token"\s*:\s*"([^"]+)"/);
        if (tokenMatch) {
            csrfToken = tokenMatch[1];
        }
    }

    // Extract captcha code from the hidden field or label
    let captchaCode = '';
    captchaCode = $('#randomid').val() || '';
    if (!captchaCode) captchaCode = $('#cap').text().trim();
    if (!captchaCode) captchaCode = $('#captcha-code').text().trim();

    // Also extract XSRF-TOKEN cookie value (URL decoded) for the header
    let xsrfToken = '';
    for (const cookie of rawCookies) {
        if (cookie.startsWith('XSRF-TOKEN=')) {
            xsrfToken = decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='));
            break;
        }
    }

    console.log(`  🔑 Session: CSRF=${csrfToken.substring(0, 20)}... Captcha=${captchaCode} Cookies=${cookieStr.substring(0, 60)}...`);

    return { cookies: cookieStr, csrfToken, captchaCode, xsrfToken, html: pageResponse.data };
}

// ============================================================
// API: Fetch all case types from the DHC website
// ============================================================
app.get('/api/case-types', async (req, res) => {
    try {
        const { html } = await createSession();
        const $ = cheerio.load(html);

        const caseTypes = [];
        $('#case_type option').each((i, el) => {
            const value = $(el).attr('value');
            const text = $(el).text().trim();
            if (value && value !== '') {
                caseTypes.push({ value, text });
            }
        });

        const years = [];
        $('#case_year option').each((i, el) => {
            const value = $(el).attr('value');
            const text = $(el).text().trim();
            if (value && value !== '') {
                years.push({ value, text });
            }
        });

        res.json({ success: true, caseTypes, years });
    } catch (error) {
        console.error('Error fetching case types:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch case types from DHC website.' });
    }
});

// ============================================================
// API: Search for a case and get its details + order links
// ============================================================
app.post('/api/search-case', async (req, res) => {
    try {
        const { caseType, caseNumber, year } = req.body;

        if (!caseType || !caseNumber || !year) {
            return res.status(400).json({ success: false, error: 'Case type, number, and year are required.' });
        }

        console.log(`\n🔍 Searching for case: ${caseType} ${caseNumber}/${year}`);

        // Step 1: Create a fresh session (get cookies + CSRF + captcha)
        const session = await createSession();

        // Step 2: Validate captcha (required before DataTable draw)
        console.log(`  📝 Validating captcha: ${session.captchaCode}`);

        const captchaResponse = await axios.post(
            'https://delhihighcourt.nic.in/app/validateCaptcha',
            `_token=${encodeURIComponent(session.csrfToken)}&captchaInput=${encodeURIComponent(session.captchaCode)}`,
            {
                headers: {
                    ...BROWSER_HEADERS,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': session.cookies,
                    'X-CSRF-TOKEN': session.csrfToken,
                    'X-XSRF-TOKEN': session.xsrfToken,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                },
                timeout: 15000,
            }
        );

        console.log(`  ✅ Captcha validation response:`, JSON.stringify(captchaResponse.data));

        // Update cookies if new ones were set
        let activeCookies = session.cookies;
        const captchaCookies = captchaResponse.headers['set-cookie'];
        if (captchaCookies) {
            const newCookieMap = {};
            // Parse existing cookies
            activeCookies.split('; ').forEach(c => {
                const [name, ...val] = c.split('=');
                newCookieMap[name] = val.join('=');
            });
            // Override with new ones
            captchaCookies.forEach(c => {
                const [nameVal] = c.split(';');
                const [name, ...val] = nameVal.split('=');
                newCookieMap[name] = val.join('=');
            });
            activeCookies = Object.entries(newCookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
        }

        // Step 3: DataTables server-side request to get case data
        // DataTables sends specific parameters for server-side processing
        const dtParams = new URLSearchParams();
        dtParams.append('draw', '1');
        dtParams.append('columns[0][data]', '0');
        dtParams.append('columns[0][name]', '');
        dtParams.append('columns[0][searchable]', 'true');
        dtParams.append('columns[0][orderable]', 'true');
        dtParams.append('columns[0][search][value]', '');
        dtParams.append('columns[0][search][regex]', 'false');
        dtParams.append('columns[1][data]', '1');
        dtParams.append('columns[1][name]', '');
        dtParams.append('columns[1][searchable]', 'true');
        dtParams.append('columns[1][orderable]', 'true');
        dtParams.append('columns[1][search][value]', '');
        dtParams.append('columns[1][search][regex]', 'false');
        dtParams.append('columns[2][data]', '2');
        dtParams.append('columns[2][name]', '');
        dtParams.append('columns[2][searchable]', 'true');
        dtParams.append('columns[2][orderable]', 'true');
        dtParams.append('columns[2][search][value]', '');
        dtParams.append('columns[2][search][regex]', 'false');
        dtParams.append('columns[3][data]', '3');
        dtParams.append('columns[3][name]', '');
        dtParams.append('columns[3][searchable]', 'true');
        dtParams.append('columns[3][orderable]', 'true');
        dtParams.append('columns[3][search][value]', '');
        dtParams.append('columns[3][search][regex]', 'false');
        dtParams.append('order[0][column]', '0');
        dtParams.append('order[0][dir]', 'asc');
        dtParams.append('start', '0');
        dtParams.append('length', '50');
        dtParams.append('search[value]', '');
        dtParams.append('search[regex]', 'false');
        dtParams.append('case_type', caseType);
        dtParams.append('case_number', caseNumber);
        dtParams.append('case_year', year);
        dtParams.append('_token', session.csrfToken);

        console.log(`  📋 Fetching DataTable results...`);

        const dtResponse = await axios.get(
            `https://delhihighcourt.nic.in/app/get-case-type-status?${dtParams.toString()}`,
            {
                headers: {
                    ...BROWSER_HEADERS,
                    'Cookie': activeCookies,
                    'X-CSRF-TOKEN': session.csrfToken,
                    'X-XSRF-TOKEN': session.xsrfToken,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                },
                timeout: 20000,
            }
        );

        const dtData = dtResponse.data;
        console.log(`  📊 DataTable response: draw=${dtData.draw}, recordsTotal=${dtData.recordsTotal}, data rows=${dtData.data?.length || 0}`);

        if (!dtData.data || dtData.data.length === 0) {
            return res.json({
                success: false,
                error: 'No cases found for the given details. Please verify case type, number, and year.',
            });
        }

        // Step 4: Parse the DataTable response
        // Each row is an OBJECT with keys: pno, ctype, cno, cyear, pet, res, orderdate, etc.
        // The "ctype" field contains HTML with the case number and links for Orders/Judgments
        let ordersUrl = '';
        let caseDetails = {};

        for (const row of dtData.data) {
            const caseHtml = row.ctype || row[1] || '';
            console.log(`  🔎 Row ctype HTML (first 300 chars): ${caseHtml.substring(0, 300)}`);

            // The href in DHC's HTML is unquoted: href=https://...
            // Use regex to extract the orders URL
            const ordersMatch = caseHtml.match(/href=([^\s>']+case-type-status-details[^\s>']*)/i);
            if (ordersMatch) {
                ordersUrl = ordersMatch[1];
                if (!ordersUrl.startsWith('http')) {
                    ordersUrl = 'https://delhihighcourt.nic.in' + ordersUrl;
                }
            }

            // Also try cheerio parsing as fallback
            if (!ordersUrl) {
                const $row = cheerio.load(caseHtml);
                $row('a').each((i, link) => {
                    const href = $row(link).attr('href') || '';
                    const text = $row(link).text().trim();
                    if ((text.toLowerCase().includes('order') || href.includes('case-type-status-details')) && href) {
                        ordersUrl = href;
                        if (!ordersUrl.startsWith('http')) {
                            ordersUrl = 'https://delhihighcourt.nic.in' + ordersUrl;
                        }
                    }
                });
            }

            caseDetails = {
                caseInfo: `${caseType} - ${caseNumber} / ${year}`,
                parties: (row.pet || row[2] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
                listingDate: (row.orderdate || row[3] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
            };
        }

        if (!ordersUrl) {
            return res.json({
                success: false,
                error: 'Case found but could not locate the orders link.',
                caseDetails,
            });
        }

        console.log(`  🔗 Orders URL: ${ordersUrl.substring(0, 80)}...`);

        // Step 5: The orders page also uses DataTables server-side processing
        // We need to make a GET request with DataTables params to get the order data as JSON
        const ordersDtParams = new URLSearchParams();
        ordersDtParams.append('draw', '1');
        ordersDtParams.append('columns[0][data]', 'DT_RowIndex');
        ordersDtParams.append('columns[0][name]', 'DT_RowIndex');
        ordersDtParams.append('columns[0][searchable]', 'true');
        ordersDtParams.append('columns[0][orderable]', 'false');
        ordersDtParams.append('columns[0][search][value]', '');
        ordersDtParams.append('columns[0][search][regex]', 'false');
        ordersDtParams.append('columns[1][data]', 'case_no_order_link');
        ordersDtParams.append('columns[1][name]', 'case_no_order_link');
        ordersDtParams.append('columns[1][searchable]', 'true');
        ordersDtParams.append('columns[1][orderable]', 'true');
        ordersDtParams.append('columns[1][search][value]', '');
        ordersDtParams.append('columns[1][search][regex]', 'false');
        ordersDtParams.append('columns[2][data]', 'order_date');
        ordersDtParams.append('columns[2][name]', 'order_date.timestamp');
        ordersDtParams.append('columns[2][searchable]', 'true');
        ordersDtParams.append('columns[2][orderable]', 'true');
        ordersDtParams.append('columns[2][search][value]', '');
        ordersDtParams.append('columns[2][search][regex]', 'false');
        ordersDtParams.append('columns[3][data]', 'corrigendum');
        ordersDtParams.append('columns[3][name]', 'corrigendum');
        ordersDtParams.append('columns[3][searchable]', 'true');
        ordersDtParams.append('columns[3][orderable]', 'true');
        ordersDtParams.append('columns[3][search][value]', '');
        ordersDtParams.append('columns[3][search][regex]', 'false');
        ordersDtParams.append('columns[4][data]', 'hindi_order');
        ordersDtParams.append('columns[4][name]', 'hindi_order');
        ordersDtParams.append('columns[4][searchable]', 'true');
        ordersDtParams.append('columns[4][orderable]', 'true');
        ordersDtParams.append('columns[4][search][value]', '');
        ordersDtParams.append('columns[4][search][regex]', 'false');
        ordersDtParams.append('order[0][column]', '0');
        ordersDtParams.append('order[0][dir]', 'asc');
        ordersDtParams.append('start', '0');
        ordersDtParams.append('length', '-1'); // -1 = get ALL orders
        ordersDtParams.append('search[value]', '');
        ordersDtParams.append('search[regex]', 'false');

        console.log(`  📋 Fetching orders via DataTables AJAX...`);

        const ordersResponse = await axios.get(
            `${ordersUrl}?${ordersDtParams.toString()}`,
            {
                headers: {
                    ...BROWSER_HEADERS,
                    'Cookie': activeCookies,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                },
                timeout: 30000,
            }
        );

        const ordersData = ordersResponse.data;
        console.log(`  📊 Orders DataTable: draw=${ordersData.draw}, recordsTotal=${ordersData.recordsTotal}, rows=${ordersData.data?.length || 0}`);

        // Step 6: Parse order rows from the JSON response
        const orders = [];
        if (ordersData.data && ordersData.data.length > 0) {
            for (const orderRow of ordersData.data) {
                // case_no_order_link contains HTML like: <a href="...">CS(OS) 402/2023</a>
                const orderHtml = orderRow.case_no_order_link || '';
                const linkMatch = orderHtml.match(/href=["']?([^"'\s>]+)/i);
                const textMatch = orderHtml.match(/>([^<]+)</);

                // order_date can be an object {display: "13/02/2026", timestamp: ...} or a string
                let orderDate = '';
                if (typeof orderRow.order_date === 'object' && orderRow.order_date) {
                    orderDate = orderRow.order_date.display || '';
                } else {
                    orderDate = String(orderRow.order_date || '').replace(/<[^>]*>/g, '').trim();
                }

                if (linkMatch) {
                    let pdfUrl = linkMatch[1];
                    if (!pdfUrl.startsWith('http')) {
                        pdfUrl = 'https://delhihighcourt.nic.in' + pdfUrl;
                    }
                    orders.push({
                        sno: orderRow.DT_RowIndex || orders.length + 1,
                        caseNo: textMatch ? textMatch[1].trim() : caseInfo,
                        date: orderDate,
                        pdfUrl,
                    });
                }
            }
        }

        console.log(`  ✅ Found ${orders.length} orders`);

        res.json({
            success: true,
            caseDetails,
            orders,
            totalOrders: orders.length,
        });

    } catch (error) {
        console.error('Error searching case:', error.message);
        if (error.response) {
            console.error('  Response status:', error.response.status);
            console.error('  Response data (first 500 chars):', String(error.response.data).substring(0, 500));
        }
        res.status(500).json({ success: false, error: `Failed to search case: ${error.message}` });
    }
});

// ============================================================
// API: Download all orders and merge into a single PDF
// ============================================================
app.post('/api/download-and-merge', async (req, res) => {
    try {
        const { orders, caseInfo } = req.body;

        if (!orders || orders.length === 0) {
            return res.status(400).json({ success: false, error: 'No orders to download.' });
        }

        console.log(`\n📥 Downloading and merging ${orders.length} orders...`);

        const mergedPdf = await PDFDocument.create();
        const downloadedFiles = [];
        const errors = [];

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            try {
                console.log(`  ⬇️  Downloading order ${i + 1}/${orders.length}: ${order.date || 'Unknown date'}`);

                const response = await axios.get(order.pdfUrl, {
                    headers: {
                        ...BROWSER_HEADERS,
                        'Accept': 'application/pdf,*/*',
                    },
                    responseType: 'arraybuffer',
                    timeout: 60000,
                });

                const pdfBytes = response.data;

                // Save individual file
                const safeDate = (order.date || `order_${i + 1}`).replace(/\//g, '-');
                const individualFilename = `Order_${i + 1}_${safeDate}.pdf`;
                const individualPath = path.join(DOWNLOADS_DIR, individualFilename);
                fs.writeFileSync(individualPath, pdfBytes);

                // Merge into combined PDF
                try {
                    const existingPdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
                    const pages = await mergedPdf.copyPages(existingPdf, existingPdf.getPageIndices());
                    pages.forEach(page => mergedPdf.addPage(page));
                    downloadedFiles.push({
                        filename: individualFilename,
                        date: order.date,
                        pages: pages.length,
                        size: pdfBytes.length,
                    });
                } catch (pdfError) {
                    console.error(`  ⚠️ Could not merge PDF ${i + 1}: ${pdfError.message}`);
                    errors.push({
                        index: i + 1,
                        date: order.date,
                        error: `Could not merge: ${pdfError.message}`,
                    });
                    downloadedFiles.push({
                        filename: individualFilename,
                        date: order.date,
                        pages: 0,
                        size: pdfBytes.length,
                        mergeError: true,
                    });
                }

                // Small delay between downloads to be polite
                if (i < orders.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

            } catch (downloadError) {
                console.error(`  ❌ Failed to download order ${i + 1}: ${downloadError.message}`);
                errors.push({
                    index: i + 1,
                    date: order.date,
                    error: downloadError.message,
                });
            }
        }

        // Save merged PDF
        const safeCaseInfo = (caseInfo || 'case')
            .replace(/[^a-zA-Z0-9_. ()-]/g, '_')
            .replace(/\s+/g, '_');
        const mergedFilename = `Merged_Order_File_${safeCaseInfo}.pdf`;
        const mergedFilePath = path.join(DOWNLOADS_DIR, mergedFilename);

        const mergedPdfBytes = await mergedPdf.save();
        fs.writeFileSync(mergedFilePath, mergedPdfBytes);

        console.log(`  ✅ Merged PDF saved: ${mergedFilename} (${mergedPdf.getPageCount()} pages)`);

        res.json({
            success: true,
            mergedFile: `/downloads/${mergedFilename}`,
            mergedPages: mergedPdf.getPageCount(),
            mergedSize: mergedPdfBytes.length,
            downloadedFiles,
            errors,
            totalDownloaded: downloadedFiles.length,
            totalFailed: errors.length,
        });

    } catch (error) {
        console.error('Error during download and merge:', error.message);
        res.status(500).json({ success: false, error: `Failed to download and merge: ${error.message}` });
    }
});

// ============================================================
// Start server
// ============================================================
app.listen(PORT, () => {
    console.log(`\n🏛️  DHC Order Scraper running at http://localhost:${PORT}`);
    console.log(`📂 Downloads directory: ${DOWNLOADS_DIR}\n`);
});
