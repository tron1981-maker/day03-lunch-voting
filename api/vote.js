const https = require('https');

const GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzxrZlaLHXQkvWN7E5UfLphgdpGG_08t6xnyHC-jqm-nGG4xLAKwzEiaLL1gsag268J/exec';

const ALLOWED_MENUS = ['bibimbap', 'donkatsu', 'gukbap', 'salad'];

function submitVoteToGas(targetUrl, menu, callback) {
    const postData = JSON.stringify({ menu: menu, voter: "Web App" });

    try {
        const urlObj = new URL(targetUrl);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                try {
                    const location = res.headers.location;
                    if (typeof location === 'string') {
                        const redirectUrl = new URL(location, targetUrl).href;
                        https.get(redirectUrl, (redirectRes) => {
                            let data = '';
                            redirectRes.on('data', (chunk) => { data += chunk; });
                            redirectRes.on('end', () => {
                                try {
                                    callback(null, JSON.parse(data));
                                } catch (e) {
                                    callback(null, { status: 'ok', raw: data });
                                }
                            });
                        }).on('error', (err) => { callback(err); });
                    } else {
                        callback(new Error('Redirect location missing'));
                    }
                } catch (e) {
                    callback(e);
                }
                return;
            }

            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    callback(null, JSON.parse(data));
                } catch (e) {
                    callback(null, { status: 'ok', raw: data });
                }
            });
        });

        req.setTimeout(8000, () => {
            req.destroy(new Error('Vote submit timeout'));
        });
        req.on('error', (err) => { callback(err); });
        req.write(postData);
        req.end();
    } catch (err) {
        callback(err);
    }
}

module.exports = function (req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ result: 'error', error: 'Method Not Allowed' });
        return;
    }

    // Vercel auto-parses JSON body
    const body = req.body || {};
    const menu = body.menu;

    if (!menu || !ALLOWED_MENUS.includes(menu)) {
        res.status(400).json({ result: 'error', error: 'Invalid menu choice' });
        return;
    }

    submitVoteToGas(GAS_WEBAPP_URL, menu, function (err, result) {
        if (err) {
            res.status(500).json({ result: 'error', error: err.message });
        } else {
            res.status(200).json({ result: 'success', data: result });
        }
    });
};
