const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 8080;
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1apyIElF6YvBms3pTIYSf2jI1nk1cAv5OVG6GwtBjRps/export?format=csv';

const agent = new https.Agent({
    rejectUnauthorized: false
});

// Cache state for Google Sheets API protection (Throttling/Caching Best Practice)
let votesCache = {
    data: null,
    timestamp: 0,
    ttl: 10000 // Cache TTL: 10 seconds
};

// Supported menus whitelist for sanitization and input validation
const ALLOWED_MENUS = ['bibimbap', 'donkatsu', 'gukbap', 'salad'];

function fetchSheetVotes(targetUrl, callback) {
    const now = Date.now();
    
    // 1. Serve from cache if valid (Rate limit protection best practice)
    if (votesCache.data && (now - votesCache.timestamp < votesCache.ttl)) {
        console.log(`[Cache Hit] Serving cached votes. Age: ${Math.round((now - votesCache.timestamp)/1000)}s`);
        callback(null, votesCache.data, true);
        return;
    }

    console.log('[Cache Miss] Fetching fresh data from Google Sheets...');
    
    https.get(targetUrl, { agent }, (res) => {
        // Handle Google Sheets redirects recursively
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            try {
                const redirectUrl = new URL(res.headers.location, targetUrl).href;
                fetchSheetVotes(redirectUrl, callback);
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
                            // Sanitization & Data Validation (Best Practice)
                            const rawMenu = cols[1].trim();
                            
                            // Map Korean menu names, handling typos safely
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

                            // Strict validation against whitelist
                            if (menuKey && ALLOWED_MENUS.includes(menuKey)) {
                                votes[menuKey]++;
                            }
                        }
                    }
                }
                
                // Update Cache on successful fetch
                votesCache.data = votes;
                votesCache.timestamp = Date.now();
                
                callback(null, votes, false);
            } catch (err) {
                handleFetchError(err, callback);
            }
        });
    }).on('error', (err) => {
        handleFetchError(err, callback);
    });
}

// Resilient Fallback Mechanism (Best Practice: Stale-While-Revalidate/Error Fallback)
function handleFetchError(err, callback) {
    console.error('Error fetching sheet votes:', err.message);
    
    if (votesCache.data) {
        console.warn('[Resilience Fallback] Serving stale cached data due to fetch error.');
        callback(null, votesCache.data, true);
    } else {
        // Absolute fallback: all zeros if no cache exists
        const defaultVotes = { bibimbap: 0, donkatsu: 0, gukbap: 0, salad: 0 };
        callback(null, defaultVotes, false);
    }
}

const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.js': 'application/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    const decodedUrl = decodeURIComponent(req.url);
    
    // API endpoint for Google Sheet votes with cache metadata
    if (decodedUrl === '/api/votes') {
        fetchSheetVotes(SHEET_URL, (err, votes, isCached) => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
            
            const responseData = {
                ...votes,
                _metadata: {
                    cached: isCached,
                    timestamp: votesCache.timestamp,
                    expiresAt: votesCache.timestamp + votesCache.ttl,
                    ttlRemaining: Math.max(0, Math.round((votesCache.timestamp + votesCache.ttl - Date.now()) / 1000))
                }
            };
            
            res.end(JSON.stringify(responseData));
        });
        return;
    }

    let filePath = path.join(__dirname, decodedUrl === '/' ? 'index.html' : decodedUrl);
    
    // Prevent directory traversal
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
                res.end('File Not Found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=UTF-8' });
                res.end(`Server Error: ${err.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
