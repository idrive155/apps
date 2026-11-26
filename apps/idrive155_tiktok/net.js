'use strict';
/**
 * Small HTTPS client for MGU Node 8 through mgu-uplink.
 * Never throws past the promise: { ok, status, text, json, error, headers }.
 */
function request(method, url, opts) {
    opts = opts || {};
    const ms = opts.timeoutMs || 12000;
    return new Promise((resolve) => {
        let done = false, req = null;
        const finish = (v) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { if (req) req.abort(); } catch (e) { /* gone */ }
            resolve(v);
        };
        const timer = setTimeout(() => finish({ ok: false, status: 0, text: '', json: null, error: 'timeout', headers: {} }), ms + 500);
        try {
            const u = new (require('url').URL)(url);
            const lib = u.protocol === 'https:' ? require('https') : require('http');
            const headers = Object.assign({
                'user-agent': opts.ua || 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                'accept': opts.accept || 'text/html,application/json;q=0.9,*/*;q=0.8',
                'accept-language': 'en-US,en;q=0.8,hu;q=0.7',
            }, opts.headers || {});
            req = lib.request({
                method: method || 'GET',
                hostname: u.hostname,
                port: u.port || undefined,
                path: u.pathname + u.search,
                headers,
                rejectUnauthorized: opts.insecure ? false : true,
            }, (res) => {
                const parts = [];
                res.on('data', (d) => parts.push(d));
                res.on('error', (e) => finish({ ok: false, status: res.statusCode || 0, text: '', json: null, error: String(e.message || e), headers: res.headers || {} }));
                res.on('end', () => {
                    const buf = Buffer.concat(parts);
                    const text = buf.toString('utf8');
                    let json = null;
                    try { json = JSON.parse(text); } catch (e) { /* not json */ }
                    const status = res.statusCode || 0;
                    finish({
                        ok: status >= 200 && status < 400,
                        status,
                        text,
                        json,
                        error: status >= 400 ? ('http ' + status) : null,
                        headers: res.headers || {},
                        buffer: buf,
                    });
                });
            });
            req.setTimeout(ms, () => finish({ ok: false, status: 0, text: '', json: null, error: 'timeout', headers: {} }));
            req.on('error', (e) => finish({ ok: false, status: 0, text: '', json: null, error: String(e.message || e), headers: {} }));
            if (opts.body) req.write(Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body)));
            req.end();
        } catch (e) {
            finish({ ok: false, status: 0, text: '', json: null, error: String(e.message || e), headers: {} });
        }
    });
}

function get(url, opts) { return request('GET', url, opts); }

module.exports = { request, get };
