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

const Logger = require('./logger');
const NAMELESS_CLASSES = require('./sharedConstants').NAMELESS_CLASSES;
const doUtil = require('./doUtil');
const parserUtil = require('./parserUtil');
const configItems = require('./configItems.json');

const logger = new Logger(module);

/**
 * Parses a declaration into sub-components by class (DNS, License, etc).
 *
 *     - Ignores the name property if it is not relevant
 *     - For properties in configItems.json that have 'newId', renames those properties
 *       to 'id'. This is so that handler classes do not have to do this.
 *
 * For example, given the declaration
 *
 *     {
 *         "schemaVersion": "1.0.0",
 *         "class": "Device",
 *         "Common": {
 *             "class": "Tenant",
 *             "hostname": "bigip.example.com",
 *             "myLicense": {
 *                 "class": "License",
 *                 "licenseType": "regKey",
 *                 "regKey": "MMKGX-UPVPI-YIEMK-OAZIS-KQHSNAZ"
 *             },
 *             "myDns": {
 *                 "class": "DNS",
 *                 "nameServers": [
 *                     "1.2.3.4",
 *                     "FE80:0000:0000:0000:0202:B3FF:FE1E:8329"
 *                 ],
 *                 "search": [
 *                     "f5.com"
 *                 ]
 *             },
 *             "commonVlan": {
 *                 "class": "VLAN",
 *                 "tag": 2345,
 *                 "mtu": 1400,
 *                 "interfaces": [
 *                     {
 *                         "name": "1.1",
 *                         "tagged": true
 *                     }
 *                 ],
 *                 failsafeEnabled: true
 *             }
 *         },
 *         "Tenant1": {
 *             "class": "Tenant",
 *             "app1Vlan": {
 *                 "class": "VLAN",
 *                 "tag": 1234,
 *                 "mtu": 1500,
 *                 "interfaces": [
 *                     {
 *                         "name": "1.0",
 *                         "tagged": true
 *                     }
 *                 ]
 *             },
 *             "app1SelfIp": {
 *                 "class": "SelfIp",
 *                 "vlan": "app1Vlan",
 *                 "address": "1.2.3.4/24"
 *             }
 *         }
 *     }
 *
 * Returns a parsed delcaration
 *
 *     {
 *         "Common": {
 *             "hostname": "bigip.example.com",
 *             "License": {
 *                 "licenseType": "regKey",
 *                 "regKey": "MMKGX-UPVPI-YIEMK-OAZIS-KQHSNAZ"
 *             },
 *             "DNS": {
 *                 "nameServers": [
 *                     "1.2.3.4",
 *                     "FE80:0000:0000:0000:0202:B3FF:FE1E:8329"
 *                 ],
 *                 "search": [
 *                     "f5.com"
 *                 ]
 *             },
 *             "VLAN": {
 *                 "commonVlan": {
 *                     "name": "commonVlan",
 *                     "tag": 2345,
 *                     "mtu": 1400,
 *                     "interfaces": [
 *                         {
 *                             "name": "1.1",
 *                             "tagged": true
 *                         }
 *                     ],
 *                     "failsafe": "enabled"
 *                 }
 *             }
 *         },
 *         "Tenant1": {
 *             "VLAN": {
 *                 "app1Vlan": {
 *                     "name": "app1Vlan",
 *                     "tag": 1234,
 *                     "mtu": 1500,
 *                     "interfaces": [
 *                         {
 *                             "name": "1.0",
 *                             "tagged": true
 *                         }
 *                     ]
 *                 }
 *             },
 *             "SelfIp": {
 *                 "app1SelfIp": {
 *                     "name": "app1SelfIp",
 *                     "vlan": "app1Vlan",
 *                     "address": "1.2.3.4/24"
 *                 }
 *             }
 *         }
 *     }
 *
 * @class
 */
class DeclarationParser {
    constructor(declaration, modules) {
        this.declaration = {};
        Object.assign(this.declaration, declaration);

        this.modules = Object.assign([], modules);
    }

    /**
     * Parses the declaration.
     *
     * @returns {object} A parsed declaration and list of tenants in the form
     *
     *     {
     *         tenants: <array of tenant names>,
     *         parsedDeclaration: <the parsed declaration>
     *     }
     */
    parse() {
        const KEYS_TO_IGNORE = ['schemaVersion', 'class'];

        function isKeyOfInterest(key) {
            return KEYS_TO_IGNORE.indexOf(key) === -1;
        }

        function getTenants(declaration) {
            return Object.keys(declaration).filter((possibleTenant) => {
                if (isKeyOfInterest(possibleTenant) && declaration[possibleTenant].class) {
                    return declaration[possibleTenant].class === 'Tenant';
                }
                return false;
            });
        }

        function getKeysOfInterest(declaration) {
            return Object.keys(declaration).filter((key) => isKeyOfInterest(key));
        }

        try {
            const parsed = {};

            const tenants = getTenants(this.declaration);
            tenants.forEach((tenantName) => {
                if (!parsed[tenantName]) {
                    parsed[tenantName] = {};
                }

                const tenant = this.declaration[tenantName];
                const properties = getKeysOfInterest(tenant);
                properties.forEach((propertyName) => {
                    let property = tenant[propertyName];

                    if (typeof property !== 'object') {
                        parsed[tenantName][propertyName] = property;
                    } else {
                        const propertyClass = property.class;
                        delete property.class;

                        property = dereference.call(this, property);

                        if (!parsed[tenantName][propertyClass]) {
                            parsed[tenantName][propertyClass] = {};
                        }

                        // If the config object does not get a name property, just assign
                        // the object directly. Otherwise, create a named sub property
                        if (NAMELESS_CLASSES.indexOf(propertyClass) !== -1) {
                            property = assignDefaults(propertyClass, property, this.modules);
                            property = parserUtil.updateIds(configItems, propertyClass, property);
                            Object.assign(parsed[tenantName][propertyClass], property);
                        } else {
                            property = assignDefaults(propertyClass, property, this.modules, propertyName);
                            property = parserUtil.updateIds(configItems, propertyClass, property, propertyName);
                            parsed[tenantName][propertyClass][propertyName] = {};
                            Object.assign(parsed[tenantName][propertyClass][propertyName], property);
                        }
                    }
                });
            });

            parsed.parsed = true;
            return {
                tenants,
                parsedDeclaration: parsed
            };
        } catch (err) {
            logger.error(`Error parsing delcaration ${err.message}`);
            throw err;
        }
    }
}

/**
 * Assigns defualts to properties for which the schema can't do the job.
 *
 * Some properties can't have defaults assigned by the schema. For example,
 * provisioning levels have no sensible default since that are all in one object.
 *
 * @param {String} propertyClass - The property class (DNS, NTP, etc).
 * @param {Object} property - The property to assign defaults to.
 * @param {Array.<String>} - The names of the modules on the target BIG-IP
 * @param {String} [propertyName] - Optional property name to insert if missing
 */
function assignDefaults(propertyClass, property, modules, propertyName) {
    switch (propertyClass) {
    case 'Provision':
        modules.forEach((module) => {
            if (!property[module]) {
                property[module] = 'none';
            }
        });

        break;
    default:
        // Nothing to do here
    }

    // Some classes allow the user to assign the 'name' property
    // so do not override it. This allows for special characters in names.
    if (!property.name && propertyName) {
        property.name = propertyName;
    }

    return property;
}

function dereference(property) {
    // If the property is an array, we need to keep it an array
    const dereferenced = (Array.isArray(property)) ? [] : {};
    Object.assign(dereferenced, property);

    Object.keys(dereferenced).forEach((key) => {
        if (typeof dereferenced[key] === 'string' && dereferenced[key].startsWith('/')) {
            const value = doUtil.dereferencePointer(this.declaration, dereferenced[key]);

            // If we get a string value, do a replacement. Otherwise, just leave the
            // initial value. This allows us to write a declaration with 'vlan: /Common/myVlan'
            // when we want the name 'myVlan' and also a declaration with 'address: /Common/mySelfIp/address'
            // when we want the address property. Might have to revisit this if we ever need to actually
            // replace a pointer with an object or array. Though at that point, since the pointer likely
            // refers to a BIG-IP object, we could use the AS3 bigip: reference style
            if (typeof value === 'string') {
                dereferenced[key] = value;
            }
        } else if (typeof dereferenced[key] === 'object') {
            // This recursively handles subobjects and arrays
            dereferenced[key] = dereference.call(this, dereferenced[key]);
        }
    });

    return dereferenced;
}

module.exports = DeclarationParser;
