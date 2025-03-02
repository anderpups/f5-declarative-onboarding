#!/bin/bash

set -e

IPS_ARRAY=($(echo $BIGIPS_ADDRESSES))

echo '[' | tr -d '\n'
for i in "${IPS_ARRAY[@]}"
do
    jq -n \
        --arg ip "$i" \
        --arg admin_password "$INTEGRATION_ADMIN_PASSWORD" \
        --arg root_password "$INTEGRATION_ROOT_PASSWORD" \
        '{ admin_ip: $ip,
           f5_rest_user: { username: "admin",
                           password: $admin_password },
           ssh_user: { username: "root",
                       password: $root_password }
         }' | tr -d '\n'
    if [ "$i" != "${IPS_ARRAY[${#IPS_ARRAY[@]}-1]}" ]
        then echo ','
    fi
done
echo ']'
