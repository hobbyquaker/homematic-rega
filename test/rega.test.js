import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {Rega, parseResponse, parseTimestamp, unescapeLatin1} from '../index.js';

const latin1 = (s) => Buffer.from(s, 'latin1');

describe('helpers', () => {
    test('unescapeLatin1 decodes WriteURL output as ISO-8859-1', () => {
        assert.equal(unescapeLatin1('Temp%E4ratur%20K%FCche'), 'Tempäratur Küche');
        assert.equal(unescapeLatin1('%u20AC'), '€');
        assert.equal(unescapeLatin1('plain'), 'plain');
        assert.equal(unescapeLatin1(undefined), undefined);
    });

    test('parseResponse splits output and the xml block, self-closing tags included', () => {
        const {output, objects} = parseResponse(
            'Hello\n<xml><exec>/rega.exe</exec><sessionId/><httpUserAgent/><x>a &amp; b</x><n>42</n></xml>',
        );
        assert.equal(output, 'Hello\n');
        assert.deepEqual(objects, {exec: '/rega.exe', sessionId: '', httpUserAgent: '', x: 'a & b', n: '42'});
        assert.throws(() => parseResponse('no xml here'), /xml in rega response missing/);
    });

    test('parseTimestamp: never, garbage, local, time zones and DST', () => {
        assert.equal(parseTimestamp(''), 0);
        assert.equal(parseTimestamp(undefined), 0);
        assert.equal(parseTimestamp('1970-01-01 01:00:00'), 0);
        assert.equal(parseTimestamp('yesterday'), null);
        assert.equal(parseTimestamp('2026-01-15 12:00:00'), new Date(2026, 0, 15, 12, 0, 0).getTime());
        assert.equal(parseTimestamp('2026-01-15 12:00:00', 'UTC'), Date.UTC(2026, 0, 15, 12));
        assert.equal(parseTimestamp('2026-01-15 12:00:00', 'Europe/Berlin'), Date.UTC(2026, 0, 15, 11));
        assert.equal(parseTimestamp('2026-07-15 12:00:00', 'Europe/Berlin'), Date.UTC(2026, 6, 15, 10));
        // first hour after the switch to CEST
        assert.equal(parseTimestamp('2026-03-29 03:30:00', 'Europe/Berlin'), Date.UTC(2026, 2, 29, 1, 30));
        assert.equal(parseTimestamp('2026-01-15 12:00:00', 'America/New_York'), Date.UTC(2026, 0, 15, 17));
    });
});

describe('Rega', () => {
    let server;
    let port;
    let requests = [];
    const routes = {};

    before(async () => {
        server = http.createServer((req, res) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                requests.push({
                    method: req.method,
                    path: req.url,
                    headers: req.headers,
                    body: Buffer.concat(chunks).toString('latin1'),
                });
                const route = routes[req.url];
                if (!route) {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                if (route.hang) {
                    return;
                }
                res.writeHead(route.status || 200, {'Content-Type': 'text/html'});
                res.end(latin1(route.body || ''));
            });
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
    });

    after(() => {
        server.closeAllConnections();
        server.close();
    });

    const rega = (opts = {}) => new Rega({host: '127.0.0.1', port, translate: false, ...opts});
    const setRega = (body, status) => {
        routes['/rega.exe'] = {body, status};
    };

    test('exec sends the script as ISO-8859-1 and parses output and objects', async () => {
        requests = [];
        setRega('ä\n<xml><exec>/rega.exe</exec><sessionId/><httpUserAgent/><x>ä</x></xml>');
        const {output, objects} = await rega().exec('string x = "ä"; WriteLine(x);');
        assert.equal(output, 'ä\n');
        assert.deepEqual(objects, {exec: '/rega.exe', sessionId: '', httpUserAgent: '', x: 'ä'});
        assert.equal(requests[0].method, 'POST');
        assert.equal(requests[0].path, '/rega.exe');
        assert.equal(requests[0].body, 'string x = "ä"; WriteLine(x);');
        assert.equal(requests[0].headers['content-length'], String(Buffer.byteLength(requests[0].body, 'latin1')));
        assert.equal(requests[0].headers.authorization, undefined);
    });

    test('basic auth header, 401 and other http errors', async () => {
        requests = [];
        setRega('<xml></xml>');
        await rega({username: 'Admin', password: 'geheim'}).exec('x');
        assert.equal(requests[0].headers.authorization, 'Basic ' + Buffer.from('Admin:geheim').toString('base64'));
        setRega('', 401);
        await assert.rejects(rega().exec('x'), /401 Unauthorized/);
        setRega('', 500);
        await assert.rejects(rega().exec('x'), /http status 500/);
    });

    test('timeout', async () => {
        routes['/rega.exe'] = {hang: true};
        await assert.rejects(rega({timeout: 50}).exec('x'), /timeout/);
    });

    test('getVariables: names, translations, enums, timestamps, channel', async () => {
        routes['/webui/js/lang/de/translate.lang.extension.js'] = {
            body: 'jQuery.extend(langJSON, {\n  "sysVarPresence" : "Anwesenheit",\n  "sysVarPresenceAbsent" : "abwesend",\n});\n',
        };
        setRega(
            '[{"id": 40, "name": "Alarmmeldungen", "val": 0, "unit": "", "type": "number", "enum": ""},\n' +
                '{"id": 950, "name": "${sysVarPresence}", "info": "", "val": true, "ts": "2026-01-15 12:00:00", "unit": "", "type": "boolean", "enum": "${sysVarPresenceAbsent};anwesend", "channel": ""},\n' +
                '{"id": 951, "name": "Temp%E4ratur", "info": "Ist", "val": 21.5, "ts": "1970-01-01 01:00:00", "unit": "°C", "type": "number", "enum": "", "channel": "1234"},\n' +
                '{"id": 952, "name": "Text", "info": "", "val": "gr%FCn", "ts": "2026-07-15 12:00:00", "unit": "", "type": "string", "enum": "", "channel": "0"}]' +
                '<xml><exec>/rega.exe</exec></xml>',
        );
        const r = rega({translate: true, webPort: port, timeZone: 'UTC'});
        const vars = await r.getVariables();
        assert.equal(r.translationError, null);
        assert.deepEqual(vars[0], {
            id: 40,
            name: 'Alarmmeldungen',
            val: 0,
            unit: '',
            type: 'number',
            enum: [],
            ts: 0,
            channel: null,
        });
        assert.equal(vars[1].name, 'Anwesenheit');
        assert.deepEqual(vars[1].enum, ['abwesend', 'anwesend']);
        assert.equal(vars[1].ts, Date.UTC(2026, 0, 15, 12));
        assert.equal(vars[1].channel, null);
        assert.equal(vars[2].name, 'Tempäratur');
        assert.equal(vars[2].unit, '°C');
        assert.equal(vars[2].ts, 0);
        assert.equal(vars[2].channel, 1234);
        assert.equal(vars[3].val, 'grün');
        assert.equal(vars[3].channel, null);
    });

    test('translations unreachable → names stay as they are, error kept', async () => {
        setRega('[{"id": 1, "name": "${roomKitchen}", "channels": [1, 2]}]<xml></xml>');
        const r = rega({translate: true, webPort: 1});
        const rooms = await r.getRooms();
        assert.deepEqual(rooms, [{id: 1, name: '${roomKitchen}', channels: [1, 2]}]);
        assert.ok(r.translationError);
    });

    test('getChannels, getValues, getPrograms', async () => {
        setRega(
            '[{"id": 1000, "address": "ABC123", "name": "Ger%E4t"}, {"id": 1001, "address": "ABC123:1", "name": "Kanal"}]<xml></xml>',
        );
        assert.deepEqual(await rega().getChannels(), [
            {id: 1000, address: 'ABC123', name: 'Gerät'},
            {id: 1001, address: 'ABC123:1', name: 'Kanal'},
        ]);

        setRega(
            '[{"name": "BidCos-RF.ABC123:1.STATE", "value": true, "ts": "2026-01-15 12:00:00"},\n' +
                '{"name": "BidCos-RF.ABC123:1.TEXT", "value": "gr%FCn", "ts": "1970-01-01 01:00:00"}]<xml></xml>',
        );
        const values = await rega({timeZone: 'UTC'}).getValues();
        assert.deepEqual(values, [
            {name: 'BidCos-RF.ABC123:1.STATE', value: true, ts: Date.UTC(2026, 0, 15, 12)},
            {name: 'BidCos-RF.ABC123:1.TEXT', value: 'grün', ts: 0},
        ]);

        setRega(
            '[{"id": 2000, "name":"Licht%20aus", "info": "", "active":true,"ts":"2026-01-15 12:00:00"}]<xml></xml>',
        );
        assert.deepEqual(await rega({timeZone: 'UTC'}).getPrograms(), [
            {id: 2000, name: 'Licht aus', info: '', active: true, ts: Date.UTC(2026, 0, 15, 12)},
        ]);
    });

    test('nan workaround and JSON errors', async () => {
        setRega('[{"id": 1, "name": "x", "val": nan, "unit": "", "type": "number", "enum": ""}]<xml></xml>');
        const vars = await rega().getVariables();
        assert.equal(vars[0].val, null);

        setRega('<html>login</html><xml></xml>');
        await assert.rejects(rega().getVariables(), (err) => {
            assert.match(err.message, /JSON.parse of variables.rega output failed/);
            assert.equal(err.body, '<html>login</html>');
            return true;
        });
    });

    test('set/start/setProgram/setName scripts', async () => {
        requests = [];
        setRega('<xml></xml>');
        const r = rega();
        await r.setVariable(950, true);
        await r.setVariable(952, 'gr"ün');
        await r.startProgram(2000);
        await r.setProgram(2000, 0);
        await r.setName(1001, 'Kanal "neu"');
        assert.deepEqual(
            requests.map((q) => q.body),
            [
                'dom.GetObject(950).State(true);',
                'dom.GetObject(952).State("gr\\"ün");',
                'dom.GetObject(2000).ProgramExecute();',
                'dom.GetObject(2000).Active(false);',
                'dom.GetObject(1001).Name("Kanal neu");',
            ],
        );
    });

    test('options: tls ports, url, host required', () => {
        assert.equal(rega().url, `http://127.0.0.1:${port}/rega.exe`);
        assert.equal(new Rega({host: 'ccu', tls: true}).url, 'https://ccu:48181/rega.exe');
        assert.equal(new Rega({host: 'ccu'}).webUrl, 'http://ccu');
        assert.throws(() => new Rega({}), /host is required/);
    });
});
