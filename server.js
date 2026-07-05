const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 8080;
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1apyIElF6YvBms3pTIYSf2jI1nk1cAv5OVG6GwtBjRps/export?format=csv';
const GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzxrZlaLHXQkvWN7E5UfLphgdpGG_08t6xnyHC-jqm-nGG4xLAKwzEiaLL1gsag268J/exec';

const agent = new https.Agent({ rejectUnauthorized: false });

let votesCache = { data: null, timestamp: 0, ttl: 10000 };
const ALLOWED_MENUS = ['bibimbap', 'donkatsu', 'gukbap', 'salad'];

function fetchSheetVotes(targetUrl, callback) {
    const now = Date.now();
    if (votesCache.data && (now - votesCache.timestamp < votesCache.ttl)) {
        callback(null, votesCache.data, true);
        return;
    }
    https.get(targetUrl, { agent }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            try {
                const location = res.headers.location;
                if (typeof location === 'string' &&
                    (location.includes('google.com') || location.includes('googleusercontent.com'))) {
                    fetchSheetVotes(new URL(location, targetUrl).href, callback);
                } else {
                    handleFetchError(new Error('Untrusted redirect'), callback);
                }
            } catch (e) { handleFetchError(e, callback); }
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
            } catch (err) { handleFetchError(err, callback); }
        });
    }).on('error', (err) => { handleFetchError(err, callback); });
}

function handleFetchError(err, callback) {
    console.error('Fetch error:', err.message);
    if (votesCache.data) callback(null, votesCache.data, true);
    else callback(null, { bibimbap: 0, donkatsu: 0, gukbap: 0, salad: 0 }, false);
}

function submitVoteToGas(targetUrl, menu, callback) {
    const postData = JSON.stringify({ menu: menu, voter: "Web App" });
    const urlObj = new URL(targetUrl);
    const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        agent: agent,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            try {
                const location = res.headers.location;
                if (typeof location === 'string') {
                    https.get(new URL(location, targetUrl).href, { agent }, (rr) => {
                        let d = '';
                        rr.on('data', (c) => { d += c; });
                        rr.on('end', () => { try { callback(null, JSON.parse(d)); } catch (e) { callback(e); } });
                    }).on('error', (e) => { callback(e); });
                } else { callback(new Error('No redirect location')); }
            } catch (e) { callback(e); }
            return;
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => { try { callback(null, JSON.parse(data)); } catch (e) { callback(e); } });
    });
    req.on('error', (err) => { callback(err); });
    req.write(postData);
    req.end();
}

const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8', '.css': 'text/css; charset=UTF-8',
    '.js': 'application/javascript; charset=UTF-8', '.json': 'application/json; charset=UTF-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    const decodedUrl = decodeURIComponent(req.url);

    if (decodedUrl === '/api/votes') {
        fetchSheetVotes(SHEET_URL, (err, votes, isCached) => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
            res.end(JSON.stringify({ ...votes, _metadata: { cached: isCached, timestamp: votesCache.timestamp } }));
        });
        return;
    }

    if (req.method === 'POST' && decodedUrl === '/api/vote') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const params = JSON.parse(body);
                if (!ALLOWED_MENUS.includes(params.menu)) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
                    res.end(JSON.stringify({ result: 'error', error: 'Invalid menu' }));
                    return;
                }
                submitVoteToGas(GAS_WEBAPP_URL, params.menu, (err, result) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8' });
                        res.end(JSON.stringify({ result: 'error', error: err.message }));
                    } else {
                        votesCache.timestamp = 0;
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
                        res.end(JSON.stringify({ result: 'success', data: result }));
                    }
                });
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
                res.end(JSON.stringify({ result: 'error', error: 'Bad request' }));
            }
        });
        return;
    }

    let filePath = path.join(__dirname, decodedUrl === '/' ? 'index.html' : decodedUrl);
    if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end('Forbidden'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
            res.end(err.code === 'ENOENT' ? 'Not Found' : 'Server Error');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, () => { console.log(`Server running at http://localhost:${PORT}/`); });
