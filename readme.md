[![Node.js Package](https://github.com/vtulluru/node-red-contrib-oracledb-mod/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/vtulluru/node-red-contrib-oracledb-mod/actions/workflows/npm-publish.yml)

# node-red-contrib-oracledb-mod

Node-RED Oracle Database nodes
====================================

This Node-RED module provides nodes for interacting with Oracle Database, including support for advanced features such as custom variable binding and stored procedures/functions.

## Features

- **Execute SQL Queries:** Run SELECT, INSERT, UPDATE, DELETE, and custom queries.
- **Stored Procedures / Functions:** Now supports calling Oracle stored procedures and functions with custom input/output variable binding.
- **Flexible Bind Variables:** Use `msg.bindVars` to manually bind variables, including direction and type, for advanced Oracle operations.
- **Automatic or Custom Field Mapping:** Map object fields to array parameters, or use defaults.
- **Multiple Connections:** Connect to multiple Oracle schemas/databases with different credentials.
- **Support for TNS Names and Instant Client Paths.**
- **Automatic Reconnect:** Handles Oracle server disconnects and retries.

## Installation

```bash
npm install node-red-contrib-oracledb-mod
```

## Usage

Add the `oracledb` node to your Node-RED flow and configure your connection.

### Basic Query Example

```json
{
  "payload": [123, "some value"],
  "query": "INSERT INTO my_table(id, name) VALUES(:1, :2)"
}
```

### Calling Stored Procedures or Functions

To execute a stored procedure or function, provide the SQL and manually specify bind variables using `msg.bindVars`:

```javascript
msg.query = "BEGIN :output := example_function(input_param => :input_param); END;";
msg.bindVars = {
    output: { dir: "BIND_OUT", type: "NUMBER" },
    input_param:  { dir: "BIND_IN", type: "STRING", val: input_value }
};
// Send msg to oracledb node
```
If `msg.bindVars` is not provided, automatic binding is performed based on `msg.payload` and `msg.query`.

### Field Mappings

For object-to-array mapping, use `msg.fieldMappings`:

```javascript
msg.fieldMappings = ["id", "name", "email"];
msg.payload = { id: 1, name: "Alice", email: "alice@example.com" };
```

## What's New

### version 0.6.6 (latest)
- **Custom variable binding:** Full support for `msg.bindVars` to allow calling stored procedures and functions.
- **Support for Oracle functions:** Use output and input parameters in PL/SQL blocks.
- **Flexible result retrieval enhancements.**
- **Improved documentation and editor support for mappings and queries.**

### Recent versions (see repo for full changelog)
- Port validation error fixes.
- Dependency updates: `oracledb` upgraded to latest versions.
- Improved connection management and error handling.

[View more commits and changelog](https://github.com/vtulluru/node-red-contrib-oracledb-mod/commits)

## Roadmap

- Further improvements to input/output node flexibility.
- More example flows and documentation.
- Additional error handling and reconnect features.
