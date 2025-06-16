module.exports = function (RED) {
  "use strict";
  const oracledb = require("oracledb");
  const resolvePath = require("object-resolve-path");
  const events = require("events");
  const util = require("util");
  oracledb.fetchAsBuffer = [oracledb.BLOB];
  oracledb.fetchAsString = [oracledb.CLOB];

  // Function to transform bind variables
  function transformBindVars(bindVars) {
    const transformed = {};
    for (const key in bindVars) {
      if (Object.prototype.hasOwnProperty.call(bindVars, key)) {
        const bindVar = bindVars[key];
        transformed[key] = {
          dir: oracledb[bindVar.dir],
          type: oracledb[bindVar.type]
        };
        if (bindVar.hasOwnProperty("val")) {
          transformed[key].val = bindVar.val;
        }
      }
    }
    return transformed;
  }

  function initialize(node) {
    if (node.server) {
      if (node.server.pool) {
        node.status({ fill: "green", shape: "dot", text: "connected" });
      } else {
        node.status({ fill: "grey", shape: "dot", text: "unconnected" });
      }

      node.serverStatus = node.server.status;
      node.serverStatus.on("connecting", () => {
        node.status({ fill: "green", shape: "ring", text: "connecting" });
      });
      node.serverStatus.on("connected", () => {
        node.status({ fill: "green", shape: "dot", text: "connected" });
      });
      node.serverStatus.on("closed", () => {
        node.status({ fill: "red", shape: "ring", text: "disconnected" });
      });
      node.serverStatus.on("error", () => {
        node.status({ fill: "red", shape: "dot", text: "connect error" });
      });
    } else {
      node.status({ fill: "red", shape: "dot", text: "error" });
      node.error("Oracle storage error: missing Oracle server configuration");
    }
  }

  function OracleDb(n) {
    const node = this;
    RED.nodes.createNode(node, n);
    node.server = RED.nodes.getNode(n.server);

    node.on("input", (msg) => {
        if (!node.server) {
            node.error("Oracle node is not configured with a server.", msg);
            return;
        }

        const useQuery = n.usequery;
        const query = (useQuery || !msg.query) ? n.query : msg.query;
        const useMappings = n.usemappings;
        const mappings = n.mappings ? JSON.parse(n.mappings) : [];
        const resultAction = msg.resultAction || n.resultaction;
        const resultSetLimit = parseInt(msg.resultSetLimit || n.resultlimit, 10);
        
        let bindVars = null;
        if (msg.bindVars) {
            try {
                bindVars = transformBindVars(msg.bindVars);
            } catch (err) {
                node.error("Error transforming bind variables: " + err.message, msg);
                return;
            }
        } else {
            bindVars = [];
            if (useMappings || (msg.payload && !util.isArray(msg.payload))) {
                for (let i = 0; i < mappings.length; i++) {
                    let value;
                    try {
                        value = resolvePath(msg.payload, mappings[i]);
                    } catch (err) {
                        value = null;
                    }
                    bindVars.push(value);
                }
            } else {
                bindVars = msg.payload;
            }
        }

        node.server.query(msg, node, query, bindVars, resultAction, resultSetLimit);
    });

    initialize(node);
  }

  function OracleServer(n) {
    const node = this;
    RED.nodes.createNode(node, n);
    node.connectionname = n.connectionname || "";
    node.tnsname = n.tnsname || "";
    node.instantclientpath = n.instantclientpath || "";
    node.host = n.host || "localhost";
    node.port = n.port || "1521";
    node.db = n.db || "orcl";
    node.user = node.credentials.user;
    node.password = node.credentials.password;
    node.poolmin = n.poolmin || 0;
    node.poolmax = n.poolmax || 4;
    node.pooltimeout = n.pooltimeout || 60;

    node.pool = null;
    node.status = new events.EventEmitter();
    node.status.setMaxListeners(0);

    async function connect() {
      if (node.pool) return;
      node.status.emit("connecting");
      
      try {
        if (node.instantclientpath) {
          oracledb.initOracleClient({ libDir: node.instantclientpath });
        }
      } catch (err) {
        if (err.message.indexOf("NJS-019") === -1) {
          node.error("Oracle-server error initializing client: " + err.message);
          node.status.emit("error", err);
          return;
        }
      }

      const connectString = node.tnsname ? node.tnsname : `${node.host}:${node.port}/${node.db}`;
      const poolConfig = {
        user: node.user,
        password: node.password,
        connectString: connectString,
        poolMin: node.poolmin,
        poolMax: node.poolmax,
        poolIncrement: 1,
        poolTimeout: node.pooltimeout
      };

      try {
        node.pool = await oracledb.createPool(poolConfig);
        node.status.emit("connected");
        node.log(`Oracle connection pool created for ${connectString}`);
      } catch (err) {
        node.error(`Oracle-server error creating pool for ${connectString}: ${err.message}`);
        node.status.emit("error", err);
      }
    }

    connect();

    node.on("close", async (done) => {
      if (node.pool) {
        try {
          await node.pool.close(10);
          node.pool = null;
          node.status.emit("closed");
          node.log("Oracle connection pool closed.");
        } catch (err) {
          node.error("Error closing Oracle connection pool: " + err.message);
        }
      }
      done();
    });

    node.query = async function (msg, requestingNode, query, bindVars, resultAction, resultSetLimit) {
      if (!node.pool) {
        await connect();
        if (!node.pool) {
            requestingNode.error("Connection pool is not available and could not be created.", msg);
            return;
        }
      }

      // Automatically trim trailing whitespace and remove a trailing semicolon.
      // This is a major usability improvement for users accustomed to SQL clients.
      const finalQuery = query.trim().replace(/;$/, "");

      let connection;
      try {
        connection = await node.pool.getConnection();
        const options = { autoCommit: true, outFormat: oracledb.OBJECT, maxRows: resultSetLimit, resultSet: resultAction === "multi" };
        const result = await connection.execute(finalQuery, bindVars || [], options);

        switch (resultAction) {
          case "single": {
            msg.payload = result.rows;
            requestingNode.send(msg);
            break;
          }
          case "single-meta": {
            msg.payload = {
                rowsAffected: result.rowsAffected,
                metaData: result.metaData,
                outBinds: result.outBinds
            };
            requestingNode.send(msg);
            break;
          }
          case "multi": {
            if (result.resultSet) {
                const resultSet = result.resultSet;
                let rows;
                do {
                    rows = await resultSet.getRows(resultSetLimit);
                    if (rows.length > 0) {
                        const newMsg = RED.util.cloneMessage(msg);
                        newMsg.payload = rows;
                        requestingNode.send(newMsg);
                    }
                } while (rows.length > 0);
                await resultSet.close();
            }
            break;
          }
          case "none":
          default:
            break;
        }
      } catch (err) {
        requestingNode.error(`Oracle query error: ${err.message}`, msg);
        
        const shortError = err.message.split("\n")[0];
        requestingNode.status({ fill: "red", shape: "dot", text: shortError });
        
        // Restore the 'connected' status after the error timeout, not an empty status.
        // This provides better user feedback, showing the connection is still healthy.
        setTimeout(() => {
            requestingNode.status({ fill: "green", shape: "dot", text: "connected" }); 
        }, 5000);
        
      } finally {
        if (connection) {
          try {
            await connection.close();
          } catch (err) {
            requestingNode.error("Error releasing connection: " + err.message);
          }
        }
      }
    };
  }

  RED.nodes.registerType("oracledb", OracleDb);
  RED.nodes.registerType("oracle-server", OracleServer, {
    credentials: { user: { type: "text" }, password: { type: "password" } }
  });
};