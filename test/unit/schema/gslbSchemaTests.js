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

const assert = require('assert');
const Ajv = require('ajv');

const ajv = new Ajv(
    {
        allErrors: false,
        useDefaults: true,
        coerceTypes: true,
        extendRefs: 'fail'
    }
);
const defSchema = require('../../../src/schema/latest/definitions.schema.json');
const gslbSchema = require('../../../src/schema/latest/gslb.schema.json');
const customFormats = require('../../../src/schema/latest/formats.js');

Object.keys(customFormats).forEach((customFormat) => {
    ajv.addFormat(customFormat, customFormats[customFormat]);
});

const validate = ajv
    .addSchema(defSchema)
    .compile(gslbSchema);

/* eslint-disable quotes, quote-props */

describe('gslb.schema.json', () => {
    describe('GSLBGlobals class', () => {
        describe('valid', () => {
            it('should validate minimal properties', () => {
                const data = {
                    class: "GSLBGlobals"
                };
                assert.ok(validate(data), getErrorString(validate));
            });

            it('should validate all properties', () => {
                const data = {
                    class: "GSLBGlobals",
                    general: {
                        synchronizationEnabled: true,
                        synchronizationGroupName: "newGroupName",
                        synchronizationTimeTolerance: 123,
                        synchronizationTimeout: 100
                    }
                };
                assert.ok(validate(data), getErrorString(validate));
            });
        });

        describe('invalid', () => {
            it('should invalidate synchronizationTimeTolerance value that is out of range', () => {
                const data = {
                    class: "GSLBGlobals",
                    general: {
                        synchronizationTimeTolerance: 601
                    }
                };
                assert.strictEqual(validate(data), false, 'synchronizationTimeTolerance should be in the 0-600 range');
                assert.notStrictEqual(getErrorString().indexOf('should be <= 600'), -1);
            });

            it('should invalidate synchronizationTimeout value that is out of range', () => {
                const data = {
                    class: "GSLBGlobals",
                    general: {
                        synchronizationTimeout: 4294967296
                    }
                };
                assert.strictEqual(validate(data), false, 'synchronizationTimeout should be in the 0-4294967295 range');
                assert.notStrictEqual(getErrorString().indexOf('should be <= 4294967295'), -1);
            });

            it('should invalidate values 0 and 4 for synchronizationTimeTolerance', () => {
                const data = {
                    class: "GSLBGlobals",
                    general: {
                        synchronizationTimeTolerance: 3
                    }
                };
                assert.strictEqual(validate(data), false, 'synchronizationTimeTolerance should not allow values 1-4');
                assert.notStrictEqual(getErrorString().indexOf('should NOT be valid'), -1);
            });
        });
    });

    describe('GSLBDataCenter class', () => {
        describe('valid', () => {
            it('should validate minimal properties', () => {
                const data = {
                    class: 'GSLBDataCenter'
                };
                assert.ok(validate(data), getErrorString(validate));
            });

            it('should validate all properties', () => {
                const data = {
                    class: 'GSLBDataCenter',
                    enabled: false,
                    location: 'dataCenterLocation',
                    contact: 'dataCenterContact',
                    proberPreferred: 'pool',
                    proberFallback: 'any-available',
                    proberPool: '/Common/proberPool'
                };
                assert.ok(validate(data), getErrorString(validate));
            });
        });

        describe('invalid', () => {
            it('should invalidate invalid proberPreferred value', () => {
                const data = {
                    class: 'GSLBDataCenter',
                    proberPreferred: 'invalid'
                };
                assert.strictEqual(validate(data), false, '');
                assert.notStrictEqual(getErrorString().indexOf(''), -1);
            });

            it('should invalidate invalid proberFallback value', () => {
                const data = {
                    class: 'GSLBDataCenter',
                    proberFallback: 'invalid'
                };
                assert.strictEqual(validate(data), false, '');
                assert.notStrictEqual(getErrorString().indexOf(''), -1);
            });

            it('should invalidate use of proberPool when proberPreferred or proberFallback are not pool', () => {
                const data = {
                    class: 'GSLBDataCenter',
                    proberFallback: 'outside-datacenter',
                    proberPreferred: 'inside-datacenter',
                    proberPool: '/Common/proberPool'
                };
                assert.strictEqual(validate(data), false, '');
                assert.notStrictEqual(getErrorString().indexOf(''), -1);
            });
        });
    });

    describe('GSLBServer class', () => {
        describe('valid', () => {
            it('should validate minimal properties', () => {
                const data = {
                    class: 'GSLBServer',
                    dataCenter: '/Common/gslbDataCenter',
                    devices: [
                        {
                            address: '10.0.0.1'
                        }
                    ]
                };
                assert.ok(validate(data), getErrorString(validate));
            });

            it('should validate all properties', () => {
                const data = {
                    class: 'GSLBServer',
                    label: 'this is a test',
                    remark: 'description',
                    devices: [
                        {
                            address: '10.0.0.1',
                            addressTranslation: '192.0.2.12',
                            remark: 'deviceDescription'
                        },
                        {
                            address: '10.0.0.2',
                            addressTranslation: '192.0.2.13',
                            remark: 'deviceDescription1'
                        }
                    ],
                    dataCenter: '/Common/gslbDataCenter',
                    enabled: false,
                    proberPreferred: 'inside-datacenter',
                    proberFallback: 'any-available',
                    bpsLimit: 50,
                    bpsLimitEnabled: true,
                    ppsLimit: 60,
                    ppsLimitEnabled: true,
                    connectionsLimit: 70,
                    connectionsLimitEnabled: true,
                    serviceCheckProbeEnabled: false,
                    pathProbeEnabled: false,
                    snmpProbeEnabled: false,
                    virtualServerDiscoveryMode: 'enabled',
                    exposeRouteDomainsEnabled: true,
                    cpuUsageLimit: 10,
                    cpuUsageLimitEnabled: true,
                    memoryLimit: 12,
                    memoryLimitEnabled: true,
                    serverType: 'generic-host',
                    monitors: [
                        '/Common/GSLBmonitor',
                        '/Common/otherMonitor'
                    ]
                };
                assert.ok(validate(data), getErrorString(validate));
            });
        });

        describe('invalid', () => {
            let data;

            beforeEach(() => {
                data = {
                    class: 'GSLBServer',
                    dataCenter: '/Common/gslbDataCenter',
                    devices: [
                        {
                            address: '10.0.0.1'
                        }
                    ]
                };
            });

            it('should invalidate invalid proberPreferred value', () => {
                data.proberPreferred = 'badValue';
                assert.strictEqual(validate(data), false);
                assert.notStrictEqual(getErrorString().indexOf('should be equal to one of the allowed values'), -1);
            });

            it('should invalidate invalid proberFallback value', () => {
                data.proberFallback = 'badValue';
                assert.strictEqual(validate(data), false);
                assert.notStrictEqual(getErrorString().indexOf('should be equal to one of the allowed values'), -1);
            });

            it('should invalidate GSLBServer with no devices', () => {
                data.devices = [];
                assert.strictEqual(validate(data), false);
                assert.notStrictEqual(getErrorString().indexOf('should NOT have fewer than 1 items'), -1);
            });

            it('should invalidate GSLBServer with invalid device address value', () => {
                data.devices[0].address = 'badIP';
                assert.strictEqual(validate(data), false);
                assert.notStrictEqual(getErrorString().indexOf('should match format \\"f5ip\\"'), -1);
            });

            it('should invalidate GSLBServer with invalid device addressTranslation value', () => {
                data.devices[0].addressTranslation = 'badIP';
                assert.strictEqual(validate(data), false);
                assert.notStrictEqual(getErrorString().indexOf('should match format \\"f5ip\\"'), -1);
            });

            it('should invalidate invalid virtualServerDiscoveryMode value', () => {
                data.virtualServerDiscoveryMode = 'badValue';
                assert.strictEqual(validate(data), false);
                assert.notStrictEqual(getErrorString().indexOf('should be equal to one of the allowed values'), -1);
            });

            it('should invalidate invalid bpsLimit value of less than 0', () => {
                data.bpsLimit = -1;
                assert.strictEqual(validate(data), false);
                assert.notStrictEqual(getErrorString().indexOf('should be >= 0'), -1);
            });

            it('should invalidate invalid ppsLimit value of less than 0', () => {
                data.ppsLimit = -1;
                assert.strictEqual(validate(data), false);
                assert.notStrictEqual(getErrorString().indexOf('should be >= 0'), -1);
            });

            it('should invalidate invalid connectionsLimit value of less than 0', () => {
                data.connectionsLimit = -1;
                assert.strictEqual(validate(data), false);
                assert.notStrictEqual(getErrorString().indexOf('should be >= 0'), -1);
            });

            it('should invalidate invalid cpuUsageLimit value of less than 0', () => {
                data.cpuUsageLimit = -1;
                assert.strictEqual(validate(data), false);
                assert.notStrictEqual(getErrorString().indexOf('should be >= 0'), -1);
            });

            it('should invalidate invalid memoryLimit value of less than 0', () => {
                data.memoryLimit = -1;
                assert.strictEqual(validate(data), false);
                assert.notStrictEqual(getErrorString().indexOf('should be >= 0'), -1);
            });
        });
    });

    describe('GSLBMonitor class', () => {
        describe('valid', () => {
            it('should validate minimal properties and fill in defaults for monitorType http', () => {
                const data = {
                    class: 'GSLBMonitor',
                    monitorType: 'http'
                };
                assert.ok(validate(data), getErrorString(validate));
                assert.deepStrictEqual(
                    data,
                    {
                        class: 'GSLBMonitor',
                        monitorType: 'http',
                        target: '*:*',
                        interval: 30,
                        timeout: 120,
                        probeTimeout: 5,
                        ignoreDownResponseEnabled: false,
                        transparent: false,
                        reverseEnabled: false,
                        send: 'HEAD / HTTP/1.0\\r\\n\\r\\n',
                        receive: 'HTTP/1.'
                    }
                );
            });

            it('should validate all properties for monitorType http', () => {
                const data = {
                    class: 'GSLBMonitor',
                    monitorType: 'http',
                    target: '10.1.1.2:8080',
                    interval: 100,
                    timeout: 1000,
                    probeTimeout: 50,
                    ignoreDownResponseEnabled: true,
                    transparent: true,
                    reverseEnabled: true,
                    send: 'example send string',
                    receive: 'example receive string'
                };
                assert.ok(validate(data), getErrorString(validate));
            });
        });

        describe('invalid', () => {
            it('should invalidate if monitorType is improperly set', () => {
                const data = {
                    class: 'GSLBMonitor',
                    monitorType: 'BAD_TYPE'
                };
                assert.strictEqual(validate(data), false);
                assert.notStrictEqual(
                    getErrorString().indexOf('should be equal to one of the allowed values'), -1
                );
            });

            it('should invalidate if monitorType is missing', () => {
                const data = {
                    class: 'GSLBMonitor'
                };
                assert.strictEqual(validate(data), false);
                assert.notStrictEqual(
                    getErrorString().indexOf('should have required property \'monitorType\''), -1
                );
            });
        });
    });
});

function getErrorString() {
    return JSON.stringify(validate.errors, null, 4);
}
