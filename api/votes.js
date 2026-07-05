const https = require('https');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1apyIElF6YvBms3pTIYSf2jI1nk1cAv5OVG6GwtBjRps/export?format=csv';

const agent = new https.Agent({
    rejectUnauthorized: false
});

let votesCache = {
    data: null,
    timestamp: 0,
    ttl: 10000 // Cache TTL: 10 seconds
};

const ALLOWED_MENUS = ['bibimbap', 'donkatsu', 'gukbap', 'salad'];

function fetchSheetVotes(targetUrl, callback) {
    const now = Date.now();
    
    if (votesCache.data && (now - votesCache.timestamp < votesCache.ttl)) {
        callback(null, votesCache.data, true);
        return;
    }

    console.log(`[Serverless Fetch] Fetching from URL: ${targetUrl}`);
    
    const req = https.get(targetUrl, { agent }, (res) => {
        // Handle redirect
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            try {
                const location = res.headers.location;
                if (typeof location === 'string') {
                    const redirectUrl = new URL(location, targetUrl).href;
                    console.log(`[Serverless Redirect] Following redirect to: ${redirectUrl}`);
                    fetchSheetVotes(redirectUrl, callback);
                } else {
                    handleFetchError(new Error('Redirect location header missing'), callback);
                }
            } catch (e) {
                handleFetchError(e, callback);
            }
            return;
        }

        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            try {
                const lines = data.split(/\r?\n/);
                const votes = {
                    bibimbap: 0,
                    donkatsu: 0,
                    gukbap: 0,
                    salad: 0
                };
                
                if (lines.length > 1) {
                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        
                        const cols = line.split(',');
                        if (cols.length >= 2) {
                            const rawMenu = cols[1].trim();
                            let menuKey = null;
                            if (rawMenu === '비빔밥') {
                                menuKey = 'bibimbap';
                            } else if (rawMenu === '돈까스') {
                                menuKey = 'donkatsu';
                            } else if (rawMenu === '국밥' || rawMenu === '국박') {
                                menuKey = 'gukbap';
                            } else if (rawMenu === '샐러드') {
                                menuKey = 'salad';
                            }

                            if (menuKey && ALLOWED_MENUS.includes(menuKey)) {
                                votes[menuKey]++;
                            }
                        }
                    }
                }
                
                votesCache.data = votes;
                votesCache.timestamp = Date.now();
                
                callback(null, votes, false);
            } catch (err) {
                handleFetchError(err, callback);
            }
        });
    });

    // Set 4-second request timeout to prevent serverless function hangs
    req.setTimeout(4000, () => {
        req.destroy(new Error('Fetch timeout exceeded (4000ms)'));
    });

    req.on('error', (err) => {
        handleFetchError(err, callback);
    });
}

function handleFetchError(err, callback) {
    console.error('[Serverless Fetch Error]:', err.message);
    if (votesCache.data) {
        console.warn('[Serverless Fallback] Serving stale cache data.');
        callback(null, votesCache.data, true);
    } else {
        console.warn('[Serverless Fallback] No cache found. Returning zero votes.');
        const defaultVotes = { bibimbap: 0, donkatsu: 0, gukbap: 0, salad: 0 };
        callback(null, defaultVotes, false);
    }
}

module.exports = (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    try {
        fetchSheetVotes(SHEET_URL, (err, votes, isCached) => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
            res.end(JSON.stringify({
                ...votes,
                _metadata: {
                    cached: isCached,
                    timestamp: votesCache.timestamp,
                    expiresAt: votesCache.timestamp + votesCache.ttl,
                    ttlRemaining: Math.max(0, Math.round((votesCache.timestamp + votesCache.ttl - Date.now()) / 1000))
                }
            }));
        });
    } catch (error) {
        console.error('[Serverless Crash]:', error);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ result: "error", error: error.toString() }));
    }
};
