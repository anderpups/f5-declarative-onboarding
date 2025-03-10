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

/**
 * Constants used across two or more files
 *
 * @module
 */
module.exports = {
    BASE_URL: 'https://localhost/mgmt/shared/declarative-onboarding',
    MASK_REGEX: new RegExp('pass(word|phrase)|secret|privateKey', 'i'),
    ENDPOINT_MAX_TIMEOUT: 60000,
    ENDPOINTS: {
        CONFIG: 'config',
        INFO: 'info',
        INSPECT: 'inspect',
        TASK: 'task'
    },
    PATHS: {
        Analytics: '/tm/analytics/global-settings',
        AuthLdap: '/tm/auth/ldap',
        AuthPartition: '/tm/auth/partition',
        AuthRadius: '/tm/auth/radius',
        AuthRadiusServer: '/tm/auth/radius-server',
        AuthRemoteUser: '/tm/auth/remote-user',
        AuthRemoteRole: '/tm/auth/remote-role/role-info',
        AuthSource: '/tm/auth/source',
        AuthTacacs: '/tm/auth/tacacs',
        CLI: '/tm/cli/global-settings',
        DagGlobals: '/tm/net/dag-globals',
        DeviceGroup: '/tm/cm/device-group',
        DNS: '/tm/sys/dns',
        DNS_Resolver: '/tm/net/dns-resolver',
        FirewallPolicy: '/tm/security/firewall/policy',
        FirewallAddressList: '/tm/security/firewall/address-list',
        FirewallPortList: '/tm/security/firewall/port-list',
        GSLBDataCenter: '/tm/gtm/datacenter',
        GSLBGeneral: '/tm/gtm/global-settings/general',
        GSLBMonitor: '/tm/gtm/monitor',
        GSLBProberPool: '/tm/gtm/prober-pool',
        GSLBServer: '/tm/gtm/server',
        HTTPD: '/tm/sys/httpd',
        ManagementDHCPConfig: '/tm/sys/management-dhcp/sys-mgmt-dhcp-config',
        ManagementIp: '/tm/sys/management-ip',
        ManagementIpFirewall: '/tm/security/firewall/management-ip-rules',
        ManagementRoute: '/tm/sys/management-route',
        NTP: '/tm/sys/ntp',
        Route: '/tm/net/route',
        RouteDomain: '/tm/net/route-domain',
        RouteMap: '/tm/net/routing/route-map',
        RoutingAccessList: '/tm/net/routing/access-list',
        RoutingAsPath: '/tm/net/routing/as-path',
        RoutingBGP: '/tm/net/routing/bgp',
        RoutingPrefixList: '/tm/net/routing/prefix-list',
        SelfIp: '/tm/net/self',
        SnmpAgent: '/tm/sys/snmp',
        SnmpCommunity: '/tm/sys/snmp/communities',
        SnmpTrapDestination: '/tm/sys/snmp/traps',
        SnmpTrapEvents: '/tm/sys/snmp',
        SnmpUser: '/tm/sys/snmp/users',
        SoftwareUpdate: '/tm/sys/software/update',
        SSHD: '/tm/sys/sshd',
        SSLCert: '/tm/sys/file/ssl-cert',
        SSLKey: '/tm/sys/file/ssl-key',
        SysGlobalSettings: '/tm/sys/global-settings',
        Syslog: '/tm/sys/syslog',
        TrafficControl: '/tm/ltm/global-settings/traffic-control',
        TrafficGroup: '/tm/cm/traffic-group',
        Trunk: '/tm/net/trunk',
        Tunnel: '/tm/net/tunnels/tunnel',
        UnixRm: '/tm/util/unix-rm',
        Uploads: '/shared/file-transfer/uploads',
        User: '/tm/auth/user',
        VLAN: '/tm/net/vlan',
        VXLAN: '/tm/net/tunnels/vxlan'
    },
    STATUS: {
        STATUS_OK: 'OK',
        STATUS_ERROR: 'ERROR',
        STATUS_ROLLING_BACK: 'ROLLING_BACK',
        STATUS_RUNNING: 'RUNNING',
        STATUS_REBOOTING: 'REBOOTING',
        STATUS_REVOKING: 'REVOKING',
        STATUS_REBOOTING_AND_RESUMING: 'REBOOTING_AND_RESUMING'
    },
    EVENTS: {
        LICENSE_WILL_BE_REVOKED: 'DO_LICENSE_WILL_BE_REVOKED',
        READY_FOR_REVOKE: 'DO_READY_FOR_REVOKE',
        REBOOT_NOW: 'DO_REBOOT_NOW',
        TRACE_CONFIG: 'TRACE_CONFIG',
        TRACE_DIFF: 'TRACE_DIFF'
    },
    NAMELESS_CLASSES: [
        'DbVariables',
        'DNS',
        'NTP',
        'License',
        'Provision',
        'ConfigSync',
        'FailoverUnicast',
        'FailoverMulticast',
        'DeviceTrust',
        'Analytics',
        'Authentication',
        'RemoteAuthRoles',
        'SnmpAgent',
        'SnmpTrapEvents',
        'DagGlobals',
        'System',
        'TrafficControl',
        'HTTPD',
        'SSHD',
        'Disk',
        'MirrorIp',
        'GSLBGlobals',
        'ManagementIpFirewall'
    ],
    AUTH: {
        SUBCLASSES_NAME: 'system-auth'
    },
    RADIUS: {
        SERVER_PREFIX: 'system_auth_name',
        PRIMARY_SERVER: 'system_auth_name1',
        SECONDARY_SERVER: 'system_auth_name2'
    },
    LDAP: {
        CA_CERT: 'do_ldapCaCert.crt',
        CLIENT_CERT: 'do_ldapClientCert.crt',
        CLIENT_KEY: 'do_ldapClientCert.key'
    }
};
