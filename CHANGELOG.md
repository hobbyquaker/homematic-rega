# Changelog

## 2.0.1

### Fixed

- Requests no longer go through Node's `http.globalAgent`, which pools connections (`keepAlive: true`
  since Node 19). ReGaHSS on the CCU's port 8183 answers HTTP/1.1 without `Connection: close` and
  then closes the connection 0.4–7 ms after the response; a request that reused the pooled socket in
  that window failed with `socket hang up` / `ECONNRESET` (node-red-contrib-ccu since 4.3.0, which
  talks to 8183 directly on a CCU: RedMatic #601). Each request now uses its own connection, as 1.x did.

### Added

- `agent` option: an `http.Agent`/`https.Agent` for the requests (or `false`), for those who want
  pooling against a proxy that supports it, such as lighttpd on 8181.

## 2.0.0

Rewrite as an ES module with a promise API and no runtime dependencies (`request`, `iconv-lite`,
`xml2js`, `temp-dir` are gone). Node.js >= 20.

### Breaking

- ES module (`import {Rega} from 'homematic-rega'` / `import Rega from 'homematic-rega'`), no
  CommonJS `require()`.
- Every method returns a Promise instead of taking a callback. `exec()`/`script()` resolve to
  `{output, objects}`.
- Options renamed: `inSecure` → `insecure`, `user`/`pass` → `username`/`password` (`auth` is
  implied by `username`), `disableTranslation` → `translate: false`.
- Timestamps (`ts` of values, variables and programs) are epoch milliseconds instead of the CCU's
  `YYYY-MM-DD HH:MM:SS` strings; "never" is `0`. New option `timeZone` (IANA name) for a CCU in a
  different time zone than the process.
- `getVariables()`: `enum` is always an array, `channel` is a number or `null`.
- A failed JSON parse rejects with an error carrying the first 1000 characters in `error.body`
  instead of writing a debug file to the temp directory.

### Added

- `timeout` option (default 30 s), `webPort` option for the translation download.
- Exported helpers `parseResponse()`, `parseTimestamp()`, `unescapeLatin1()`.
- `translationError` property when the placeholder translations could not be loaded.
- Unit tests (`node --test`) against a mock `rega.exe`; CI on Node 20/22/24; release workflow with
  npm trusted publishing (OIDC).
