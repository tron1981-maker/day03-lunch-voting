import https from 'https';

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
                const location = res.headers.location;
                if (typeof location === 'string') {
                    const redirectUrl = new URL(location, targetUrl).href;
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
                } else {
                    callback(new Error('Redirect location header missing in GAS post'));
                }
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

    // Set 4-second request timeout to prevent serverless function hangs
    req.setTimeout(4000, () => {
        req.destroy(new Error('Vote submit timeout exceeded (4000ms)'));
    });

    req.on('error', (err) => {
        callback(err);
    });

    req.write(postData);
    req.end();
}

function parseRequestBody(req, callback) {
    if (req.body && typeof req.body === 'object') {
        callback(null, req.body);
        return;
    }
    if (req.body && typeof req.body === 'string') {
        try {
            callback(null, JSON.parse(req.body));
        } catch (e) {
            callback(e);
        }
        return;
    }

    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });
    req.on('end', () => {
        try {
            callback(null, body ? JSON.parse(body) : {});
        } catch (e) {
            callback(e);
        }
    });
}

export default function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ result: "error", error: "Method Not Allowed" }));
        return;
    }

    try {
        parseRequestBody(req, (err, body) => {
            if (err) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
                res.end(JSON.stringify({ result: "error", error: "Invalid JSON body" }));
                return;
            }

            const menu = body.menu;
            if (!menu || !ALLOWED_MENUS.includes(menu)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
                res.end(JSON.stringify({ result: "error", error: "Invalid menu choice" }));
                return;
            }

            if (GAS_WEBAPP_URL) {
                submitVoteToGas(GAS_WEBAPP_URL, menu, (gasErr, result) => {
                    if (gasErr) {
                        res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8' });
                        res.end(JSON.stringify({ result: "error", error: gasErr.message }));
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
                        res.end(JSON.stringify({ result: "success", data: result }));
                    }
                });
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
                res.end(JSON.stringify({ 
                    result: "local", 
                    message: "GAS WebApp URL이 설정되지 않아 로컬 브라우저에 임시 기록되었습니다." 
                }));
            }
        });
    } catch (error) {
        console.error('[Serverless Vote Crash]:', error);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ result: "error", error: error.toString() }));
    }
}
