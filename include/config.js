'use strict';

const shell = require('shelljs');
const path = require('path');
const fs = require('fs');
const moment = require('moment-timezone');
const requireNew = require('require-new');

function copyConfig(source, dest) {
    if (shell.test('-e', path.join(dest, path.basename(source)))) {
        return true;
    }

    if (!shell.test('-e', source)) {
        throw new Error('Source path "' + source + '"does not exists');
    }

    shell.cp('-R', source, dest);
}

/**
 * Class to handle the configuration of the script
 */
class Config {

    /**
     * Constructor
     * @param {string} script The script
     * @param {string} alternateHome (optional) Setup an alternate home directory
     */
    constructor(script, alternateHome) {

        this.nconf = requireNew('nconf');
        
        if (alternateHome === undefined) {
            alternateHome = shell.config.HOME;
        }

        if (!script) {
            script = "";
        }
        this._configPath = path.join(alternateHome, '.usdocker', script);
        this._configDataPath = path.join(alternateHome, '.usdocker_data', script);
        this._configJson = path.join(this._configPath, 'environment.json')
        shell.mkdir('-p', this._configPath);
        shell.mkdir('-p', this._configDataPath);

        this.nconf.use('file', { file: this._configJson });
        this.reload();

        // Setting defaults for global
        if (script === "") {
            this.setEmpty('version', require('../package.json').version);
            this.setEmpty('container-suffix', '-container');
            this.setEmpty('timezone', this.getLocalTimeZone());
            this.setEmpty('docker-host', '/var/run/docker.sock')
        }
    };

    /**
     * Force reload from disk
     */
    reload() {
        this.nconf.load();
    };

    /**
     * Save configuration to disk
     */
    save() {
        this.nconf.save();
    }

    /**
     * Copy a folder from the script directory to the user directory
     * @param {string} source Path
     * @returns {boolean}
     */
    copyToUserDir(source) {
        return copyConfig(source, this._configPath);
    };

    /**
     * Copy a folder from the script directory to the data directory
     * @param {string} source Path
     * @returns {boolean}
     */
    copyToDataDir(source) {
        return copyConfig(source, this._configDataPath);
    };

    /**
     * Get the full path of the folder "name" in the user directory area
     * @param {string} name
     * @returns {string}
     */
    getUserDir(name) {
        return path.join(this._configPath, name ? name : '');
    }

    /**
     * Get the full path of the data directory
     * @returns {string}
     */
    getDataDir() {
        return path.join(this._configDataPath);
    }

    /**
     * Set a key/value pair into the config and save to the disk
     * @param {string} key
     * @param {string|array} value
     */
    set(key, value) {
        this.nconf.set(key, value);
        this.save()
    };

    /**
     * Set a key/value pair into the config ONLY if does not exists and do nothing if exists.
     * @param {string} key
     * @param {string|array} value
     */
    setEmpty(key, value) {
        if (!this.get(key)) {
            this.set(key, value);
        }
    }

    /**
     * Get a value defined by the key or the value defined in defaultValue if not exists
     * @param {string} key
     * @param {string|array} defaultValue
     * @returns {*}
     */
    get(key, defaultValue) {
        let result = this.nconf.get(key);
        if (result === undefined) {
            return defaultValue;
        }
        return result;
    };

    /**
     * Remove a key
     * @param {string} key
     */
    clear(key) {
        this.nconf.clear(key);
        this.save();
    };

    /**
     * Dump the config
     */
    dump() {
        return fs.readFileSync(this._configJson).toString();
    };

    /**
     * Get the time zone of the system
     * @returns {string}
     */
    getLocalTimeZone() {

        return moment.tz.guess();
    }

}

module.exports = Config;


