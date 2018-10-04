const fs = require('fs');
const path = require('path');

const request = require('request');
const iconv = require('iconv-lite');
const parseXml = require('xml2js').parseString;

class Rega {
    /**
     * @param {object} options
     * @param {string} options.host - hostname or IP address of the Homematic CCU
     * @param {string} [options.language=de] - language used for translation of placeholders in variables/rooms/functions
     * @param {boolean} [options.disableTranslation=false] - disable translation of placeholders
     * @param {number} [options.port=8181] - rega remote script port
     */
    constructor(options) {
        this.language = options.language || 'de';
        this.disableTranslation = options.disableTranslation;
        this.host = options.host;
        this.port = options.port || 8181;
        this.url = 'http://' + this.host + ':' + this.port + '/rega.exe';
        this.encoding = 'iso-8859-1';
    }

    /**
     * @callback Rega~scriptCallback
     * @param {?Error} err
     * @param {string} output - the scripts output
     * @param {Object.<string, string>} variables - contains all variables that are set in the script (as strings)
     */

    _parseResponse(res, callback) {
        if (res && res.match(/xml/)) {
            const outputEnd = res.lastIndexOf('<xml>');
            const output = res.substr(0, outputEnd);
            const xml = res.substr(outputEnd);
            parseXml(xml, {explicitArray: false}, (err, res) => {
                if (err) {
                    callback(err, output);
                } else {
                    callback(null, output, res.xml);
                }
            });
        } else {
            callback(new Error('empty rega response'));
        }
    }

    /**
     * Execute a rega script
     * @method Rega#exec
     * @param {string} script - string containing a rega script
     * @param {Rega~scriptCallback} [callback]
     */
    exec(script, callback) {
        if (typeof callback !== 'function') {
            callback = () => {};
        }
        script = iconv.encode(script, this.encoding);
        request({
            method: 'POST',
            url: this.url,
            encoding: null,
            body: script,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': script.length
            }
        }, (err, res, body) => {
            if (!err && body) {
                body = iconv.decode(body, this.encoding);
                this._parseResponse(body, callback);
            } else {
                callback(err);
            }
        });
    }

    /**
     * Execute a rega script from a file
     * @method Rega#script
     * @param {string} file - path to script file
     * @param {Rega~scriptCallback} [callback]
     */
    script(file, callback) {
        // TODO cache files
        fs.readFile(file, (err, res) => {
            if (err) {
                if (typeof callback === 'function') {
                    callback(err);
                }
            } else {
                this.exec(res.toString(), callback);
            }
        });
    }

    _jsonScript(file, callback) {
        this.script(file, (err, res) => {
            if (err) {
                callback(err);
            } else {
                try {
                    callback(null, JSON.parse(res));
                } catch (err) {
                    callback(err);
                }
            }
        });
    }

    /**
     * Get all devices and channels
     * @method Rega#getChannels
     * @param {Rega~channelCallback} callback
     */
    getChannels(callback) {
        this._jsonScript(path.join(__dirname, 'scripts', 'channels.rega'), callback);
    }

    /**
     * Get all devices and channels values
     * @method Rega#getValues
     * @param {Rega~valuesCallback} callback
     */
    getValues(callback) {
        this._jsonScript(path.join(__dirname, 'scripts', 'values.rega'), callback);
    }

    /**
     * Get all programs
     * @method Rega#getPrograms
     * @param {Rega~programsCallback} callback
     */
    getPrograms(callback) {
        this._jsonScript(path.join(__dirname, 'scripts', 'programs.rega'), callback);
    }

    _getTranslations(callback) {
        const url = 'http://' + this.host + '/webui/js/lang/' + this.language + '/translate.lang.extension.js';
        this.translations = {};
        request({
            method: 'GET',
            url,
            encoding: null
        }, (err, res, body) => {
            if (!err && body) {
                this._parseTranslations(iconv.decode(body, this.encoding));
            }
            callback();
        });
    }

    _parseTranslations(body) {
        const lines = body.split('\n');
        lines.forEach(line => {
            const match = line.match(/\s*"((func|room|sysVar)[^"]+)"\s*:\s*"([^"]+)"/);
            if (match) {
                this.translations[match[1]] = unescape(match[3]); // TODO replace deprecated unescape
            }
        });
    }

    _translate(item) {
        if (!this.disableTranslation) {
            let key = item;
            if (key.startsWith('${') && key.endsWith('}')) {
                key = key.substr(2, item.length - 3);
            }
            if (this.translations[key]) {
                item = this.translations[key];
            }
        }
        return item;
    }

    _translateNames(res) {
        if (!this.disableTranslation) {
            Object.keys(res).forEach(id => {
                const obj = res[id];
                obj.name = this._translate(obj.name);
                if (obj.info) {
                    obj.info = this._translate(unescape(obj.info));
                }
            });
        }
        return res;
    }

    _translateEnum(values) {
        if (!this.disableTranslation) {
            values.forEach((val, i) => {
                values[i] = this._translate(val);
            });
        }
        return values;
    }

    _translateJsonScript(file, callback) {
        if (this.translations || this.disableTranslation) {
            this._jsonScript(file, (err, res) => {
                if (err) {
                    callback(err);
                } else {
                    callback(null, this.disableTranslation ? res : this._translateNames(res));
                }
            });
        } else {
            this._getTranslations(() => {
                this._translateJsonScript(file, callback);
            });
        }
    }

    /**
     * Get all variables
     * @method Rega#getVariables
     * @param {Rega~variablesCallback} callback
     */
    getVariables(callback) {
        this._translateJsonScript(path.join(__dirname, 'scripts', 'variables.rega'), (err, res) => {
            if (err) {
                callback(err);
            } else {
                res.forEach((sysvar, index) => {
                    sysvar.name = unescape(sysvar.name);
                    if (sysvar.type === 'string') {
                        sysvar.val = unescape(sysvar.val);
                    }
                    if (sysvar.enum === '') {
                        sysvar.enum = [];
                    } else {
                        sysvar.enum = this._translateEnum(unescape(sysvar.enum).split(';'));
                    }
                    res[index] = sysvar;
                });
                callback(null, res);
            }
        });
    }

    /**
     * Get all rooms
     * @method Rega#getRooms
     * @param {Rega~roomsCallback} callback
     */
    getRooms(callback) {
        this._translateJsonScript(path.join(__dirname, 'scripts', 'rooms.rega'), callback);
    }

    /**
     * Get all functions
     * @method Rega#getFunctions
     * @param {Rega~functionsCallback} callback
     */
    getFunctions(callback) {
        this._translateJsonScript(path.join(__dirname, 'scripts', 'functions.rega'), callback);
    }

    /**
     * Set a variables value
     * @method Rega#setVariable
     * @param {number} id
     * @param {number|boolean|string} val
     * @param {function} [callback]
     */
    setVariable(id, val, callback) {
        const script = 'dom.GetObject(' + id + ').State(' + JSON.stringify(val) + ');';
        this.exec(script, callback);
    }

    /**
     * Execute a program
     * @method Rega#startProgram
     * @param {number} id
     * @param {function} [callback]
     */
    startProgram(id, callback) {
        const script = 'dom.GetObject(' + id + ').ProgramExecute();';
        this.exec(script, callback);
    }

    /**
     * Activate/Deactivate a program
     * @method Rega#setProgram
     * @param {number} id
     * @param {boolean} active
     * @param {function} [callback]
     */
    setProgram(id, active, callback) {
        const script = 'dom.GetObject(' + id + ').Active(' + Boolean(active) + ');';
        this.exec(script, callback);
    }

    /**
     * Rename an object
     * @method Rega#setName
     * @param {number} id
     * @param {string} name
     * @param {function} [callback]
     */
    setName(id, name, callback) {
        const script = 'dom.GetObject(' + id + ').Name("' + name + '");';
        this.exec(script, callback);
    }
}

module.exports = Rega;
