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

const cloudUtil = require('@f5devcentral/f5-cloud-libs').util;
const Logger = require('./logger');

const logger = new Logger(module);

/**
 * Handles provisioning parts of a declaration.
 *
 * @class
 */
class ProvisionHandler {
    /**
     * Constructor
     *
     * @param {Object} declaration - Parsed declaration.
     * @param {Object} bigIp - BigIp object.
     * @param {EventEmitter} - DO event emitter.
     * @param {State} - The doState.
     */
    constructor(declaration, bigIp, eventEmitter, state) {
        this.declaration = declaration;
        this.bigIp = bigIp;
        this.eventEmitter = eventEmitter;
        this.state = state;
        this.isDeprovisioning = false;
    }

    /**
     * Starts processing.
     *
     * @returns {Promise} A promise which is resolved when processing is complete
     *                    or rejected if an error occurs.
     */
    process() {
        logger.fine('Processing provision declaration.');
        if (!this.declaration.Common) {
            return Promise.resolve();
        }

        return Promise.resolve()
            .then(() => {
                logger.info('Checking Provision.');
                return handleProvision.call(this);
            });
    }
}

function getProvision() {
    function pruneNone(modules) {
        const modulesCopy = JSON.parse(JSON.stringify(modules));
        Object.keys(modules).forEach((module) => {
            const level = modules[module];
            if (level === 'none') {
                delete modulesCopy[module];
            }
        });
        return modulesCopy;
    }

    let provision = this.declaration.Common.Provision;
    if (!this.isDeprovisioning && this.state.currentConfig.Common.Provision) {
        provision = Object.assign(
            {},
            pruneNone(this.state.currentConfig.Common.Provision),
            pruneNone(provision)
        );
    }

    return provision;
}

function handleProvision() {
    if (!this.declaration.Common.Provision) {
        return Promise.resolve();
    }

    const provision = getProvision.call(this);

    return this.bigIp.onboard.provision(provision, { useTransaction: true })
        .then((results) => {
            // If we provisioned something make sure we are active for a while.
            // BIG-IP has a way of reporting active after provisioning, but then
            // flipping to not active. We love you BIG-IP!
            if (results.length > 0) {
                const activeRequests = [];
                for (let i = 0; i < 10; i += 1) {
                    activeRequests.push(
                        {
                            promise: this.bigIp.active
                        }
                    );
                }
                return cloudUtil.callInSerial(this.bigIp, activeRequests, 100);
            }
            return Promise.resolve();
        });
}

module.exports = ProvisionHandler;
