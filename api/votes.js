const https = require('https');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1apyIElF6YvBms3pTIYSf2jI1nk1cAv5OVG6GwtBjRps/export?format=csv';

let votesCache = {
    data: null,
    timestamp: 0,
    ttl: 10000
};

const ALLOWED_MENUS = ['bibimbap', 'donkatsu', 'gukbap', 'salad'];

function fetchSheetVotes(targetUrl, callback) {
    const now = Date.now();

    if (votesCache.data && (now - votesCache.timestamp < votesCache.ttl)) {
        callback(null, votesCache.data, true);
        return;
    }

    try {
        const req = https.get(targetUrl, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                try {
                    const location = res.headers.location;
                    if (typeof location === 'string' &&
                        (location.includes('google.com') || location.includes('googleusercontent.com'))) {
                        const redirectUrl = new URL(location, targetUrl).href;
                        fetchSheetVotes(redirectUrl, callback);
                    } else {
                        handleFetchError(new Error('Untrusted or missing redirect'), callback);
                    }
                } catch (e) {
                    handleFetchError(e, callback);
                }
                return;
            }

            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const lines = data.split(/\r?\n/);
                    const votes = { bibimbap: 0, donkatsu: 0, gukbap: 0, salad: 0 };

                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        const cols = line.split(',');
                        if (cols.length >= 2) {
                            const rawMenu = cols[1].trim();
                            let menuKey = null;
                            if (rawMenu === '비빔밥') menuKey = 'bibimbap';
                            else if (rawMenu === '돈까스') menuKey = 'donkatsu';
                            else if (rawMenu === '국밥' || rawMenu === '국박') menuKey = 'gukbap';
                            else if (rawMenu === '샐러드') menuKey = 'salad';
                            if (menuKey && ALLOWED_MENUS.includes(menuKey)) votes[menuKey]++;
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

        req.setTimeout(8000, () => {
            req.destroy(new Error('Fetch timeout'));
        });
        req.on('error', (err) => {
            handleFetchError(err, callback);
        });
    } catch (err) {
        handleFetchError(err, callback);
    }
}

function handleFetchError(err, callback) {
    console.error('[Fetch Error]:', err.message);
    if (votesCache.data) {
        callback(null, votesCache.data, true);
    } else {
        callback(null, { bibimbap: 0, donkatsu: 0, gukbap: 0, salad: 0 }, false);
    }
}

module.exports = function (req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    fetchSheetVotes(SHEET_URL, function (err, votes, isCached) {
        res.status(200).json({
            ...votes,
            _metadata: {
                cached: isCached,
                timestamp: votesCache.timestamp
            }
        });
    });
};
