const https = require('https');

const GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzxrZlaLHXQkvWN7E5UfLphgdpGG_08t6xnyHC-jqm-nGG4xLAKwzEiaLL1gsag268J/exec';

const agent = new https.Agent({
    rejectUnauthorized: false
});

const ALLOWED_MENUS = ['bibimbap', 'donkatsu', 'gukbap', 'salad'];

function submitVoteToGas(targetUrl, menu, callback) {
    const postData = JSON.stringify({ menu: menu, voter: "Web App" });
    const urlObj = new URL(targetUrl);
    
    const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        agent: agent,
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            try {
                const redirectUrl = new URL(res.headers.location, targetUrl).href;
                https.get(redirectUrl, { agent }, (redirectRes) => {
                    let data = '';
                    redirectRes.on('data', (chunk) => { data += chunk; });
                    redirectRes.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            callback(null, parsed);
                        } catch (e) {
                            callback(e);
                        }
                    });
                }).on('error', (err) => {
                    callback(err);
                });
            } catch (e) {
                callback(e);
            }
            return;
        }

        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                callback(null, parsed);
            } catch (e) {
                callback(e);
            }
        });
    });

    req.on('error', (err) => {
        callback(err);
    });

    req.write(postData);
    req.end();
}

module.exports = (req, res) => {
    // Enable CORS for Vercel function endpoints
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ result: "error", error: "Method Not Allowed" });
        return;
    }

    const { menu } = req.body;
    
    if (!menu || !ALLOWED_MENUS.includes(menu)) {
        res.status(400).json({ result: "error", error: "Invalid menu choice" });
        return;
    }

    if (GAS_WEBAPP_URL) {
        submitVoteToGas(GAS_WEBAPP_URL, menu, (err, result) => {
            if (err) {
                console.error('[Google Write Error] GAS write failed:', err.message);
                res.status(500).json({ result: "error", error: err.message });
            } else {
                res.status(200).json({ result: "success", data: result });
            }
        });
    } else {
        res.status(200).json({ 
            result: "local", 
            message: "GAS WebApp URL이 설정되지 않아 로컬 브라우저에 임시 기록되었습니다." 
        });
    }
};
