const cheerio = require('cheerio');
const { createSession } = require('./_session');

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { html } = await createSession();
        const $ = cheerio.load(html);

        const caseTypes = [];
        $('#case_type option').each((i, el) => {
            const value = $(el).attr('value');
            const text = $(el).text().trim();
            if (value && value !== '') caseTypes.push({ value, text });
        });

        const years = [];
        $('#case_year option').each((i, el) => {
            const value = $(el).attr('value');
            const text = $(el).text().trim();
            if (value && value !== '') years.push({ value, text });
        });

        res.json({ success: true, caseTypes, years });
    } catch (error) {
        console.error('Error fetching case types:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch case types from DHC website.' });
    }
}
