.. _gslb-examples:

GSLB Examples
-------------
This section contains examples for GSLB (Global Server Load Balancing), which requires the BIG-IP DNS (formerly GTM) module to be licensed and provisioned.


.. _globalgslb:

Configuring global GSLB settings in a declaration
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.. sidebar:: :fonticon:`fa fa-info-circle fa-lg` Version Notice:

   Support for configuring global GSLB settings in a declaration is available in DO v1.17 and later. 

In this example, we show how you can configure global GSLB settings in DO 1.17 and later using the **GSLBGlobals** class. This class uses the **GSLBGlobals_general** properties (synchronizationEnabled synchronizationGroupName, synchronizationTimeout, and synchronizationTimeTolerance) to configure GSLB global settings on the BIG-IP. 

For more details on the properties and DO usage, see |gslbglobal| and |gslbgen| in the Schema Reference.  

For information on BIG-IP DNS, see the |dns| for your BIG-IP version.

This example only includes the GSLBGlobals class, which can be used as a part of a larger DO declaration.

.. literalinclude:: ../../examples/gslbGlobals.json
   :language: json

|

.. _gslbdc:

Configuring a GSLB Data Center
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.. sidebar:: :fonticon:`fa fa-info-circle fa-lg` Version Notice:

   Support for configuring GSLB Data Centers in a declaration is available in DO v1.18 and later. 

In this example, we show how you can configure a GSLB Data Center in DO 1.18 and later using the **GSLBDataCenter** class. This allows you to configure GSLB Data Center properties in a Declarative Onboarding declaration.

All of the resources on your network are associated with a data center. BIG-IP DNS consolidates the paths and metrics data collected from the servers, virtual servers, and links in the data center. BIG-IP DNS uses that data to conduct load balancing and route client requests to the best-performing resource based on different factors. For information on BIG-IP DNS, including GSLB Data Centers, see the |dns| for your BIG-IP version.

For details on the available properties and DO usage, see |gslbdata| in the Schema Reference.  



This example only includes the GSLBDataCenter class, which can be used as a part of a larger DO declaration.

.. literalinclude:: ../../examples/gslbDataCenter.json
   :language: json

|

.. _gslbserver:

Configuring a GSLB Server
^^^^^^^^^^^^^^^^^^^^^^^^^
.. sidebar:: :fonticon:`fa fa-info-circle fa-lg` Version Notice:

   Support for configuring GSLB Servers in a declaration is available in DO v1.18 and later. |br| Prober pools and GSLB virtual server objects are available in DO 1.19 and later.

In this example, we show how you can configure a GSLB Server in DO 1.18 and later using the **GSLBServer** class. This allows you to configure GSLB Server properties in a Declarative Onboarding declaration.

A GSLB Server defines a physical system on the network. Servers contain the virtual servers that are the ultimate destinations of DNS name resolution requests. For information on BIG-IP DNS, including GSLB Servers, see the |dns| for your BIG-IP version.

DO 1.19 added support for Prober pools and GSLB virtual servers to GSLB Servers. For information on Prober pools, see :ref:`prober`. |br| For information on GSLB virtual servers, see the |gslbvipdoc| chapter of the documentation. For DO options and usage, see |gslbvip|.

For details on the available properties and DO usage, see |gslbserver| in the Schema Reference.  

.. IMPORTANT:: Because this example was updated to include a Prober pool and GSLB virtual servers, if you attempt to use the following declaration on a previous version of DO, it will fail.  If you are using a version prior to 1.19, you can remove the Prober pool and virtual server lines (in yellow). 

.. literalinclude:: ../../examples/gslbServer.json
   :language: json
   :emphasize-lines: 9-11, 28, 44-62

|

.. _gslbmonitors:

Configuring GSLB health monitors
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.. sidebar:: :fonticon:`fa fa-info-circle fa-lg` Version Notice:

   Support for configuring GSLB health monitors is available in DO v1.19 and later. 

In this example, we show how you can configure a GSLB health monitors in a Declarative Onboarding declaration. Health monitors verify the availability and/or performance status of a particular protocol, service, or application.  You can configure HTTP, HTTPS, Gateway-ICMP, TCP, or UDP GSLB health monitors in a declaration.

For information on BIG-IP DNS, including GSLB monitors, see the |dns| for your BIG-IP version.

For details on the available properties and DO usage, see |gslbmon| in the Schema Reference.  

.. NOTE:: GSLB Monitor has a number of built-in monitors, such as **http** and **http_head_f5**. You cannot use these names in a declaration or it will fail.  These default monitors cannot be deleted.  

This example includes each of the available GSLB monitors which you can use as part of a larger Declarative Onboarding declaration.  In this declaration, the monitors are all used in the GSLB Server (see :ref:`the GSLB Server example<gslbserver>`).

.. literalinclude:: ../../examples/gslbMonitor.json
   :language: json

|


.. _prober:

Configuring a GSLB prober pool
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.. sidebar:: :fonticon:`fa fa-info-circle fa-lg` Version Notice:

   Support for configuring GSLB prober pools is available in DO v1.19 and later. 

In this example, we show how you can configure a GSLB prober pool in a Declarative Onboarding declaration. Prober pools contain specific BIG-IP devices that probe data centers and servers.

For more information on Prober pools, including manual configuration, see |proberkb|.

For details on the available properties and DO usage, see |gslbpp| in the Schema Reference.  

.. literalinclude:: ../../examples/gslbProberPool.json
   :language: json

|



.. |dns| raw:: html

   <a href="https://support.f5.com/csp/knowledge-center/software/BIG-IP?module=BIG-IP%20GTM" target="_blank">DNS/GTM knowledge center</a>

.. |gslbglobal| raw:: html

   <a href="https://clouddocs.f5.com/products/extensions/f5-declarative-onboarding/latest/schema-reference.html#gslbglobals" target="_blank">GSLBGlobals</a>

.. |gslbgen| raw:: html

   <a href="https://clouddocs.f5.com/products/extensions/f5-declarative-onboarding/latest/schema-reference.html#gslbglobals-general" target="_blank">GSLBGlobals_general</a>

.. |gslbdata| raw:: html

   <a href="https://clouddocs.f5.com/products/extensions/f5-declarative-onboarding/latest/schema-reference.html#gslbdatacenter" target="_blank">GSLBDataCenter</a>

.. |gslbserver| raw:: html

   <a href="https://clouddocs.f5.com/products/extensions/f5-declarative-onboarding/latest/schema-reference.html#gslbserver" target="_blank">GSLBServer</a>

.. |gslbmon| raw:: html

   <a href="https://clouddocs.f5.com/products/extensions/f5-declarative-onboarding/latest/schema-reference.html#gslbmonitor" target="_blank">GSLBMonitor</a>

.. |proberkb| raw:: html

   <a href="https://support.f5.com/csp/article/K08433560" target="_blank">K08433560: Configuring prober pools</a>

.. |gslbpp| raw:: html

   <a href="https://clouddocs.f5.com/products/extensions/f5-declarative-onboarding/latest/schema-reference.html#gslbproberpool" target="_blank">GSLBProberPool</a>

.. |br| raw:: html
 
   <br />

.. |gslbvip| raw:: html

   <a href="https://clouddocs.f5.com/products/extensions/f5-declarative-onboarding/latest/schema-reference.html#gslbserver-virtualservers" target="_blank">GSLBServer-virtualServers</a>

.. |gslbvipdoc| raw:: html

   <a href="https://techdocs.f5.com/kb/en-us/products/big-ip-dns/manuals/product/big-ip-dns-load-balancing-14-1-0/01.html" target="_blank">Global Server Load Balancing</a>