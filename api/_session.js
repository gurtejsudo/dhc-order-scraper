const axios = require('axios');
const cheerio = require('cheerio');

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
    'Referer': 'https://delhihighcourt.nic.in/app/get-case-type-status',
};

async function createSession() {
    const pageResponse = await axios.get('https://delhihighcourt.nic.in/app/get-case-type-status', {
        headers: BROWSER_HEADERS,
        timeout: 15000,
        withCredentials: true,
    });

    const rawCookies = pageResponse.headers['set-cookie'] || [];
    const cookieStr = rawCookies.map(c => c.split(';')[0]).join('; ');

    const $ = cheerio.load(pageResponse.data);

    let csrfToken = $('meta[name="csrf-token"]').attr('content') || '';
    if (!csrfToken) {
        const tokenMatch = pageResponse.data.match(/"_token"\s*:\s*"([^"]+)"/);
        if (tokenMatch) csrfToken = tokenMatch[1];
    }

    let captchaCode = $('#randomid').val() || '';
    if (!captchaCode) captchaCode = $('#cap').text().trim();
    if (!captchaCode) captchaCode = $('#captcha-code').text().trim();

    let xsrfToken = '';
    for (const cookie of rawCookies) {
        if (cookie.startsWith('XSRF-TOKEN=')) {
            xsrfToken = decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='));
            break;
        }
    }

    return { cookies: cookieStr, csrfToken, captchaCode, xsrfToken, html: pageResponse.data };
}

async function validateCaptchaAndGetCookies(session) {
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

    let activeCookies = session.cookies;
    const captchaCookies = captchaResponse.headers['set-cookie'];
    if (captchaCookies) {
        const newCookieMap = {};
        activeCookies.split('; ').forEach(c => {
            const [name, ...val] = c.split('=');
            newCookieMap[name] = val.join('=');
        });
        captchaCookies.forEach(c => {
            const [nameVal] = c.split(';');
            const [name, ...val] = nameVal.split('=');
            newCookieMap[name] = val.join('=');
        });
        activeCookies = Object.entries(newCookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    return activeCookies;
}

module.exports = { createSession, validateCaptchaAndGetCookies, BROWSER_HEADERS };
