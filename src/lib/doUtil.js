/**
 * Copyright 2021 F5 Networks, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const fs = require('fs');
const net = require('net');
const exec = require('child_process').exec;

const promiseUtil = require('@f5devcentral/atg-shared-utilities').promiseUtils;
const BigIp = require('@f5devcentral/f5-cloud-libs').bigIp;
const httpUtil = require('@f5devcentral/f5-cloud-libs').httpUtil;
const cloudUtil = require('@f5devcentral/f5-cloud-libs').util;
const PRODUCTS = require('@f5devcentral/f5-cloud-libs').sharedConstants.PRODUCTS;

const MASK_REGEX = require('./sharedConstants').MASK_REGEX;
const Logger = require('./logger');
const ipF5 = require('../schema/latest/formats').f5ip;

const logger = new Logger(module);

/**
 * @module
 */
module.exports = {
    /**
     * The @f5devcentral/f5-cloud-libs/BigIp object
     * @external BigIp
     */

    /**
     * Gets and initializes a [BigIp]{@link external:BigIp} object
     *
     * @param {Logger}  callingLogger - {@link Logger} object from caller.
     * @param {Object}  [options] - Optional parameters.
     * @param {String}  [options.host] - IP or hostname of BIG-IP. Default localhost.
     * @param {Number}  [options.port] - Port for management address on host.
     * @param {String}  [options.user] - User for iControl REST commands. Default admin.
     * @param {String}  [options.password] - Password for iControl REST user. Default admin.
     * @param {Boolean} [options.authToken] - Use this auth token instead of a password.
     */
    getBigIp(callingLogger, options) {
        const optionalArgs = {};
        Object.assign(optionalArgs, options);
        const bigIp = new BigIp({ logger: callingLogger });
        return this.initializeBigIp(
            bigIp,
            optionalArgs.host || 'localhost',
            optionalArgs.port,
            optionalArgs.user || 'admin',
            optionalArgs.authToken || optionalArgs.password || 'admin',
            {
                passwordIsToken: !!optionalArgs.authToken
            }
        );
    },

    initializeBigIp(bigIp, host, port, user, password, options) {
        let portPromise;
        if (port) {
            portPromise = Promise.resolve(port);
        } else {
            portPromise = this.getPort(host);
        }
        return portPromise
            .then((managmentPort) => bigIp.init(
                host,
                user,
                password,
                {
                    port: managmentPort,
                    product: 'BIG-IP',
                    passwordIsToken: options.passwordIsToken
                }
            ))
            .then(() => Promise.resolve(bigIp))
            .catch((err) => {
                logger.severe(`Error initializing BigIp: ${err.message}`);
                return Promise.reject(err);
            });
    },

    /**
     * Gets the port for the management address when running on a BIG-IP
     */
    getPort(host) {
        const ports = [8443, 443];

        function tryPort(index, resolve, reject) {
            if (index < ports.length) {
                const port = ports[index];
                const socket = net.createConnection({ host, port });
                socket.on('connect', () => {
                    socket.end();
                    resolve(port);
                });
                socket.on('error', () => {
                    socket.destroy();
                    tryPort(index + 1, resolve, reject);
                });
            } else {
                reject(new Error('Could not determine device port'));
            }
        }

        return new Promise((resolve, reject) => {
            tryPort(0, resolve, reject);
        });
    },

    /**
     * Determines the platform on which we are currently running
     *
     * @returns {Promise} A promise which is resolved with the platform.
     */
    getCurrentPlatform() {
        function retryFunc() {
            return httpUtil.get('http://localhost:8100/shared/identified-devices/config/device-info')
                .then((deviceInfo) => {
                    let platform = 'CONTAINER';
                    if (deviceInfo && deviceInfo.slots) {
                        const activeSlot = deviceInfo.slots.find((slot) => slot.isActive && slot.product);

                        if (activeSlot) {
                            platform = activeSlot.product;
                        }
                    }
                    logger.info(`Platform: ${platform}`);
                    return platform;
                })
                .catch((err) => {
                    logger.warning(`Error detecting current platform: ${err.message}`);
                    return Promise.reject(err);
                });
        }

        return cloudUtil.tryUntil(this, cloudUtil.MEDIUM_RETRY, retryFunc);
    },

    /**
     * Gets the current version of DO if available.
     *
     * In typical dev environments, there is no version file present. However, the
     * version file is created by the RPM spec file so will be there in production.
     *
     * @returns {Object} Object containing VERSION and RELEASE
     */
    getDoVersion() {
        let versionString = '0.0.0-0';
        try {
            versionString = fs.readFileSync(`${__dirname}/../version`, 'ascii');
        } catch (err) {
            logger.debug('Version file not found');
        }

        const versionInfo = versionString.split('-');
        return {
            VERSION: versionInfo[0],
            RELEASE: versionInfo[1]
        };
    },

    /**
     * Determines if a reboot is required.
     *
     * @param {BigIp} bigIp - BigIp object
     * @param {Object} state - The [doState]{@link State} object
     * @param {String} taskId - The id of the task
     *
     * @returns {Promise} - A promise which resolves true or false based on whehter or not
     *                      the BigIp requires a reboot.
     */
    rebootRequired(bigIp, state, taskId) {
        if (state && state.getRebootRequired(taskId)) {
            logger.debug('DO state indicates reboot required');
            return Promise.resolve(true);
        }

        return this.getCurrentPlatform()
            .then((platform) => {
                let promise;
                if (platform === PRODUCTS.BIGIP) {
                    // If we are running on  a BIG-IP, run a local tmsh command
                    promise = this.executeBashCommandLocal('cat /var/prompt/ps1');
                } else {
                    // Otherwise, use a remote command
                    promise = this.executeBashCommandIControl(bigIp, 'cat /var/prompt/ps1');
                }

                return promise;
            })
            .then((ps1Prompt) => {
                if (ps1Prompt.trim() === 'REBOOT REQUIRED') {
                    return Promise.resolve(true);
                }
                return Promise.resolve(false);
            })
            .then((promptSaysRebootRequired) => {
                // Double check the db var. If either the prompt or the db var says
                // reboot required, then reboot is required.
                if (!promptSaysRebootRequired) {
                    return bigIp.list('/tm/sys/db/provision.action', null, cloudUtil.MEDIUM_RETRY)
                        .then((response) => Promise.resolve(response.value === 'reboot'));
                }
                return Promise.resolve(true);
            })
            .then((rebootRequired) => Promise.resolve(rebootRequired));
    },

    /**
     * Return a promise to execute a bash command on a BIG-IP using
     * child-process.exec.
     *
     * @param {string} command - bash command to execute
     * @returns {Promise} - A promise which resolves to a string containing the command output
     */
    executeBashCommandLocal(command) {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout) => {
                if (error !== null) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
        });
    },

    /**
     * Returns a promise to execute a bash command on a BIG-IP via iControl REST.
     *
     * @param {BigIp} bigIp - BigIp object
     * @param {string} command - bash command to execute
     * @param {Object} [retryOptions] - Options for retrying the command. See f5-cloud-libs bigIp commands for details.
     * @param {Object} [options] - Command options. See f5-cloud-libs bigIp commands for details.
     *
     * @returns {Promise} - resolves to a string containing the command output
     */
    executeBashCommandIControl(bigIp, command, retryOptions, options) {
        const commandBody = {
            command: 'run',
            utilCmdArgs: `-c "${command}"`
        };

        return bigIp.create(
            '/tm/util/bash',
            commandBody,
            null,
            retryOptions || cloudUtil.SHORT_RETRY,
            options
        )
            .then((result) => result.commandResult);
    },

    /**
     * Extracts the object in a declaration with a given class name.
     *
     * @param {Object} declaration - The declaration part of a declaration
     * @param {String} className - The class name of interest
     *
     * @returns {Object} An object whose only members have a class matching the given class name
     *                   or null if class is not in declaration.
     */
    getClassObjects(declaration, className) {
        const common = declaration.Common || {};
        const keys = Object.keys(common).filter((key) => typeof common[key] === 'object'
            && common[key].class
            && common[key].class === className);

        if (keys.length > 0) {
            const classes = {};
            keys.forEach((key) => {
                classes[key] = JSON.parse(JSON.stringify(common[key]));
            });
            return classes;
        }
        return null;
    },

    /**
     * Fills in values that are referenced by json-pointers.
     *
     * @param {Object} declaration - The declaration containing potentially referenced values
     * @param {Object} container - Object of keys/values to dereference
     */
    dereference(declaration, container) {
        const dereferenced = {};
        Object.assign(dereferenced, container);

        Object.keys(dereferenced).forEach((key) => {
            if (typeof dereferenced[key] === 'string' && dereferenced[key].startsWith('/')) {
                const value = this.dereferencePointer(declaration, dereferenced[key]);

                if (typeof value === 'string') {
                    dereferenced[key] = value;
                }
            }
        });

        return dereferenced;
    },

    /**
     * Dereferences a JSON pointer in an object
     *
     * @param {Object} declaration - Object containing pointer
     * @param {String} pointer - The pointer to some other value in the object
     */
    dereferencePointer(declaration, pointer) {
        if (!pointer.startsWith('/')) {
            return pointer;
        }

        let value = declaration;
        const keys = pointer.split('/');
        keys.forEach((key) => {
            if (key && value) {
                value = value[key];
            }
        });

        return value;
    },

    /**
     * Masks sensitive data in a JSON object
     *
     * @param {Object} data - JSON object to mask
     */
    mask(data) {
        const masked = JSON.parse(JSON.stringify(data));

        Object.keys(masked).forEach((key) => {
            if (MASK_REGEX.test(key)) {
                delete masked[key];
            } else if (!Array.isArray(masked[key]) && typeof masked[key] === 'object') {
                masked[key] = this.mask(masked[key]);
            } else if (Array.isArray(masked[key])) {
                masked[key].forEach((item, index) => {
                    if (!Array.isArray(item) && typeof item === 'object') {
                        masked[key][index] = this.mask(item);
                    }
                });
            } else if (MASK_REGEX.test(key)) {
                delete masked[key];
            }
        });

        return masked;
    },

    /**
     * Removes the CIDR from an IP address
     *
     * @param {String} address - IP address with CIDR.
     *
     * @returns {String} - The IP address without the CIDR.
     */
    stripCidr(address) {
        let stripped = address;
        const slashIndex = address.indexOf('/');
        if (slashIndex !== -1) {
            stripped = address.substring(0, slashIndex);
        }
        return stripped;
    },

    /**
     * Checks if hostname exists
     * @param {BigIp} bigIp - BigIp object
     * @param {String} address - URL address
     * @returns {boolean} found - Returns if the hostname was found
     */
    checkDnsResolution(bigIp, address) {
        function checkDns(addrToCheck) {
            if (ipF5(addrToCheck)) {
                return Promise.resolve();
            }

            return bigIp.create(
                '/tm/util/dig',
                {
                    command: 'run',
                    utilCmdArgs: `+nocookie ${address}`
                },
                null,
                cloudUtil.NO_RETRY
            )
                .then((result) => {
                    if (result.commandResult && result.commandResult.indexOf('status: NOERROR') >= 0) {
                        return Promise.resolve();
                    }
                    return Promise.reject(new Error(`Unable to resolve host ${addrToCheck}`));
                });
        }

        return cloudUtil.tryUntil(this, cloudUtil.MEDIUM_RETRY, checkDns, [address]);
    },

    /**
     * Iterates over the tenants in a parsed declaration
     *
     * At this point, Declarative Onboarding only supports the Common partition, but this
     * is written to handle other partitions if they should enter the schema.
     *
     * @param {Object} declaration - The parsed declaration
     * @param {String} classToFetch - The name of the class (DNS, VLAN, etc)
     * @param {function} cb - Function to execute for each object. Will be called with 2 parameters
     *                        tenant and object declaration. Object declaration is the declaration
     *                        for just the object in question, not the whole declaration
     */
    forEach(declaration, classToFetch, cb) {
        const tenantNames = Object.keys(declaration);
        tenantNames.forEach((tenantName) => {
            const tenant = declaration[tenantName];
            const classNames = Object.keys(tenant);
            classNames.forEach((className) => {
                if (className === classToFetch) {
                    const classObject = tenant[className];
                    if (typeof classObject === 'object') {
                        const containerNames = Object.keys(classObject);
                        containerNames.forEach((containerName) => {
                            cb(tenantName, classObject[containerName]);
                        });
                    } else {
                        cb(tenantName, classObject);
                    }
                }
            });
        });
    },

    /**
     * Wait for Big-IP to reboot.
     *
     * @param {Object} bigIp - Big-IP object.
     */
    waitForReboot(bigIp) {
        return this.getCurrentPlatform()
            .then((platform) => {
                if (platform !== PRODUCTS.BIGIP) {
                    // Wait for BIG-IP to be ready if not running on BIG-IP
                    return promiseUtil.delay(10000).then(() => bigIp.ready());
                }
                // Block with Promise that never resolves and wait for BIG-IP to restart
                return new Promise(() => {});
            });
    },

    /**
     * Deletes a deeply nested key denoted by a dot-separated path from an object
     *
     * This function does not work on a path that passes through an Array.
     * For example, if path = 'here.is.my.key' and 'is' is
     * an Array then this function will not work.
     *
     * @param {Object} obj - The object to delete a key from.
     * @param {String} path - A dot-separated path to a key to delete.
     */
    deleteKey(obj, path) {
        if (!obj || !path) {
            return;
        }
        if (typeof path === 'string') {
            path = path.split('.');

            for (let i = 0; i < path.length - 1; i += 1) {
                obj = obj[path[i]];
                if (typeof obj === 'undefined') {
                    return;
                }
            }
            delete obj[path.pop()];
        }
    },

    /**
     * Deletes an array of deeply nested keys denoted by a dot-separated paths from an object
     *
     * @param {Object} obj - The object to delete a key from.
     * @param {String} paths - An array dot-separated paths to keys to delete.
     */
    deleteKeys(obj, paths) {
        paths.forEach((path) => {
            this.deleteKey(obj, path);
        });
    },

    /**
     * Gets a property specified by a dotted string path from an object
     *
     * @param {Object} obj - The object to search
     * @param {String} propertyPath - Dotted string path
     * @param {String} [pathDelimeter] - Path delimiter. Default '.'
     *
     * @returns {Object} - The property found or null
     */
    getDeepValue(obj, propertyPath, pathDelimeter) {
        pathDelimeter = pathDelimeter || '.';
        const pathComponents = propertyPath.split(pathDelimeter);

        if (!obj) {
            return undefined;
        }

        const nextSource = pathComponents[0] === '' ? obj : obj[pathComponents[0]];

        if (pathComponents.length === 1) {
            return nextSource;
        }

        const nextPath = pathComponents.slice(1).join(pathDelimeter);
        return this.getDeepValue(nextSource, nextPath, pathDelimeter);
    },

    setDeepValue(obj, propertyPath, val) {
        const pathComponents = propertyPath.split('.');

        if (pathComponents[0] === '' || pathComponents[pathComponents.length - 1] === '') {
            throw new Error('propertyPath must not be empty, or start/end with a \'.\'');
        }

        pathComponents.reduce((subObj, prop, idx, array) => {
            if (typeof subObj[prop] === 'undefined' && idx < pathComponents.length - 1) {
                // create array instead of object if the next property is a positive whole number
                subObj[prop] = /^\d+$/.test(array[idx + 1]) ? [] : {};
            } else if (idx === pathComponents.length - 1) {
                subObj[prop] = val;
            }
            return subObj[prop];
        }, obj);

        return obj;
    },

    /**
     * Sorts an array of objects by a key value of type string
     *
     * @param {Array} array - An array of objects to be sorted.
     * @param {String} key - The key name to sort by.
     */
    sortArrayByValueString(array, key) {
        (array || []).sort((a, b) => {
            const stringA = a[key].toUpperCase();
            const stringB = b[key].toUpperCase();

            if (stringA < stringB) {
                return -1;
            }

            if (stringA > stringB) {
                return 1;
            }

            return 0;
        });
    }
};
