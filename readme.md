[![Node.js Package](https://github.com/vtulluru/node-red-contrib-oracledb-mod/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/vtulluru/node-red-contrib-oracledb-mod/actions/workflows/npm-publish.yml)

  

# node-red-contrib-oracledb-mod

  

Robust, modern, and easy-to-use Node-RED nodes for interacting with Oracle Database.

  

This module provides a stable connection to Oracle, supporting queries, DML, stored procedures, and advanced data binding, all handled through a resilient connection pool.

  

## Prerequisites

  

Before using this node, you **must** have the **Oracle Instant Client** libraries installed on the same machine that is running Node-RED.

  

1.  **Download:** Get the Instant Client "Basic" or "Basic Light" package for your operating system from the [Oracle Instant Client Downloads Page](https://www.oracle.com/database/technologies/instant-client/downloads.html).

2.  **Install:** Unzip the package to a permanent location on your system (e.g., `/opt/oracle/instantclient_21_13` on Linux, `C:\oracle\instantclient_21_13` on Windows).

3.  **Configure Environment:** Node.js needs to know where to find these libraries.

*  **Linux:** Add the path to the `LD_LIBRARY_PATH` environment variable.

*  **Windows:** Add the path to the `PATH` system environment variable.

*  **macOS:** Add the path to the `DYLD_LIBRARY_PATH` environment variable.

4. In the node's configuration, you must provide the path to this directory in the **Instant Client Path** field. *This directly addresses GitHub issue #52.*

  

## Installation

  

Install via the Node-RED Palette Manager or run the following command in your Node-RED user directory (typically `~/.node-red`):

```bash

npm  install  node-red-contrib-oracledb-mod

```

  

## Features

  

-  **Resilient Connection Pooling:** Automatically manages a pool of connections to handle idle timeouts, network disconnects, and database restarts, ensuring your flows are always ready.

-  **Execute SQL and PL/SQL:** Run `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and anonymous PL/SQL blocks.

-  **Stored Procedures & Functions:** Full support for calling stored procedures and functions with `IN`, `OUT`, and `INOUT` parameters using `msg.bindVars`.

-  **Flexible Result Handling:** Choose whether to get all rows at once, stream large result sets, or get metadata like the number of rows affected by a DML statement.

-  **Configurable Connections:** Connect using Classic (`host:port/db`) or TNS Name, with configurable connection pool settings.

-  **Built-in Examples:** Comes with an importable example flow for calling stored procedures.

  

## Node Usage

  

### 1. `oracle-server` (Configuration Node)

  

This node configures the connection to your database. Using the **Connection Pool** is highly recommended for all use cases.

  

-  **Connection Type:** Choose "Classic" for host/port/db or "TNS Name" for using a `tnsnames.ora` entry.

-  **Instant Client Path:** The local filesystem path to your Oracle Instant Client installation.

-  **Connection Pool:**

-  **Min/Max Connections:** Control the size of the connection pool.

-  **Idle Timeout (s):** How long an idle connection can live in the pool before being terminated. This is key to preventing errors from firewalls closing idle connections.

  

### 2. `oracledb` (Query Node)

  

This node executes the query and sends the results.

  

#### **Common Use Cases**

  

**Use Case 1: Simple `SELECT` Query**

- Set `msg.query` to `SELECT * FROM employees WHERE department_id = :1`.

- Set `msg.payload` to `[50]`.

- Set the **Action** to `send single query result message`.

-  **Output:**  `msg.payload` will be an array of employee objects.

  

**Use Case 2: `INSERT` or `UPDATE` and Get Rows Affected**

- Set `msg.query` to `UPDATE employees SET salary = salary * 1.1 WHERE department_id = :1`.

- Set `msg.payload` to `[50]`.

- Set the **Action** to `send single message with metadata`.

-  **Output:**  `msg.payload` will be an object like `{ rowsAffected: 10, ... }`. *This addresses GitHub issues #3, #53, and #35.*

  

**Use Case 3: Calling a Stored Procedure with an `OUT` Parameter**

- Set `msg.query` to `BEGIN get_employee_name(:emp_id, :emp_name); END;`.

- Set `msg.bindVars` as shown below.

- Set the **Action** to `send single message with metadata`.

-  **Output:**  `msg.payload.outBinds.emp_name` will contain the returned name. *This addresses GitHub issue #6 and #34.*

  

```javascript

// Example for msg.bindVars

msg.bindVars = {

emp_id: { dir:  "BIND_IN", val:  101, type:  "NUMBER" },

emp_name: { dir:  "BIND_OUT", type:  "STRING" }

};

```

> For a full list of bind parameter types and directions, see the [official node-oracledb documentation](https://node-oracledb.readthedocs.io/en/latest/user_guide/bind.html).

  

## Executing Multiple Statements (Scripts)

  

The Oracle driver executes one SQL statement or one PL/SQL block at a time. You cannot send a script with multiple statements separated by semicolons (`;`) in a single query. This will result in an `ORA-00933` error.

  

There are two recommended ways to run multiple commands:

  

### 1. For Transactional Scripts (INSERT, UPDATE, DELETE)

  

The best practice is to wrap your statements in a single PL/SQL `BEGIN...END;` block. This ensures all commands are executed together as a single, atomic transaction.

  

**Example:**

```sql

BEGIN

UPDATE inventory SET quantity = quantity - 1  WHERE product_id = :p_id;

INSERT INTO order_log (product_id, log_date) VALUES (:p_id, SYSDATE);

END;

```

  

### 2. For Sequential Queries

  

If you need to run multiple independent queries, especially `SELECT` statements, the standard Node-RED approach is to chain multiple `oracledb` nodes in your flow.

  

**Example Flow:**

  

`Inject` → `[ oracledb (SELECT from table A) ]` → `[ oracledb (SELECT from table B) ]` → `...`

  

## What's New in Version 0.7.3

  

This is a major stability and modernization release.

  

-  **Resilient Connections:** The node now uses a robust **Connection Pool**, which resolves numerous issues related to idle timeouts, network disconnects, and stale connections.

-  **Added Metadata Result Option:** The "single-meta" action has been re-introduced to get the number of `rowsAffected` from DML statements or `outBinds` from procedures.

-  **Improved Error Handling:** The entire backend has been refactored to use modern `async/await`, providing clearer error messages and preventing Node-RED crashes.

-  **UI and Documentation Overhaul:** The configuration UI and help text have been significantly improved for clarity and ease of use.

-  **Modernized Tooling:** The development toolchain has been upgraded to modern standards.

-  **Added Examples:** A built-in example flow for stored procedures is now included.

  

[View more commits and changelog](https://github.com/vtulluru/node-red-contrib-oracledb-mod/commits)