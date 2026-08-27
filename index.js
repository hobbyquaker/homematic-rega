/**
 * homematic-rega — Homematic CCU ReGaHSS remote script interface.
 *
 * Executes scripts via the CCU's `rega.exe` endpoint (ISO-8859-1), parses the `<xml>` block of
 * script variables and ships the scripts that list channels, values, variables, programs, rooms
 * and functions as JSON. No runtime dependencies.
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import {fileURLToPath} from 'node:url';

const SCRIPT_DIR = fileURLToPath(new URL('./scripts/', import.meta.url));

/** The ReGaHSS speaks ISO-8859-1; Node's `latin1` is exactly that. */
export const ENCODING = 'latin1';

/**
 * Decodes the `%XX` (and `%uXXXX`) escapes produced by the ReGa `WriteURL()` function. Unlike
 * `decodeURIComponent()` the bytes are ISO-8859-1 characters, not UTF-8 sequences.
 * @param {string} s
 * @returns {string}
 */
export function unescapeLatin1(s) {
    if (typeof s !== 'string') {
        return s;
    }
    return s.replace(/%u([0-9a-f]{4})|%([0-9a-f]{2})/gi, (_, u, h) => String.fromCharCode(parseInt(u || h, 16)));
}

const ENTITIES = {'&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&'};

function decodeEntities(s) {
    return s.replace(/&(lt|gt|quot|apos|amp);/g, (m) => ENTITIES[m]);
}

/**
 * Splits a `rega.exe` response into the script output and the `<xml>` block with the script's
 * variables (all values are strings, as the ReGa returns them).
 * @param {string} body decoded response body
 * @returns {{output: string, objects: Object<string, string>}}
 */
export function parseResponse(body) {
    const start = body.lastIndexOf('<xml>');
    if (start === -1) {
        throw new Error('xml in rega response missing');
    }
    const output = body.slice(0, start);
    const xml = body.slice(start + 5);
    const objects = {};
    const re = /<([A-Za-z_][\w.:-]*)\s*\/>|<([A-Za-z_][\w.:-]*)>([\s\S]*?)<\/\2>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        if (m[1]) {
            objects[m[1]] = '';
        } else {
            objects[m[2]] = decodeEntities(m[3]);
        }
    }
    return {output, objects};
}

const formatters = new Map();

function tzOffset(ts, timeZone) {
    let dtf = formatters.get(timeZone);
    if (!dtf) {
        dtf = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        formatters.set(timeZone, dtf);
    }
    const p = {};
    for (const {type, value} of dtf.formatToParts(new Date(ts))) {
        p[type] = value;
    }
    const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return local - Math.floor(ts / 1000) * 1000;
}

/**
 * Converts a ReGa timestamp (`YYYY-MM-DD HH:MM:SS`, CCU local time) to epoch milliseconds.
 * "Never" (empty or 1970) is 0, an unparseable string is null.
 * @param {string} s
 * @param {string} [timeZone] IANA time zone of the CCU; default: this process' local time
 * @returns {number | null}
 */
export function parseTimestamp(s, timeZone) {
    if (s === undefined || s === null || s === '') {
        return 0;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(s).trim());
    if (!m) {
        return null;
    }
    const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
    if (y <= 1970) {
        return 0;
    }
    if (!timeZone) {
        return new Date(y, mo - 1, d, h, mi, se).getTime();
    }
    const asUtc = Date.UTC(y, mo - 1, d, h, mi, se);
    let ts = asUtc - tzOffset(asUtc, timeZone);
    const offset = tzOffset(ts, timeZone);
    if (asUtc - offset !== ts) {
        ts = asUtc - offset;
    }
    return ts;
}

function toChannelId(v) {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

export class Rega {
    /**
     * @param {object} options
     * @param {string} options.host hostname or IP address of the CCU
     * @param {number} [options.port] rega remote script port (default 8181, 48181 with tls)
     * @param {boolean} [options.tls=false] connect using TLS
     * @param {boolean} [options.insecure=false] accept invalid/self-signed TLS certificates
     * @param {string} [options.username] CCU user for basic authentication
     * @param {string} [options.password]
     * @param {string} [options.language='de'] language of the `${...}` placeholder translations
     * @param {boolean} [options.translate=true] translate placeholders in names of variables, rooms, functions
     * @param {number} [options.timeout=30000] request timeout in ms
     * @param {string} [options.timeZone] IANA time zone of the CCU for timestamps (default: local time)
     * @param {number} [options.webPort] port of the CCU web UI (translations), default 80 / 443
     */
    constructor({
        host,
        port,
        tls = false,
        insecure = false,
        username,
        password,
        language = 'de',
        translate = true,
        timeout = 30000,
        timeZone,
        webPort,
    } = {}) {
        if (!host) {
            throw new Error('host is required');
        }
        this.host = host;
        this.tls = Boolean(tls);
        this.port = port || (this.tls ? 48181 : 8181);
        this.insecure = Boolean(insecure);
        this.username = username;
        this.password = password;
        this.language = language;
        this.translate = Boolean(translate);
        this.timeout = timeout;
        this.timeZone = timeZone;
        const proto = this.tls ? 'https' : 'http';
        this.url = `${proto}://${host}:${this.port}/rega.exe`;
        this.webUrl = `${proto}://${host}${webPort ? ':' + webPort : ''}`;
        this.translations = null;
        this.translationError = null;
    }

    /**
     * Low-level request; body is sent and the response decoded as ISO-8859-1.
     * @param {string} url
     * @param {{method?: string, body?: string}} [options]
     * @returns {Promise<{status: number, body: string}>}
     */
    request(url, {method = 'GET', body} = {}) {
        return new Promise((resolve, reject) => {
            const u = new URL(url);
            const transport = u.protocol === 'https:' ? https : http;
            const headers = {};
            let data;
            if (body !== undefined) {
                data = Buffer.from(String(body), ENCODING);
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
                headers['Content-Length'] = data.length;
            }
            if (this.username) {
                headers.Authorization =
                    'Basic ' + Buffer.from(`${this.username}:${this.password || ''}`).toString('base64');
            }
            const req = transport.request(
                u,
                {method, headers, rejectUnauthorized: !this.insecure, timeout: this.timeout},
                (res) => {
                    const chunks = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('error', reject);
                    res.on('end', () =>
                        resolve({status: res.statusCode, body: Buffer.concat(chunks).toString(ENCODING)}),
                    );
                },
            );
            req.on('timeout', () => req.destroy(new Error('rega request timeout after ' + this.timeout + 'ms')));
            req.on('error', reject);
            if (data) {
                req.write(data);
            }
            req.end();
        });
    }

    /**
     * Executes a rega script.
     * @param {string} script
     * @returns {Promise<{output: string, objects: Object<string, string>}>} the script's output
     *          and every variable set in the script (as strings)
     */
    async exec(script) {
        const {status, body} = await this.request(this.url, {method: 'POST', body: script});
        if (status === 401) {
            throw new Error('401 Unauthorized');
        }
        if (status < 200 || status >= 300) {
            throw new Error('rega http status ' + status);
        }
        return parseResponse(body);
    }

    /**
     * Executes a rega script from a file (UTF-8).
     * @param {string} file path
     */
    async script(file) {
        return this.exec(await fs.readFile(file, 'utf8'));
    }

    async _json(name) {
        let {output} = await this.script(SCRIPT_DIR + name);
        // https://github.com/rdmtc/RedMatic/issues/381 — the ReGa writes nan for some values
        output = output.replace(/, "val": nan,/g, ', "val": null,');
        try {
            return JSON.parse(output);
        } catch (err) {
            const error = new Error(`JSON.parse of ${name} output failed: ${err.message}`);
            error.body = output.slice(0, 1000);
            throw error;
        }
    }

    _ts(s) {
        return parseTimestamp(s, this.timeZone);
    }

    async _loadTranslations() {
        this.translations = {};
        try {
            const url = `${this.webUrl}/webui/js/lang/${this.language}/translate.lang.extension.js`;
            const {status, body} = await this.request(url);
            if (status !== 200) {
                throw new Error('http status ' + status);
            }
            for (const line of body.split('\n')) {
                const m = line.match(/\s*"((func|room|sysVar)[^"]+)"\s*:\s*"([^"]+)"/);
                if (m) {
                    this.translations[m[1]] = unescapeLatin1(m[3]);
                }
            }
        } catch (err) {
            this.translationError = err;
        }
    }

    _translate(item) {
        if (!this.translate || typeof item !== 'string') {
            return item;
        }
        let key = item;
        if (key.startsWith('${') && key.endsWith('}')) {
            key = key.slice(2, -1);
        }
        return this.translations && this.translations[key] ? this.translations[key] : item;
    }

    async _translated(name) {
        const res = await this._json(name);
        if (this.translate && !this.translations) {
            await this._loadTranslations();
        }
        for (const o of res) {
            o.name = this._translate(unescapeLatin1(o.name));
            if (o.info !== undefined) {
                o.info = this._translate(unescapeLatin1(o.info));
            }
        }
        return res;
    }

    /**
     * All devices and channels.
     * @returns {Promise<Array<{id: number, address: string, name: string}>>}
     */
    async getChannels() {
        const res = await this._json('channels.rega');
        for (const ch of res) {
            ch.name = unescapeLatin1(ch.name);
        }
        return res;
    }

    /**
     * Current values of all datapoints.
     * @returns {Promise<Array<{name: string, value: *, ts: number}>>} `name` is
     *          `<interface>.<channel>.<datapoint>`, `ts` epoch ms (0 = never)
     */
    async getValues() {
        const res = await this._json('values.rega');
        for (const dp of res) {
            dp.name = unescapeLatin1(dp.name);
            if (typeof dp.value === 'string') {
                dp.value = unescapeLatin1(dp.value);
            }
            dp.ts = this._ts(dp.ts);
        }
        return res;
    }

    /**
     * All programs.
     * @returns {Promise<Array<{id: number, name: string, info: string, active: boolean, ts: number}>>}
     *          `ts` = last execution, epoch ms (0 = never)
     */
    async getPrograms() {
        const res = await this._json('programs.rega');
        for (const prg of res) {
            prg.name = unescapeLatin1(prg.name);
            prg.info = unescapeLatin1(prg.info);
            prg.ts = this._ts(prg.ts);
        }
        return res;
    }

    /**
     * All system variables (including the built-in ids 40 alarms and 41 service messages).
     * @returns {Promise<Array<{id: number, name: string, info: string, val: *, ts: number, unit: string,
     *          type: 'boolean' | 'number' | 'string', enum: string[], channel: number | null}>>}
     */
    async getVariables() {
        const res = await this._translated('variables.rega');
        for (const v of res) {
            if (typeof v.val === 'string') {
                v.val = unescapeLatin1(v.val);
            }
            v.enum = v.enum === '' || v.enum === undefined ? [] : unescapeLatin1(v.enum).split(';');
            v.enum = v.enum.map((e) => this._translate(e));
            v.ts = this._ts(v.ts);
            v.channel = toChannelId(v.channel);
        }
        return res;
    }

    /**
     * All rooms with the ids of their channels.
     * @returns {Promise<Array<{id: number, name: string, channels: number[]}>>}
     */
    getRooms() {
        return this._translated('rooms.rega');
    }

    /**
     * All functions ("Gewerke") with the ids of their channels.
     * @returns {Promise<Array<{id: number, name: string, channels: number[]}>>}
     */
    getFunctions() {
        return this._translated('functions.rega');
    }

    /**
     * Sets a variable.
     * @param {number} id
     * @param {number | boolean | string} value
     */
    setVariable(id, value) {
        return this.exec(`dom.GetObject(${id}).State(${JSON.stringify(value)});`);
    }

    /**
     * Executes a program.
     * @param {number} id
     */
    startProgram(id) {
        return this.exec(`dom.GetObject(${id}).ProgramExecute();`);
    }

    /**
     * Activates/deactivates a program.
     * @param {number} id
     * @param {boolean} active
     */
    setProgram(id, active) {
        return this.exec(`dom.GetObject(${id}).Active(${Boolean(active)});`);
    }

    /**
     * Renames an object.
     * @param {number} id
     * @param {string} name
     */
    setName(id, name) {
        return this.exec(`dom.GetObject(${id}).Name("${String(name).replace(/"/g, '')}");`);
    }
}

export default Rega;
