# homematic-rega

[![NPM version](https://badge.fury.io/js/homematic-rega.svg)](http://badge.fury.io/js/homematic-rega)
[![CI](https://github.com/hobbyquaker/homematic-rega/actions/workflows/ci.yml/badge.svg)](https://github.com/hobbyquaker/homematic-rega/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat)](LICENSE)

> Node.js Homematic CCU ReGaHSS remote script interface

This module encapsulates the communication with the "ReGaHSS" — the logic layer of the Homematic
CCU — through its remote script endpoint (`rega.exe`). ES module, promise API, no dependencies,
Node.js >= 20.

- execute arbitrary scripts and read back the script's variables
- get names and ids of devices and channels
- get the current values of all datapoints
- get variables including value and meta data, set variables
- get programs, execute and activate/deactivate them
- get rooms and functions including assigned channels
- rename objects

`${...}` i18n placeholders (e.g. `${roomKitchen}`) are translated by default. Official and
inofficial documentation of the scripting language:
[wikimatic.de](http://www.wikimatic.de/wiki/Script_Dokumentation).

## Install

```
npm install homematic-rega
```

## Usage

```js
import {Rega} from 'homematic-rega';

const rega = new Rega({host: '192.168.2.105'});

const {output, objects} = await rega.exec('string x = "Hello";\nWriteLine(x # " World!");');
console.log(output); // "Hello World!\n"
console.log(objects); // {exec: '/rega.exe', sessionId: '', httpUserAgent: '', x: 'Hello'}

const variables = await rega.getVariables();
```

## Options

| option      | default              | description                                                             |
| ----------- | -------------------- | ----------------------------------------------------------------------- |
| `host`      | —                    | hostname or IP address of the CCU (required)                            |
| `port`      | `8181` (`48181` tls) | rega remote script port                                                 |
| `tls`       | `false`              | connect using TLS                                                       |
| `insecure`  | `false`              | accept invalid/self-signed TLS certificates                             |
| `username`  | —                    | CCU user for basic authentication (with `password`)                     |
| `language`  | `'de'`               | language of the placeholder translations                                |
| `translate` | `true`               | translate `${...}` placeholders in names of variables, rooms, functions |
| `timeout`   | `30000`              | request timeout in ms                                                   |
| `timeZone`  | local time           | IANA time zone of the CCU, used to convert timestamps                   |
| `webPort`   | `80` (`443` tls)     | port of the CCU web UI, where the translations are downloaded from      |

## API

All methods return Promises.

| method                   | resolves to                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `exec(script)`           | `{output, objects}` — the script's output and every variable set in the script (strings)                                                     |
| `script(file)`           | same, for a script file (UTF-8)                                                                                                              |
| `getChannels()`          | `[{id, address, name}]` — devices and channels                                                                                               |
| `getValues()`            | `[{name, value, ts}]` — every datapoint, `name` = `<interface>.<channel>.<datapoint>`                                                        |
| `getVariables()`         | `[{id, name, info, val, ts, unit, type, enum, channel}]` — `type` is `boolean`/`number`/`string`, `enum` an array, `channel` an id or `null` |
| `getPrograms()`          | `[{id, name, info, active, ts}]` — `ts` = last execution                                                                                     |
| `getRooms()`             | `[{id, name, channels}]` — `channels` are channel ids                                                                                        |
| `getFunctions()`         | `[{id, name, channels}]`                                                                                                                     |
| `setVariable(id, value)` | `{output, objects}`                                                                                                                          |
| `startProgram(id)`       |                                                                                                                                              |
| `setProgram(id, active)` |                                                                                                                                              |
| `setName(id, name)`      |                                                                                                                                              |

Timestamps (`ts`) are epoch milliseconds; `0` means "never" (the CCU's `1970-01-01 01:00:00`).
They are converted from the CCU's local time — set `timeZone` when the CCU is not in the time
zone of the process. Text is decoded as ISO-8859-1, which is what the ReGaHSS speaks.

Exported helpers: `parseResponse(body)`, `parseTimestamp(string, timeZone)`, `unescapeLatin1(string)`.

## Migration from 1.x

| 1.x                                         | 2.0                                                 |
| ------------------------------------------- | --------------------------------------------------- |
| `const Rega = require('homematic-rega')`    | `import {Rega} from 'homematic-rega'`               |
| `rega.exec(script, (err, output, objects))` | `const {output, objects} = await rega.exec(script)` |
| `rega.getVariables((err, res))` etc.        | `await rega.getVariables()`                         |
| `{inSecure, auth, user, pass}`              | `{insecure, username, password}`                    |
| `{disableTranslation: true}`                | `{translate: false}`                                |
| `ts: '2026-01-15 12:00:00'`                 | `ts: 1768478400000` (ms), `timeZone` option         |
| `enum: ''`/`'a;b'`, `channel: ''`/`'1234'`  | `enum: []`/`['a', 'b']`, `channel: null`/`1234`     |

## Related projects

- [node-red-contrib-ccu](https://github.com/rdmtc/node-red-contrib-ccu) — Node-RED nodes for the Homematic CCU
- [hm2mqtt](https://github.com/hobbyquaker/hm2mqtt.js) — interface between Homematic and MQTT
- [binrpc](https://github.com/hobbyquaker/binrpc) — Node.js client/server for the Homematic BINRPC protocol
- [homematic-xmlrpc](https://github.com/hobbyquaker/homematic-xmlrpc) — Node.js client/server for the Homematic XMLRPC protocol

## License

MIT (c) Sebastian Raff

Changes per release: [CHANGELOG.md](CHANGELOG.md).
