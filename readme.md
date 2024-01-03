[![Node.js Package](https://github.com/vtulluru/node-red-contrib-oracledb-mod/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/vtulluru/node-red-contrib-oracledb-mod/actions/workflows/npm-publish.yml)


Node-RED Oracle Database nodes
====================================

Forked version with updated drivers to support latest node versions


`node-red-contrib-oracledb-mod` is a [Node-RED](http://nodered.org/docs/creating-nodes/packaging.html) package that connects directly to an Oracle database server. 
It currently contains a query and a configuration node to connect to Oracle databases for Node-RED storage.

It uses the [oracledb](https://www.npmjs.com/package/oracledb) library for the Oracle database connectivity.


## Table of Contents
- [Installation](#installation)
- [Overview](#overview)
- [Known issues](#knownissues)
- [What's new](#whatsnew)
- [Roadmap](#roadmap)


## Installation     <a name="installation"></a>

If you have installed Node-RED as a global node.js package (you use the command `node-red` anywhere to start it), you need to install
node-red-contrib-oracledb-mod as a global package as well:

```
$[sudo] npm install -g node-red-contrib-oracledb-mod
```

If you have installed the .zip or cloned your own copy of Node-RED from github, you can install it as a normal npm package inside the Node-RED project directory:

```
<path/to/node-red>$ npm install node-red-contrib-oracledb-mod
```

## Overview     <a name="overview"></a>

This is a Node-Red Oracle database input/output node. The function it provides depends on the query that is sent to the oracle database. An INSERT query stores data in the database and a SELECT query can send data to another node.

To get started, you must install an Oracle Instant Client on the server. Follow the [directions](https://github.com/oracle/node-oracledb/blob/master/INSTALL.md#instructions) for your OS and note the path in which you installed the Instant Client. 

If you are going to use a TNS Name (with a "Wallet" connection - such as with Autonomous DB), install your wallet contents in the `/network/admin` subdirectory of your Instant Client. 

## Known issues     <a name="knownissues"></a>
- none

## What's new     <a name="whatsnew"></a>

### version 0.6.5 
Port validation error is reapplied based on comments
Bump oracledb from 6.0.3 to 6.3.0


### version 0.6.4
Bump @types/jquery from 3.5.14 to 3.5.16 by @dependabot in #23
Trigger the catch node on error by @JheSue in #33
Ensure port validation returns boolean by @knolleary in #37
Bump oracledb from 5.5.0 to 6.0.3 by @dependabot in #31
New Contributors
@JheSue made their first contribution in #33
@knolleary made their first contribution in #37
Full Changelog: v0.6.3...v0.6.4

### version 0.6.3
- dependency updates
  Bump del from 6.1.1 to 7.0.0 
  Bump chai from 4.3.6 to 4.3.7
  Bump @types/mocha from 9.1.1 to 10.0.1 
  Bump decode-uri-component from 0.2.0 to 0.2.2
  Bump oracledb from 5.4.0 to 5.5.0
  
- Fix node connection issues with DPI-1010 and DPI-1080

### version 0.6.2
- dependency updates
 oracledb             ^5.1.0  →   ^5.4.0     
 @types/jquery        ^3.5.5  →  ^3.5.14     
 chai                 ^4.2.0  →   ^4.3.6     
 merge2               ^1.3.0  →   ^1.4.1     
 source-map-support  ^0.5.19  →  ^0.5.21

### version 0.6.1
- return original `msg` object with result

### version 0.6.0

- add connection name to allow multiple connections to server using different credentials/schemas
- update to latest node-oracledb
- add support for connections using TNS Names
- add entry for path to instant client on server
- clean up
- Dependencies updated as below
 oracledb             ^4.0.1  →   ^5.1.0

### version 0.5.8
Fixed an issue with initializing bug which cause nod-red to crash
- Dependencies updated as below
  source-map-support  ^0.5.16  →  ^0.5.19
  tslint               ^6.1.0  →   ^6.1.2

### version 0.5.6
- Dependencies updated as below
 oracledb             ^4.0.1  →   ^4.2.0
 gulp-rename          ^1.4.0  →   ^2.0.0
 source-map-support  ^0.5.13  →  ^0.5.16
 tslint              ^5.20.0  →   ^6.1.0

### version 0.4.1
- bugfixes
- added some tests

### version 0.4.0
- added automatic reconnect to oracle server

### version 0.3.0
- added input node functionality for single results and result sets

### version 0.2.0
- major refactor, made preparations for better testable code:
  - javascript source code has been translated to typescript
  - gulp build system added
  - if NODE_RED_ROOT environment variable exists, copy build result into its node-red-contrib-oracledb-mod module for quick testing

### version 0.1.0
- initial release


## Roadmap     <a name="roadmap"></a>

The roadmap section describes things that I want to add or change in the (hopefully near) future.

### Realized
- Make it an input and output node:
  - Add support to return SELECT query results
