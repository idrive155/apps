'use strict';
/**
 * TikTok feed over mgu-uplink.
 * Tries public TikTok pages / oEmbed; falls back to a local demo reel when blocked.
 */
const net = require('./net');

const DEMO = [
    { id: 'demo1', author: '@idrive155', title: 'Demo reel — connect Store Wi-Fi (mgu-uplink) for live TikTok', likes: 0, views: 0, url: 'https://www.tiktok.com/foryou', cover: null, demo: true },
    { id: 'demo2', author: '@tips', title: 'Fel / Le softkeys or turn the controller = previous / next video', likes: 0, views: 0, url: 'https://www.tiktok.com/foryou', cover: null, demo: true },
    { id: 'demo3', author: '@parked', title: 'Parked only — feed pauses if the car moves', likes: 0, views: 0, url: 'https://www.tiktok.com/foryou', cover: null, demo: true },
];

function pick(obj, path) {
    let cur = obj;
    for (let i = 0; i < path.length; i++) {
        if (!cur || typeof cur !== 'object') return undefined;
        cur = cur[path[i]];
    }
    return cur;
}

function itemFromRaw(it) {
    if (!it || typeof it !== 'object') return null;
    const id = String(it.id || it.aweme_id || it.video_id || '');
    if (!id) return null;
    const author = (it.author && (it.author.uniqueId || it.author.unique_id || it.author.nickname))
        || (it.authorMeta && it.authorMeta.name)
        || 'tiktok';
    const title = it.desc || it.title || (it.contents && it.contents[0] && it.contents[0].desc) || '';
    const stats = it.stats || it.statistics || {};
    const likes = Number(stats.diggCount || stats.digg_count || stats.likeCount || 0) || 0;
    const views = Number(stats.playCount || stats.play_count || stats.viewCount || 0) || 0;
    const unique = (author + '').replace(/^@/, '');
    const url = it.share_url || it.shareUrl || ('https://www.tiktok.com/@' + unique + '/video/' + id);
    const cover = pick(it, ['video', 'cover'])
        || pick(it, ['video', 'originCover'])
        || pick(it, ['videoMeta', 'coverUrl'])
        || null;
    const play = pick(it, ['video', 'playAddr'])
        || pick(it, ['video', 'downloadAddr'])
        || pick(it, ['video', 'play_addr', 'url_list', 0])
        || null;
    return {
        id, author: '@' + unique, title: String(title).slice(0, 180),
        likes, views, url, cover: cover || null, play: play || null, demo: false,
    };
}

function collectItems(node, out, depth) {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) collectItems(node[i], out, depth + 1);
        return;
    }
    if (typeof node !== 'object') return;
    if (node.id && (node.desc !== undefined || (node.video && (node.video.cover || node.video.playAddr)))) {
        const it = itemFromRaw(node);
        if (it && !out.seen[it.id]) { out.seen[it.id] = 1; out.list.push(it); }
    }
    if (Array.isArray(node.itemList)) {
        for (let i = 0; i < node.itemList.length; i++) {
            const it = itemFromRaw(node.itemList[i]);
            if (it && !out.seen[it.id]) { out.seen[it.id] = 1; out.list.push(it); }
        }
    }
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) collectItems(node[keys[i]], out, depth + 1);
}

function extractJsonBlobs(html) {
    const blobs = [];
    const re = /<script[^>]+id="(__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE|__NEXT_DATA__)"[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
        try { blobs.push(JSON.parse(m[2])); } catch (e) { /* ignore */ }
    }
    // inline JSON assignments sometimes used by mobile web
    const re2 = /<script[^>]*>\s*window\[['\"]SIGI_STATE['\"]\]\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i;
    const m2 = html.match(re2);
    if (m2) { try { blobs.push(JSON.parse(m2[1])); } catch (e) { /* ignore */ } }
    return blobs;
}

async function probeOnline() {
    const r = await net.get('https://www.tiktok.com/', { timeoutMs: 8000, accept: 'text/html' });
    if (r.ok) return { online: true, via: 'tiktok.com', status: r.status };
    // Store uplink DNS sometimes reaches general HTTPS even when TikTok is filtered
    const r2 = await net.get('https://cloudflare.com/cdn-cgi/trace', { timeoutMs: 6000, accept: 'text/plain' });
    if (r2.ok) return { online: true, via: 'uplink', status: r2.status, tiktokBlocked: true, error: r.error };
    return { online: false, via: null, error: r.error || r2.error || 'offline' };
}

async function oembed(url) {
    const r = await net.get('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url), {
        timeoutMs: 8000,
        accept: 'application/json',
    });
    if (!r.ok || !r.json) return null;
    const j = r.json;
    return {
        id: 'oem-' + String(j.embed_product_id || j.title || url).slice(0, 24),
        author: j.author_url ? ('@' + String(j.author_url).split('@').pop().split('/')[0]) : ('@' + (j.author_name || 'tiktok')),
        title: String(j.title || '').slice(0, 180),
        likes: 0,
        views: 0,
        url,
        cover: j.thumbnail_url || null,
        play: null,
        demo: false,
    };
}

async function loadFromPage(url) {
    const r = await net.get(url, { timeoutMs: 14000 });
    if (!r.ok) return { items: [], error: r.error || ('http ' + r.status) };
    const blobs = extractJsonBlobs(r.text || '');
    const out = { list: [], seen: Object.create(null) };
    for (let i = 0; i < blobs.length; i++) collectItems(blobs[i], out, 0);
    return { items: out.list, error: out.list.length ? null : 'no items in page' };
}

async function loadFeed() {
    const netState = await probeOnline();
    if (!netState.online) {
        return { items: DEMO.slice(), online: false, source: 'demo', error: netState.error || 'no uplink' };
    }
    if (netState.tiktokBlocked) {
        return { items: DEMO.slice(), online: true, source: 'demo', error: 'TikTok blocked on this uplink', net: netState };
    }

    const pages = [
        'https://www.tiktok.com/foryou',
        'https://www.tiktok.com/explore',
        'https://www.tiktok.com/@tiktok',
    ];
    let items = [];
    let lastErr = null;
    for (let i = 0; i < pages.length; i++) {
        const res = await loadFromPage(pages[i]);
        if (res.items && res.items.length) {
            items = items.concat(res.items);
            if (items.length >= 8) break;
        } else lastErr = res.error;
    }

    // de-dupe
    const seen = Object.create(null), uniq = [];
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (seen[it.id]) continue;
        seen[it.id] = 1;
        uniq.push(it);
    }

    if (!uniq.length) {
        // last resort: oEmbed a few well-known public TikTok marketing URLs
        const seeds = [
            'https://www.tiktok.com/@tiktok',
        ];
        for (let i = 0; i < seeds.length; i++) {
            const oem = await oembed(seeds[i]);
            if (oem) uniq.push(oem);
        }
    }

    if (!uniq.length) {
        return { items: DEMO.slice(), online: true, source: 'demo', error: lastErr || 'TikTok returned no feed', net: netState };
    }
    return { items: uniq.slice(0, 40), online: true, source: 'tiktok', error: null, net: netState };
}

module.exports = { loadFeed, oembed, probeOnline, DEMO };
