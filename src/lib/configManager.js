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
const url = require('url');
const querystring = require('querystring');
const cloudUtil = require('@f5devcentral/f5-cloud-libs').util;
const Logger = require('./logger');
const RADIUS = require('./sharedConstants').RADIUS;
const PATHS = require('./sharedConstants').PATHS;
const doUtil = require('./doUtil');

const logger = new Logger(module);

/**
 * Manages config on a device.
 *
 * @param {String | Object} configItems - Description of config items that we are interested in.
 *                                        If a String, should be the path to a file containing
 *                                        the items.
 * @param {Object} bigIp - BigIp object.
 *
 * @class
 */
class ConfigManager {
    constructor(configItems, bigIp) {
        if (typeof configItems === 'string') {
            this.configItems = JSON.parse(fs.readFileSync(configItems));
        } else {
            this.configItems = configItems.slice();
        }
        this.bigIp = bigIp;
    }

    /**
     * Updates state with the configuration items we are interested in.
     *
     * The goal here is to store an object with the current BIG-IP config objects
     * that we are interested in and in a format that matches what our parsed declaration looks like.
     *
     * What we retrieve is controlled by this.configItems.
     *
     * this.config items should be in the format:
     * [
     *     {
     *         path: <iControl_rest_path>,
     *         schemaClass: <schema_class_name>
     *         properties: [
     *             {
     *                 id: <property_name>,
     *                 newId: <property_name_to_map_to_in_parsed_declaration>
     *                 truth: <mcp_truth_value_if_this_is_boolean>,
     *                 falsehood: <mcp_false_value_if_this_is_boolean>,
     *                 transform: [<id_newId_to_apply_to_arrays_and_subobjects>],
     *                 capture: <regex_to_capture>,
     *                 captureProperty: <property_to_capture_from>,
     *                 stringToInt: <boolean_to_convert_int_to_string>,
     *                 minVersion: <minimum_big-ip_version_for_property>
     *             }
     *         ],
     *         references: {
     *             <name_of_reference>: ['properties', 'that', 'we', 'are', 'interested', 'in']
     *         },
     *         singleValue: <true_if_we_want_single_key_value_vs_whole_object_(Provision, for example)>,
     *         nameless: <true_if_we_do_not_want_the_name_property_in_the_result>,
     *         enforceArray: <true_if_we_require_this_object_to_always_be_an_array>,
     *         silent: <true_if_we_do_not_want_to_log_the_iControl_request_and_response>,
     *         ignore: [
     *             { <key_to_possibly_ignore>: <regex_for_value_to_ignore> }
     *         ],
     *         schemaMerge: {
     *           path: <array_containing_property_path>,
     *           action: <override_if_not_direct_assign_of_value>
     *           skipWhenOmitted: <do_not_add_to_parent_when_missing>,
     *           specificTo: { property: 'only_add_when_prop_name_equals_prop_value', value: 'prop_value' }
     *         },
     *         partitions: ['partition(s)', 'to', 'check']
     *     }
     * ]
     *
     * 'path' can contain tokens which will be replaced as follows:
     *     {{hostName}} - The current hostname
     *     {{deviceName}} - The current cm device name for the host
     * 'ignore' is a list of key/value pairs to ignore. If the regex matches the value
     * associated with the key, then that item will be ignored
     *
     * @param {Object} declaration - The delcaration we are processing
     * @param {Object} state - The state of the current task. See {@link State}.
     * @param {State} doState - The doState object.
     * @param {Object} [options] - Optional parameters
     * @param {Boolean} [options.translateToNewId] - Set property names to the value in 'newId' if there is one.
     *                                               Default false.
     *
     * @returns {Promise} A promise which is resolved when the operation is complete
     *                    or rejected if an error occurs.
     */
    get(declaration, state, doState, options) {
        const currentCurrentConfig = state.currentConfig || {};
        const currentConfig = {};
        const referencePromises = [];
        const referenceInfo = []; // info needed to tie reference result to config item

        const optionDefaults = {
            translateToNewId: false
        };
        const configOptions = Object.assign(optionDefaults, options);

        // Get the list of db variables that we really want. This includes
        // whatever is in the declaration plus what is in the current config.
        // Otherwise, if a user leaves a db variable out of the declaration we
        // won't have any values to diff. This is all because we do not really
        // want to store all of the db variables (there are over 2000 of them) and
        // there is no way to query for a set of db variables. You would think
        // that $filter would allow you to do this, but $filter only allows you
        // to filter by partition. We love you BIG-IP! So, we either have to get
        // them all and then filter ourselves, or get them one at a time and push
        // them into the correct object in the current config. Since the current structure
        // (using configItems.json) is more amenable to the first approach, that's
        // what we're doing.
        const dbVarsOfInterest = [];
        if (currentCurrentConfig && currentCurrentConfig.Common && currentCurrentConfig.Common.DbVariables) {
            Object.keys(currentCurrentConfig.Common.DbVariables).forEach((dbVar) => {
                if (dbVar !== 'class') {
                    dbVarsOfInterest.push(dbVar);
                }
            });
        }
        if (declaration.Common) {
            Object.keys(declaration.Common).forEach((key) => {
                if (declaration.Common[key].class === 'DbVariables') {
                    Object.keys(declaration.Common[key]).forEach((dbVar) => {
                        if (dbVar !== 'class') {
                            dbVarsOfInterest.push(dbVar);
                        }
                    });
                }
            });
        }

        let provisionedModules = [];
        return Promise.resolve()
            .then(() => this.bigIp.list('/tm/sys/provision'))
            .then((provisioning) => {
                provisionedModules = provisioning
                    .filter((module) => module.level !== 'none')
                    .map((module) => module.name);
            })
            .then(() => this.bigIp.deviceInfo())
            .then((deviceInfo) => {
                this.configId = deviceInfo.machineId;
                this.bigIpVersion = deviceInfo.version;
                return getTokenMap.call(this, deviceInfo);
            })
            .then((tokenMap) => {
                const hostNameRegex = /{{hostName}}/;
                const deviceNameRegex = /{{deviceName}}/;

                // get a list of iControl Rest queries asking for the config items and selecting the
                // properties we want
                return Promise.all(this.configItems
                    .map((configItem) => {
                        if (configItem.requiredModules) {
                            const targetInfo = { version: this.bigIpVersion };
                            if (!checkRequiredModules(configItem.requiredModules, provisionedModules, targetInfo)) {
                                return Promise.resolve(false);
                            }
                        }

                        const query = { $filter: 'partition eq Common' };
                        const selectProperties = getPropertiesOfInterest(configItem.properties);
                        if (selectProperties.length > 0) {
                            query.$select = selectProperties.join(',');
                        }
                        if (configItem.partitions) {
                            // If partitions are expected we do the filtering manually
                            delete query.$filter;
                            query.$select = `${query.$select},partition`;
                        }
                        const encodedQuery = querystring.stringify(query);
                        const listOptions = {};
                        let path = `${configItem.path}?${encodedQuery}`;

                        // do any replacements
                        path = path.replace(hostNameRegex, tokenMap.hostName);
                        path = path.replace(deviceNameRegex, tokenMap.deviceName);

                        if (configItem.silent) {
                            listOptions.silent = configItem.silent;
                        }

                        const requiredFields = configItem.properties
                            .filter((property) => property.required)
                            .reduce((accumulator, current) => {
                                accumulator.push(current.id);
                                return accumulator;
                            }, []);
                        if (requiredFields.length > 0) {
                            listOptions.requiredFields = requiredFields;
                        }

                        return this.bigIp.list(path, null, cloudUtil.SHORT_RETRY, listOptions);
                    }));
            })
            .then((results) => {
                let patchedItem;
                results.forEach((currentItem, index) => {
                    const schemaClass = this.configItems[index].schemaClass;
                    if (this.configItems[index].enforceArray && !Array.isArray(currentItem)) {
                        // Older versions of BIG-IP do not always return an empty array
                        // We love you BIG-IP
                        currentItem = [];
                    }

                    // looks like configItem was skipped in previous step
                    if (currentItem === false) {
                        if (!currentConfig[schemaClass] && classPresent(declaration, schemaClass)) {
                            currentConfig[schemaClass] = {};
                        }

                        return;
                    }

                    if (!schemaClass) {
                        // Simple item that is just key:value - not a larger object
                        Object.keys(currentItem).forEach((key) => {
                            currentConfig[key] = currentItem[key];
                        });
                    } else if (Array.isArray(currentItem)) {
                        if (currentItem.length === 0 && !currentConfig[schemaClass]) {
                            currentConfig[schemaClass] = {};
                        } else {
                            currentItem.forEach((item) => {
                                if (!shouldIgnore(item, this.configItems[index].ignore)
                                    && inPartitions(item, this.configItems[index].partitions)) {
                                    const schemaMerge = this.configItems[index].schemaMerge;

                                    if (schemaClass === 'Route'
                                        && item.partition === 'LOCAL_ONLY') {
                                        item.localOnly = true;
                                    }
                                    delete item.partition; // Must be removed for the diffs

                                    if (schemaClass === 'FirewallPolicy' || schemaClass === 'FirewallAddressList' || schemaClass === 'FirewallPortList') {
                                        patchFirewall.call(this, item);
                                    }

                                    if (schemaClass === 'GSLBMonitor') {
                                        // Must pull the kind before it is removed in removeUnusedKeys()
                                        patchGSLBMonitor.call(this, item);
                                    }

                                    if (schemaClass === 'RoutingBGP') {
                                        patchRoutingBGP.call(this, item);
                                    }

                                    if (schemaClass === 'ManagementRoute') {
                                        patchManagementRoute.call(this, item);
                                    }

                                    patchedItem = removeUnusedKeys.call(this, item, this.configItems[index].nameless);
                                    patchedItem = mapProperties(
                                        patchedItem,
                                        this.configItems[index],
                                        this.bigIpVersion,
                                        configOptions
                                    );

                                    let name = item.name;

                                    if (name.startsWith('/Common/')) {
                                        name = name.split('/Common/')[1];
                                    }

                                    if (schemaClass === 'SnmpTrapDestination') {
                                        patchedItem.name = name;
                                    }

                                    if (schemaClass === 'SnmpUser') {
                                        // Don't update name if configManager is called by inspectHandler
                                        if (!configOptions.translateToNewId) {
                                            patchedItem.name = name;
                                        }
                                    }

                                    if (schemaClass === 'SnmpCommunity') {
                                        // Don't update name if configManager is called by inspectHandler
                                        if (!configOptions.translateToNewId) {
                                            patchedItem.name = name;
                                        }
                                    }

                                    if (schemaClass === 'RemoteAuthRole') {
                                        patchedItem.name = name; // The patchedItem needs its name updated too
                                    }

                                    // Self IPs are so odd that I don't see a generic way to handle this
                                    if (schemaClass === 'SelfIp') {
                                        patchedItem = patchSelfIp.call(this, patchedItem);
                                    }

                                    // Ditto for DB variables
                                    if (schemaClass === 'DbVariables') {
                                        if (dbVarsOfInterest.indexOf(item.name) === -1) {
                                            patchedItem = null;
                                        }
                                    }

                                    if (schemaClass === 'Authentication') {
                                        currentConfig[schemaClass] = patchAuth.call(
                                            this, schemaMerge, currentConfig[schemaClass], patchedItem
                                        );
                                        patchedItem = null;
                                    }

                                    if (schemaClass === 'MAC_Masquerade') {
                                        patchedItem.trafficGroup = name;
                                    }

                                    if (schemaClass === 'GSLBServer') {
                                        patchGSLBServer.call(this, patchedItem, configOptions);
                                    }

                                    if (schemaClass === 'GSLBProberPool') {
                                        patchGSLBProberPool.call(this, patchedItem);
                                    }

                                    if (patchedItem) {
                                        if (!currentConfig[schemaClass]) {
                                            currentConfig[schemaClass] = {};
                                        }
                                        currentConfig[schemaClass][name] = patchedItem;
                                    }

                                    getReferencedPaths.call(
                                        this,
                                        item,
                                        index,
                                        referencePromises,
                                        referenceInfo,
                                        configOptions
                                    );
                                } else if (shouldIgnore(item, this.configItems[index].ignore)) {
                                    if (!currentConfig[schemaClass]) {
                                        currentConfig[schemaClass] = {};
                                    }
                                }
                            });
                        }
                    } else if (!shouldIgnore(currentItem, this.configItems[index].ignore)) {
                        const schemaMerge = this.configItems[index].schemaMerge;

                        patchedItem = removeUnusedKeys.call(
                            this,
                            currentItem,
                            this.configItems[index].nameless
                        );
                        patchedItem = mapProperties(
                            patchedItem,
                            this.configItems[index],
                            this.bigIpVersion,
                            configOptions
                        );
                        if (schemaClass === 'Authentication') {
                            patchedItem = patchAuth.call(
                                this, schemaMerge, currentConfig[schemaClass], patchedItem
                            );
                        }
                        if (schemaClass === 'System') {
                            patchedItem = patchSys.call(
                                this, schemaMerge, currentConfig[schemaClass], patchedItem, configOptions
                            );
                        }
                        if (schemaClass === 'SyslogRemoteServer') {
                            const servers = patchedItem.remoteServers || [];
                            servers.forEach((server) => {
                                if (server.name.includes('/Common/')) {
                                    server.name = server.name.split('/Common/')[1];
                                }
                                patchedItem[server.name] = Object.assign({}, server);
                            });
                            delete patchedItem.remoteServers;
                        }

                        if (schemaClass === 'SSHD') {
                            if (patchedItem.include) {
                                patchSSHD.call(
                                    this,
                                    patchedItem
                                );
                                delete patchedItem.include;
                            }
                        }

                        if (schemaClass === 'HTTPD') {
                            patchHTTPD.call(
                                this,
                                patchedItem
                            );
                        }

                        if (schemaClass === 'Disk' && patchedItem.apiRawValues) {
                            patchedItem = patchedItem.apiRawValues;
                            Object.keys(patchedItem).forEach((item) => {
                                patchedItem[item] = parseInt(patchedItem[item], 10);
                            });
                        }

                        if (schemaClass === 'GSLBGlobals') {
                            patchedItem = patchGSLBGlobals.call(
                                this,
                                patchedItem
                            );
                        }

                        currentConfig[schemaClass] = patchedItem;
                        getReferencedPaths.call(
                            this,
                            currentItem,
                            index,
                            referencePromises,
                            referenceInfo,
                            configOptions
                        );
                    }
                });

                // get any objects that were referenced from the ones we already got
                return Promise.all(referencePromises);
            })
            .then((referencesResults) => {
                referencesResults.forEach((referenceResult, index) => {
                    const property = referenceInfo[index].property;
                    const schemaClass = referenceInfo[index].schemaClass;
                    const name = referenceInfo[index].name;
                    const mergePath = referenceInfo[index].mergePath;
                    const refConfigItem = { properties: referenceInfo[index].properties };

                    let configItem;
                    if (mergePath) {
                        configItem = mergePath.reduce(
                            (item, key) => item[key],
                            currentConfig[schemaClass]
                        );
                    } else if (name) {
                        configItem = currentConfig[schemaClass][name];
                    } else {
                        configItem = currentConfig[schemaClass];
                    }

                    const patchReferences = (reference) => {
                        let patchedItem = removeUnusedKeys.call(this, reference);
                        patchedItem = mapProperties(patchedItem, refConfigItem, this.bigIpVersion, configOptions);
                        return patchedItem;
                    };

                    if (Array.isArray(referenceResult)) {
                        configItem[property] = [];
                        referenceResult.forEach((reference) => {
                            configItem[property].push(patchReferences(reference));
                        });
                    } else {
                        configItem[property] = patchReferences(referenceResult);
                    }
                });

                state.currentConfig = {
                    parsed: true,
                    Common: currentConfig
                };

                if (state.originalConfig && !doState.getOriginalConfigByConfigId(this.configId)) {
                    // This state was saved from a prior version of DO
                    doState.setOriginalConfigByConfigId(this.configId, state.originalConfig);
                }

                const originalConfig = doState.getOriginalConfigByConfigId(this.configId)
                    || state.currentConfig;
                if (!originalConfig.version) {
                    const doVersion = doUtil.getDoVersion();
                    const doVersionStr = `${doVersion.VERSION}-${doVersion.RELEASE}`;
                    originalConfig.version = doVersionStr;
                }

                // Fill in any db vars that we don't currently have in the original config. If
                // a user does not set a db var on the first POST but does on a subsequent POST
                // we need an original value to set it back to if the user does yet another
                // POST with out the variable
                const currentDbVariables = state.currentConfig.Common.DbVariables;
                if (currentDbVariables) {
                    if (!originalConfig.Common.DbVariables) {
                        originalConfig.Common.DbVariables = {};
                    }
                    Object.keys(currentDbVariables).forEach((dbVar) => {
                        if (!originalConfig.Common.DbVariables[dbVar]) {
                            originalConfig.Common.DbVariables[dbVar] = currentDbVariables[dbVar];
                        }
                    });
                }

                const currentDisk = state.currentConfig.Common.Disk;
                if (currentDisk && currentDisk.applicationData && originalConfig.Common) {
                    // We need to update the originalConfig.applicationData in case of rollback.
                    // applicationData cannot be reduced in size, so update if DISK information is
                    // missing or smaller than the currentDisk.
                    if (!originalConfig.Common.Disk
                        || currentDisk.applicationData > originalConfig.Common.Disk.applicationData) {
                        originalConfig.Common.Disk = {
                            applicationData: currentDisk.applicationData
                        };
                    }
                }

                // update originalConfig class defaults with the current provisioned module state
                const currentProvision = state.currentConfig.Common.Provision;
                if (currentProvision && originalConfig.Common) {
                    const provisionState = Object.keys(currentProvision).reduce((result, module) => {
                        if (currentProvision[module] === 'none') {
                            result.deprovisioned.push(module);
                        } else {
                            result.provisioned.push(module);
                        }
                        return result;
                    }, { provisioned: [], deprovisioned: [] });

                    this.configItems.forEach((item) => {
                        const targetInfo = { version: this.bigIpVersion };
                        if (!item.requiredModules
                            || checkRequiredModules(item.requiredModules, provisionState.provisioned, targetInfo)) {
                            // add default empty objects for classes that do not exist
                            originalConfig.Common[item.schemaClass] = originalConfig.Common[item.schemaClass] || {};
                        } else if (item.requiredModules
                            && checkRequiredModules(item.requiredModules, provisionState.deprovisioned, targetInfo)
                            && originalConfig.Common[item.schemaClass]
                            && Object.keys(originalConfig.Common[item.schemaClass]).length === 0) {
                            // remove default empty objects for classes that require de-provisioned module
                            delete originalConfig.Common[item.schemaClass];
                        }
                    });
                }

                // Patch GSLB Prober Pool members after they've been dereferenced
                const currentGSLBProberPool = state.currentConfig.Common.GSLBProberPool;
                if (currentGSLBProberPool) {
                    Object.keys(currentGSLBProberPool).forEach((key) => {
                        (currentGSLBProberPool[key].members || []).forEach((member) => {
                            member.enabled = isEnabledGtmObject(member);
                            delete member.disabled;
                        });
                        (currentGSLBProberPool[key].members || []).sort((a, b) => a.order - b.order);
                    });
                }

                // Patch RoutingBGP neighbor members after they've been dereferenced
                const currentRoutingBgp = state.currentConfig.Common.RoutingBGP;
                const nameId = getMappedId(PATHS.RoutingBGP, 'references.neighborReference', 'name', this.configItems, configOptions);
                Object.keys(currentRoutingBgp || []).forEach((key) => {
                    doUtil.sortArrayByValueString(currentRoutingBgp[key].neighbor, nameId);
                    if (currentRoutingBgp[key].neighbor) {
                        currentRoutingBgp[key].neighbors = JSON.parse(
                            JSON.stringify(currentRoutingBgp[key].neighbor)
                        );
                        delete currentRoutingBgp[key].neighbor;
                    }
                    if (currentRoutingBgp[key].peerGroup) {
                        currentRoutingBgp[key].peerGroups = JSON.parse(
                            JSON.stringify(currentRoutingBgp[key].peerGroup)
                        );
                        delete currentRoutingBgp[key].peerGroup;
                    }
                });

                // Patch GSLB Server virtual servers after they've been dereferenced
                const currentGSLBServer = state.currentConfig.Common.GSLBServer;
                if (currentGSLBServer) {
                    const devicesOptions = Object.assign({}, configOptions, { transformId: 'addresses' });
                    const devicesNameId = getMappedId(PATHS.GSLBServer, 'references.devicesReference', 'name', this.configItems, devicesOptions);
                    const devicesTranslationId = getMappedId(PATHS.GSLBServer, 'references.devicesReference', 'translation', this.configItems, devicesOptions);
                    const serverTranslationId = getMappedId(PATHS.GSLBServer, 'references.virtualServersReference', 'translationAddress', this.configItems, configOptions);
                    const descriptionId = getMappedId(PATHS.GSLBServer, 'references.virtualServersReference', 'description', this.configItems, configOptions);
                    const monitorId = getMappedId(PATHS.GSLBServer, 'references.virtualServersReference', 'monitor', this.configItems, configOptions);
                    Object.keys(currentGSLBServer).forEach((key) => {
                        currentGSLBServer[key].devices = (currentGSLBServer[key].devices || []).map((device) => {
                            const patchedDevice = {};
                            patchedDevice[devicesNameId] = device.addresses[0][devicesNameId];
                            patchedDevice[devicesTranslationId] = device.addresses[0][devicesTranslationId];
                            patchedDevice[descriptionId] = device[descriptionId];
                            return patchedDevice;
                        });
                        (currentGSLBServer[key].virtualServers || []).forEach((virtualServer) => {
                            const splitDestination = virtualServer.destination.split(/(\.|:)(?=[^.:]*$)/);

                            virtualServer.address = splitDestination[0];
                            virtualServer.port = parseInt(splitDestination[2], 10);
                            virtualServer[monitorId] = getGtmMonitorArray(virtualServer[monitorId]);
                            virtualServer.enabled = isEnabledGtmObject(virtualServer);

                            delete virtualServer.disabled;
                            delete virtualServer.destination;

                            if (virtualServer[serverTranslationId] === 'none') {
                                delete virtualServer[serverTranslationId];
                            }
                        });
                    });
                }

                // Patch Firewall Policy rules after they've been dereferenced
                const currentFirewallPolicy = state.currentConfig.Common.FirewallPolicy;
                if (currentFirewallPolicy) {
                    Object.keys(currentFirewallPolicy).forEach((key) => {
                        (currentFirewallPolicy[key].rules || []).forEach(filterFirewallRuleProps);
                    });
                }

                // Patch Management IP Firewall rules after they've been dereferenced
                const currentManagementIpFirewall = state.currentConfig.Common.ManagementIpFirewall;
                if (currentManagementIpFirewall) {
                    (currentManagementIpFirewall.rules || []).forEach(filterFirewallRuleProps);
                }

                // Tunnels and VXLAN profiles are already combined in the Common.Tunnel object
                // Note: To possibly improve this, initially we could keep Tunnels and VXLAN profiles
                // separate, then just ignore VXLAN profiles in the diffing process
                const currentTunnels = state.currentConfig.Common.Tunnel;
                if (currentTunnels) {
                    const tunnels = Object.keys(currentTunnels);
                    const deleteAfter = [];
                    tunnels.forEach((name) => {
                        if (currentTunnels[`${name}_vxlan`]) {
                            // This will add VXLAN properties to a Tunnel object for later diffing
                            patchVxlanTunnels.call(this, currentTunnels[name],
                                currentTunnels[`${name}_vxlan`], configOptions.translateToNewId);
                        } else if (currentTunnels[name].encapsulationType) {
                            // encapsulationType is unique to VXLAN profiles, so we can use it to
                            // identify a VXLAN profile from a Tunnel. We need to remove the VXLAN
                            // profiles from Tunnel object, so they do NOT show up in the diff
                            deleteAfter.push(name);
                        }
                    });
                    // Remove pointless VXLAN profiles from tunnel object to fix diff
                    deleteAfter.forEach((name) => { delete currentTunnels[name]; });
                }

                doState.setOriginalConfigByConfigId(this.configId, originalConfig);
                state.originalConfig = originalConfig;

                return Promise.resolve();
            })
            .catch((err) => {
                logger.severe(`Error getting current config: ${err.message}`);
                return Promise.reject(err);
            });
    }
}

/**
 * Removes keys we don't want from a config item
 *
 * We get some things we don't ask for
 *
 * @param {Object} item - The item to clean up
 * @param {Boolean} nameless - Whether or not to also remove the name property
 */
function removeUnusedKeys(item, nameless) {
    const filtered = {};

    const keysToRemove = ['kind', 'selfLink'];

    if (nameless) {
        keysToRemove.push('name');
    }

    Object.assign(filtered, item);
    const removeReferencesAndKeysToRemove = function (obj) {
        Object.keys(obj).forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                if (key.endsWith('Reference')) {
                    delete obj[key];
                } else if (keysToRemove.indexOf(key) !== -1) {
                    delete obj[key];
                } else if (typeof obj[key] === 'object') {
                    removeReferencesAndKeysToRemove(obj[key]);
                }
            }
        });
        return obj;
    };
    return removeReferencesAndKeysToRemove(filtered);
}

/**
 * Gets the property names we want to ask iControl REST to select in our queries
 *
 * @param {Object[]} initialProperties - Array of configItem properties to select
 */
function getPropertiesOfInterest(initialProperties) {
    const requiredProperties = ['name'];
    const properties = initialProperties ? initialProperties.slice() : [];
    const propertyNames = properties.reduce((acc, curr) => {
        acc.push(curr.id);
        return acc;
    }, []);

    // make sure we're getting properties we always need
    requiredProperties.forEach((requiredProp) => {
        if (propertyNames.indexOf(requiredProp) === -1) {
            propertyNames.push(requiredProp);
        }
    });
    return propertyNames;
}

/**
 * Map what needs to be mapped.
 *
 * For example, map 'enabled' to true
 *
 * @param {Object} item - The item (typically the item is coming from bigip) whose properties to map
 * @param {Object} configItem - The configItem object that contains the properties to map
 * @param {String} bigIpVersion - The current BIG-IP version
 * @param {Object} [options] - Optional parameters
 * @param {Boolean} [options.translateToNewId] - Set property names to the value in 'newId' if there is one.
 *                                               Default false.
 */
function mapProperties(item, configItem, bigIpVersion, options) {
    const mappedItem = {};
    Object.assign(mappedItem, item);

    // If we're just interested in one value, return that (Provision values, for example)
    if (configItem.singleValue) {
        return mappedItem[configItem.properties[0].id];
    }

    configItem.properties.forEach((property) => {
        let hasVal = false;

        if (property.minVersion && cloudUtil.versionCompare(property.minVersion, bigIpVersion) > 0) {
            return;
        }

        // map truth/falsehood (enabled/disabled, for example) to booleans
        if (property.truth !== undefined) {
            // for certain items we don't want to add prop with default falsehood value if prop doesn't exist
            if (typeof mappedItem[property.id] !== 'undefined' || !property.skipWhenOmitted) {
                mappedItem[property.id] = mapTruth(mappedItem, property, options);
            }
        }

        if (typeof mappedItem[property.id] !== 'undefined') {
            // If property is a reference, strip the /Common if it is there
            // Either the user specified it without /Commmon in their declaration
            // or we replaced the user value with just the last part because it looks
            // like a json pointer.
            // retainCommon is a configItems property that prevents the removal of Common from the
            // id. This was used in GSLBServer.monitor so it would line up with the BIG-IP
            if (typeof mappedItem[property.id] === 'string'
                && mappedItem[property.id].startsWith('/Common/')
                && !property.retainCommon) {
                mappedItem[property.id] = mappedItem[property.id].substring('/Common/'.length);
            }

            if (property.transform) {
                const transformProperty = function (currentProperty) {
                    if (Array.isArray(currentProperty) && !property.transformAsArray) {
                        // Iterate through currentProperty to convert subobjects
                        const output = currentProperty.map((prop) => transformProperty(prop));
                        return output;
                    }

                    const newProperty = {};
                    property.transform.forEach((trans) => {
                        let value = currentProperty[trans.id];

                        if (trans.capture) {
                            // The capture property is a regex that is grouping in a way that puts
                            // the desired value at the end of the match.
                            const match = currentProperty[trans.captureProperty].match(trans.capture);

                            if (match === null) {
                                return;
                            }

                            value = match.pop();
                        }

                        if (trans.extract) {
                            if (property.transformAsArray) {
                                value = currentProperty.map((prop) => prop[trans.extract]);
                            } else {
                                value = currentProperty[trans.extract];
                            }
                        }

                        if (trans.removeKeys) {
                            doUtil.deleteKeys(value, trans.removeKeys);
                        }

                        if (trans.truth !== undefined) {
                            value = mapTruth(currentProperty, trans, options);
                        }

                        if (options.translateToNewId && trans.newId) {
                            newProperty[trans.newId] = value;
                        } else {
                            newProperty[trans.id] = value;
                        }
                    });
                    return newProperty;
                };

                const transformed = transformProperty(mappedItem[property.id]);
                if (!property.transformAsArray) {
                    mappedItem[property.id] = transformed;
                } else {
                    // when transforming an array, we can only do one property for now
                    mappedItem[property.id] = transformed[property.transform[0].id];
                }
            }
            hasVal = true;
        } else if (property.defaultWhenOmitted !== undefined) {
            mappedItem[property.id] = property.defaultWhenOmitted;
            hasVal = true;
        }

        if (hasVal && property.stringToInt) {
            mappedItem[property.id] = parseInt(mappedItem[property.id], 10);
        }

        if (options.translateToNewId && hasVal && property.newId !== undefined) {
            mapNewId(mappedItem, property.id, property.newId);
        }
    });

    return mappedItem;
}

/**
 * Maps a new id in a config item to the id from iControl REST
 *
 * @param {Object} mappedItem - The item we are maaping the id for
 * @param {String} id - The id in the iControl REST object
 * @param {String} newId - The new name for the id
 */
function mapNewId(mappedItem, id, newId) {
    if (newId.indexOf('.') > 0) {
        // If the newId contains a '.', then map it into an object. In other words,
        // if id is 'myId' and newId is 'outer.inner', and and mappedItem.myId = foo
        // create this in the mappedItem:
        //     mappedItem: {
        //          outer: {
        //              inner: 'foo'
        //          }
        //     }
        const parts = newId.split('.');

        parts.reduce((acc, cur, idx) => {
            if (idx !== parts.length - 1) {
                if (!acc[cur]) {
                    acc[cur] = {};
                }
                return acc[cur];
            }

            acc[parts[idx]] = mappedItem[id];
            return acc;
        }, mappedItem);
    } else {
        mappedItem[newId] = mappedItem[id];
    }
    delete mappedItem[id];
}

/**
 * Maps things like 'enabled/disabled' to true/false
 *
 * @param {Object} item - The config item
 * @param {Object} property - The property to map
 * @param {Object} [options] - Optional parameters
 * @param {Boolean} [options.translateToNewId] - Set property names to the value in 'newId' if there is one.
 *                                               Default false.
 *
 * @returns {Boolean} Whether or not the property value represents truth
 */
function mapTruth(item, property, options) {
    if (options.translateToNewId) {
        if (!item[property.id]) {
            return false;
        }
        return item[property.id] === property.truth;
    }
    return item[property.id] || property.falsehood;
}

/**
 * Maps objects that have separate paths in mcp but need to be part of a DO class
 * as a property that is of type object
 *
 * @param {Object} obj - The parent/target obj
 * @param {Object} value - The value to assign
 * @param {Object} opts - The schemaMerge options
 *   opts would be:
     *     {
     *         path: <array_containing_property_path>,
     *         action: <override_if_not_direct_assign_of_value>
     *         skipWhenOmitted: <do_not_add_to_parent_when_missing>
     *     }
 * @returns {Object} A merged object containing the property with value specified
 */
function mapSchemaMerge(obj, value, opts) {
    const isOmitted = typeof value === 'undefined' || Object.keys(value).length === 0;
    if (opts.skipWhenOmitted && isOmitted) {
        return obj;
    }
    if (typeof opts.path === 'undefined') {
        opts.path = [];
    }

    const pathProps = opts.path.slice(0);
    const key = pathProps.pop();
    const pointer = pathProps.reduce((acc, curr) => {
        if (typeof acc[curr] === 'undefined') {
            acc[curr] = {};
        }
        return acc[curr];
    }, obj);
    // default action would be replace
    if (opts.action === 'add') {
        if (key === undefined) {
            Object.keys(value).forEach((assignKey) => {
                if (Object.prototype.hasOwnProperty.call(pointer, assignKey)) {
                    throw new Error(`Cannot overwrite property in a schema merge '${assignKey}'`);
                } else {
                    pointer[assignKey] = value[assignKey];
                }
            });
            return obj;
        }
        if (typeof pointer[key] === 'undefined') {
            pointer[key] = {};
        }
        pointer[key] = Object.assign(pointer[key], value);
    } else {
        if (key === undefined) {
            return value;
        }
        pointer[key] = value;
    }
    return obj;
}

// given an item and its index in configItems, construct a path based the properties we want
// and on the link given to us in the reference in the iControl REST object
function getReferencedPaths(item, index, referencePromises, referenceInfo, options) {
    Object.keys(item).forEach((property) => {
        const configItem = this.configItems[index];
        if (configItem.references && configItem.references[property] && item[property].link) {
            const parsed = url.parse(item[property].link);
            const query = querystring.parse(parsed.query);
            const selectProperties = getPropertiesOfInterest(configItem.references[property]);
            if (selectProperties.length > 0) {
                query.$select = selectProperties.join(',');
            }
            const encodedQuery = querystring.stringify(query);
            let path = `${parsed.pathname}?${encodedQuery}`;
            if (path.startsWith('/mgmt')) {
                path = path.substring('/mgmt'.length);
            }

            // trim off 'Reference' from the property name to get the name for the unreferenced property
            const regex = /^(.+)Reference$/;
            const trimmedPropertyName = regex.exec(property)[1];
            let newId;
            if (options.translateToNewId) {
                newId = (configItem.properties.find((obj) => obj.id === trimmedPropertyName) || {}).newId;
            }
            referencePromises.push(this.bigIp.list(path, null, cloudUtil.SHORT_RETRY));
            referenceInfo.push(
                {
                    property: newId || trimmedPropertyName,
                    schemaClass: configItem.schemaClass,
                    name: item.name,
                    properties: configItem.references[property],
                    mergePath: (configItem.schemaMerge || {}).path
                }
            );
        }
    });
}

/**
 * Gets values we use to replace tokens in configItems.json
 *
 * @param {Object} deviceInfo - The deviceInfo for the BIG-IP.
 *
 * @returns {Promise} A promise which is resolved with the replacement
 *                    map
 *     {
 *         hostName: hostname from global settings
 *         deviceName: device name for the host
 *     }
 */
function getTokenMap(deviceInfo) {
    const hostName = deviceInfo.hostname;
    return this.bigIp.list('/tm/cm/device')
        .then((cmDeviceInfo) => {
            const devices = cmDeviceInfo.filter((device) => device.hostname === hostName);

            if (devices.length === 1) {
                const deviceName = devices[0].name;
                return Promise.resolve(
                    {
                        hostName,
                        deviceName
                    }
                );
            }

            const message = 'Too many devices match our name';
            logger.severe(message);
            return Promise.reject(new Error(message));
        })
        .catch((err) => {
            logger.severe(`Error getting device info for tokens: ${err.message}`);
            return Promise.reject(err);
        });
}

/**
 * Self IPs have a couple oddities that are hard to deal with in a generic fashion
 *
 * - allowService is typically an array. However, if allowService is "default", you can
 * specify either "default" or ["default"] when creating but always get back ["default"]
 * - If allowService is "none", you specify "none" when creating but the returned object
 * just doesn't have the allowService property.
 * - If allowService is "all", you must specify "all" when creating and get back "all".
 *
 * @param {Object} selfIp - Self IP config item
 *
 * @returns A consistent self IP config item
 */
function patchSelfIp(selfIp) {
    const patched = {};
    Object.assign(patched, selfIp);
    if (!patched.allowService) {
        patched.allowService = 'none';
    } else if (Array.isArray(patched.allowService)) {
        if (patched.allowService.length === 1 && patched.allowService[0] === 'default') {
            patched.allowService = 'default';
        }
    }

    return patched;
}

function patchAuth(schemaMerge, authClass, authItem) {
    let patchedClass = {};
    let patchedItem;

    if (!schemaMerge) {
        let type = authItem.type;

        if (type === 'active-directory') {
            type = 'activeDirectory';
        }

        // the props are for the parent Auth class
        patchedClass = Object.assign(patchedClass, authItem);
        patchedClass.enabledSourceType = type;
        delete patchedClass.type;
        return patchedClass;
    }
    // this is going to be for a subclass (e.g. radius, ldap, etc)
    const authClassCopy = !authClass ? {} : Object.assign({}, authClass);

    if (typeof authItem.sslCiphers === 'string') {
        authItem.sslCiphers = authItem.sslCiphers.split(':');
    }

    if (authItem.name && authItem.name.indexOf(RADIUS.SERVER_PREFIX) > -1) {
        // radius servers have name constants
        // note also that serverReferences are returned by iControl as obj instead of array
        if (authItem.name === RADIUS.PRIMARY_SERVER) {
            patchedItem = {
                primary: authItem
            };
            delete patchedItem.primary.name;
        }

        if (authItem.name === RADIUS.SECONDARY_SERVER) {
            patchedItem = {
                secondary: authItem
            };
            delete patchedItem.secondary.name;
        }
    } else {
        patchedItem = Object.assign({}, authItem);
    }

    patchedClass = mapSchemaMerge.call(this, authClassCopy, patchedItem, schemaMerge);
    return patchedClass;
}

function patchSys(schemaMerge, sysClass, sysItem, options) {
    let patchedClass = {};

    // mapping the first object in configItems.json which should not have schemaMerge defined
    if (!schemaMerge) {
        patchedClass = Object.assign(patchedClass, sysItem);
        return patchedClass;
    }

    // mapping the schemaMerge object in configItems.json
    const sysClassCopy = !sysClass ? {} : JSON.parse(JSON.stringify(sysClass));
    const patchedItem = Object.assign({}, sysItem);
    patchedClass = mapSchemaMerge.call(this, sysClassCopy, patchedItem, schemaMerge);
    const idleTimeoutId = getMappedId(PATHS.CLI, 'properties', 'idleTimeout', this.configItems, options);
    if (sysItem[idleTimeoutId] === 'disabled') {
        patchedClass[idleTimeoutId] = 0;
    } else if (typeof sysItem[idleTimeoutId] !== 'undefined') {
        patchedClass[idleTimeoutId] = parseInt(patchedClass[idleTimeoutId], 10) * 60;
    }
    return patchedClass;
}

function patchSSHD(patchedItem) {
    const includes = patchedItem.include.split('\n');
    includes.forEach((i) => {
        const currentInclude = i.split(' ');

        if (currentInclude[0] === 'Ciphers') {
            patchedItem.ciphers = currentInclude[1].split(',');
        }
        if (currentInclude[0] === 'MACs') {
            patchedItem.MACS = currentInclude[1].split(',');
        }
        if (currentInclude[0] === 'LoginGraceTime') {
            patchedItem.loginGraceTime = parseInt(currentInclude[1], 10);
        }
        if (currentInclude[0] === 'MaxAuthTries') {
            patchedItem.maxAuthTries = parseInt(currentInclude[1], 10);
        }
        if (currentInclude[0] === 'MaxStartups') {
            patchedItem.maxStartups = currentInclude[1];
        }
        if (currentInclude[0] === 'Protocol') {
            patchedItem.protocol = parseInt(currentInclude[1], 10);
        }
    });
}

function patchHTTPD(patchedItem) {
    if (patchedItem.sslCiphersuite) {
        patchedItem.sslCiphersuite = patchedItem.sslCiphersuite.split(':');
    }
    if (patchedItem.allow) {
        if (Array.isArray(patchedItem.allow)) {
            // Allow can use 'all' or 'All'. Normalize to 'all'.
            patchedItem.allow = patchedItem.allow.map((item) => (item === 'All' ? 'all' : item));
        }
    } else {
        patchedItem.allow = 'none';
    }
}

function patchGSLBGlobals(patchedItem) {
    // Will eventually want schemaMerge for global-settings not in /general.
    // Update: configItems has schemaMerge for this class but it's not used in configManager yet,
    // only in parserUtil
    const patchedClass = {};
    patchedClass.general = {};
    Object.assign(patchedClass.general, patchedItem);
    return patchedClass;
}

function patchGSLBServer(patchedItem, options) {
    const monitorId = getMappedId(PATHS.GSLBServer, 'references.virtualServersReference', 'monitor', this.configItems, options);
    patchedItem[monitorId] = getGtmMonitorArray(patchedItem[monitorId]);
    patchedItem.enabled = isEnabledGtmObject(patchedItem);
    delete patchedItem.disabled;
}

function patchFirewall(item) {
    // Must remove fullPath for the diffs
    delete item.fullPath;
}

function patchGSLBMonitor(item) {
    // Pull the monitorType from kind before kind is deleted
    item.monitorType = item.kind.split(':')[3];
}

function patchGSLBProberPool(patchedItem) {
    patchedItem.enabled = isEnabledGtmObject(patchedItem);
    delete patchedItem.disabled;
}

/**
 * Renames deeply nested 'name' property to 'routingProtocol'
 *
 * @param {Object} patchedItem - config item that needs patching
 */
function patchRoutingBGP(patchedItem) {
    (patchedItem.addressFamily || []).forEach((family) => {
        (family.redistribute || []).forEach((redist) => {
            if (redist.name) {
                redist.routingProtocol = redist.name;
                delete redist.name;
            }
        });
    });
}

/**
 * Determines the name from the fullPath.
 *
 * For management routes that have a / in the name, iControl REST returns
 * the name as just the part after the /. What we want is everything after /Common
 *
 * @param {Object} patchedItem - config item that needs patching
 */
function patchManagementRoute(patchedItem) {
    patchedItem.name = patchedItem.fullPath.split('/Common/')[1];
    delete patchedItem.fullPath;
}

/**
 * Combines vxlan profiles into the tunnel object and set tunnelType to vxlan
 *
 * @param {Object} item - config for the tunnel
 * @param {object} vxlan - config for the vxlan profile
 */
function patchVxlanTunnels(item, vxlan, translateToNewId) {
    if (!vxlan) { return; }

    // The name is determined by the tunnel name and so does NOT need retained
    delete vxlan.name;

    // The profile or tunnelType is always vxlan
    if (translateToNewId) {
        item.tunnelType = 'vxlan';
    } else {
        item.profile = 'vxlan';
    }

    mapSchemaMerge.call(this, item, vxlan, { action: 'add' });
}

/**
 * GTM objects have both enabled and disabled properties
 * instead of one prop with boolean value
 * @public
 * @param {object} obj - object that contains the enabled/disabled props
 * @returns {boolean} - true if enabled, otherwise false
 */
function isEnabledGtmObject(obj) {
    let isEnabled;

    if (typeof obj.enabled === 'boolean') {
        isEnabled = obj.enabled;
    } else if (typeof obj.disabled === 'boolean') {
        isEnabled = !obj.disabled;
    } else if (typeof obj.enabled === 'string') {
        isEnabled = obj.enabled.toLowerCase() === 'true';
    } else if (typeof obj.disabled === 'string') {
        isEnabled = obj.disabled.toLowerCase() === 'false';
    } else {
        isEnabled = true;
    }
    return isEnabled;
}

function getGtmMonitorArray(monitorString) {
    // Convert monitors from BIG-IP string to declaration compatible array, for diffing
    return monitorString ? monitorString.split(' and ') : [];
}

function filterFirewallRuleProps(rule) {
    const allowedSourceKeys = ['vlans', 'addressLists', 'portLists'];
    const allowedDestinationKeys = ['addressLists', 'portLists'];

    const filter = (obj, allowedKeys) => Object.keys(obj)
        .filter((objKey) => allowedKeys.indexOf(objKey) > -1)
        .reduce((newObj, objKey) => {
            newObj[objKey] = obj[objKey];
            return newObj;
        }, {});

    rule.source = filter(rule.source, allowedSourceKeys);
    rule.destination = filter(rule.destination, allowedDestinationKeys);
}

function shouldIgnore(item, ignoreList) {
    if (!ignoreList) {
        return false;
    }

    const match = ignoreList.find((ignoreInfo) => {
        const property = Object.keys(ignoreInfo)[0];
        const regex = new RegExp(ignoreInfo[property]);
        if (item[property] && regex.test(item[property])) {
            return true;
        }
        return false;
    });

    return !!match;
}

function inPartitions(item, partitionList) {
    // If the configItem has no partitionList, then it was filtered by the query so just continue
    if (!partitionList || partitionList.indexOf(item.partition) > -1) {
        return true;
    }

    return false;
}

function classPresent(declaration, className) {
    return declaration.Common
        && Object.keys(declaration.Common).find((key) => declaration.Common[key].class === className);
}

/**
 * Returns 'newId' field for a config item property if present and asked for in options
 *
 * @param {String} configPath - The path of the config item
 * @param {String} propertyPath - The path to the property in the config item
 *                                (for example, 'properties' or 'references.someRef')
 * @param {String} id - The id of the property
 * @param {Object} configItems - The configItems data
 * @param {Object} options - Options for getting the id
 * @param {Boolean} [options.translateToNewId] - Whether or not to return the 'id' or 'newId'
 * @param {String} [options.transformId] - Properties to find are inside a property with id === transformId
 *                                         in a field called 'transform'
 */
function getMappedId(configPath, propertyPath, id, configItems, options) {
    if (!options.translateToNewId) {
        return id;
    }

    const configItem = configItems.find((ci) => ci.path === configPath);
    if (!configItem) {
        return id;
    }

    let properties = doUtil.getDeepValue(configItem, propertyPath);
    if (!properties) {
        return id;
    }

    if (options.transformId) {
        properties = properties.find((prop) => prop.id === options.transformId).transform;
    }

    const property = properties.find((prop) => prop.id === id);
    if (!property) {
        return id;
    }

    if (!property.newId) {
        return id;
    }

    return property.newId;
}

/**
 * Filters required modules based on target BIG-IP info and checks if all filtered modules
 * can be found in the list of current modules. Returns true if all modules are found.
 *
 * @param {Object[]} requiredModules - The required modules
 * @param {string[]} currentModules - The list of modules to search through
 * @param {Object} targetInfo - Info about the target machine to use for filtering
 * @param {string} targetInfo.version - The version of the machine
 *
 * @returns {boolean} True if all required modules are found in the list of current modules
 */
function checkRequiredModules(requiredModules, currentModules, targetInfo) {
    return requiredModules
        .filter((requiredModule) => {
            const maxVersion = requiredModule.maxVersion;

            if (maxVersion) {
                const maxVersionLength = maxVersion.split('.').length;
                // Truncate targetInfo version when comparing against maxVersion
                const version = targetInfo.version.split('.').slice(0, maxVersionLength).join('.');

                if (cloudUtil.versionCompare(version, maxVersion) > 0) {
                    return false;
                }
            }

            return true;
        })
        .map((requiredModule) => requiredModule.module)
        .every((module) => currentModules.indexOf(module) > -1);
}

module.exports = ConfigManager;
