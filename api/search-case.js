const axios = require('axios');
const cheerio = require('cheerio');
const { createSession, validateCaptchaAndGetCookies, BROWSER_HEADERS } = require('./_session');

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
        const { caseType, caseNumber, year } = req.body;

        if (!caseType || !caseNumber || !year) {
            return res.status(400).json({ success: false, error: 'Case type, number, and year are required.' });
        }

        // Step 1: Create session + validate captcha
        const session = await createSession();
        const activeCookies = await validateCaptchaAndGetCookies(session);

        // Step 2: DataTables request to find the case
        const dtParams = new URLSearchParams();
        dtParams.append('draw', '1');
        for (let i = 0; i <= 3; i++) {
            dtParams.append(`columns[${i}][data]`, String(i));
            dtParams.append(`columns[${i}][name]`, '');
            dtParams.append(`columns[${i}][searchable]`, 'true');
            dtParams.append(`columns[${i}][orderable]`, 'true');
            dtParams.append(`columns[${i}][search][value]`, '');
            dtParams.append(`columns[${i}][search][regex]`, 'false');
        }
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

        if (!dtData.data || dtData.data.length === 0) {
            return res.json({
                success: false,
                error: 'No cases found for the given details. Please verify case type, number, and year.',
            });
        }

        // Step 3: Parse case row to find orders URL
        let ordersUrl = '';
        let caseDetails = {};

        for (const row of dtData.data) {
            const caseHtml = row.ctype || row[1] || '';

            const ordersMatch = caseHtml.match(/href=([^\s>']+case-type-status-details[^\s>']*)/i);
            if (ordersMatch) {
                ordersUrl = ordersMatch[1];
                if (!ordersUrl.startsWith('http')) {
                    ordersUrl = 'https://delhihighcourt.nic.in' + ordersUrl;
                }
            }

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
            return res.json({ success: false, error: 'Case found but could not locate the orders link.', caseDetails });
        }

        // Step 4: Fetch all orders via DataTables AJAX
        const ordersDtParams = new URLSearchParams();
        ordersDtParams.append('draw', '1');
        const orderCols = [
            ['DT_RowIndex', 'DT_RowIndex'],
            ['case_no_order_link', 'case_no_order_link'],
            ['order_date', 'order_date.timestamp'],
            ['corrigendum', 'corrigendum'],
            ['hindi_order', 'hindi_order'],
        ];
        orderCols.forEach(([data, name], i) => {
            ordersDtParams.append(`columns[${i}][data]`, data);
            ordersDtParams.append(`columns[${i}][name]`, name);
            ordersDtParams.append(`columns[${i}][searchable]`, 'true');
            ordersDtParams.append(`columns[${i}][orderable]`, i === 0 ? 'false' : 'true');
            ordersDtParams.append(`columns[${i}][search][value]`, '');
            ordersDtParams.append(`columns[${i}][search][regex]`, 'false');
        });
        ordersDtParams.append('order[0][column]', '0');
        ordersDtParams.append('order[0][dir]', 'asc');
        ordersDtParams.append('start', '0');
        ordersDtParams.append('length', '-1');
        ordersDtParams.append('search[value]', '');
        ordersDtParams.append('search[regex]', 'false');

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

        // Step 5: Parse orders
        const orders = [];
        if (ordersData.data && ordersData.data.length > 0) {
            for (const orderRow of ordersData.data) {
                const orderHtml = orderRow.case_no_order_link || '';
                const linkMatch = orderHtml.match(/href=["']?([^"'\s>]+)/i);
                const textMatch = orderHtml.match(/>([^<]+)</);

                let orderDate = '';
                if (typeof orderRow.order_date === 'object' && orderRow.order_date) {
                    orderDate = orderRow.order_date.display || '';
                } else {
                    orderDate = String(orderRow.order_date || '').replace(/<[^>]*>/g, '').trim();
                }

                if (linkMatch) {
                    let pdfUrl = linkMatch[1];
                    if (!pdfUrl.startsWith('http')) pdfUrl = 'https://delhihighcourt.nic.in' + pdfUrl;
                    orders.push({
                        sno: orderRow.DT_RowIndex || orders.length + 1,
                        caseNo: textMatch ? textMatch[1].trim() : `${caseType} ${caseNumber}/${year}`,
                        date: orderDate,
                        pdfUrl,
                    });
                }
            }
        }

        res.json({ success: true, caseDetails, orders, totalOrders: orders.length });

    } catch (error) {
        console.error('Error searching case:', error.message);
        res.status(500).json({ success: false, error: `Failed to search case: ${error.message}` });
    }
}
