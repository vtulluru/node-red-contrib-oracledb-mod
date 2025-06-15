module.exports = function (RED) {
  "use strict";
  var oracledb = require("oracledb");
  var resolvePath = require("object-resolve-path");
  var events = require("events");
  var util = require("util");
  oracledb.fetchAsBuffer = [oracledb.BLOB];
  oracledb.fetchAsString = [oracledb.CLOB];

  // Function to transform bind variables
  function transformBindVars(bindVars) {
    const transformed = {};
    for (const key in bindVars) {
      const bindVar = bindVars[key];
      transformed[key] = {
        dir: oracledb[bindVar.dir],
        type: oracledb[bindVar.type]
      };
      if (bindVar.hasOwnProperty("val")) {
        transformed[key].val = bindVar.val;
      }
    }
    return transformed;
  }

  function initialize(node) {
    if (node.server) {
      node.status({ fill: "grey", shape: "dot", text: "unconnected" });
      node.serverStatus = node.server.status;
      node.serverStatus.on("connecting", function () {
        node.status({ fill: "green", shape: "ring", text: "connecting" });
      });
      node.serverStatus.on("connected", function () {
        node.status({ fill: "green", shape: "dot", text: "connected" });
      });
      node.serverStatus.on("closed", function () {
        node.status({ fill: "red", shape: "ring", text: "disconnected" });
      });
      node.serverStatus.on("error", function () {
        node.status({ fill: "red", shape: "dot", text: "connect error" });
      });
      node.serverStatus.on("reconnecting", function () {
        node.status({ fill: "red", shape: "ring", text: "reconnecting" });
      });
      node.on("close", function () {
        node.server.freeConnection();
      });
    } else {
      node.status({ fill: "red", shape: "dot", text: "error" });
      node.error("Oracle " + node.oracleType + " error: missing Oracle server configuration");
    }
  }
  function OracleDb(n) {
    var node = this;
    RED.nodes.createNode(node, n);
    node.useQuery = n.usequery;
    node.query = n.query;
    node.useMappings = n.usemappings;
    try {
      node.mappings = n.mappings ? JSON.parse(n.mappings) : [];
    } catch (err) {
      node.error("Error parsing mappings: " + err.message);
      node.mappings = [];
    }
    node.resultAction = n.resultaction;
    node.resultLimit = n.resultlimit;
    node.server = RED.nodes.getNode(n.server);
    node.oracleType = "storage";
    node.serverStatus = null;
    node.on("input", function (msg) {

      var bindVars = null;
      if (msg.bindVars) {
        try {
          bindVars = transformBindVars(msg.bindVars);
        } catch (err) {
          node.error("Error transforming bind variables: " + err.message, msg);
          node.status.emit("error", err);
          return;
        }
      } else {
        bindVars = [];
        if (node.useMappings || (msg.payload && !util.isArray(msg.payload))) {
          for (var i = 0; i < node.mappings.length; i++) {
            var value = void 0;
            try {
              value = resolvePath(msg.payload, node.mappings[i]);
            } catch (err) {
              value = null;
            }
            bindVars.push(value);
          }
        } else {
          bindVars = msg.payload;
        }
      }
      var query;
      if (node.useQuery || !msg.query) {
        query = node.query;
      } else {
        query = msg.query;
      }
      var resultAction = msg.resultAction || node.resultAction;
      var resultSetLimit = parseInt(msg.resultSetLimit || node.resultLimit, 10);
      node.server.query(msg, node, query, bindVars, resultAction, resultSetLimit);
    });
    initialize(node);
  }
  function OracleServer(n) {
    var node = this;
    RED.nodes.createNode(node, n);
    node.connectionname = n.connectionname || "";
    node.tnsname = n.tnsname || "";
    node.connectiontype = n.connectiontype || "Classic";
    node.instantclientpath = n.instantclientpath || "";
    node.host = n.host || "localhost";
    node.port = n.port || "1521";
    node.db = n.db || "orcl";
    node.reconnect = n.reconnect;
    node.reconnectTimeout = n.reconnecttimeout || 5000;
    node.connectionInProgress = false;
    node.firstConnection = true;
    node.connection = null;
    node.connectString = "";
    node.queryQueue = [];
    node.user = node.credentials.user || "hr";
    node.password = node.credentials.password || "hr";
    node.status = new events.EventEmitter();
    node.status.setMaxListeners(0);
    node.claimConnection = function () {
      node.log("Connection claim started");
      if (!node.Connection && !node.connectionInProgress) {
        node.connectionInProgress = true;
        if (node.firstConnection) {
          node.status.emit("Connecting with " + node.connectionname);
        } else {
          node.status.emit("Reconnecting with " + node.connectionname);
        }
        if (!node.instantclientpath) {
          node.status.emit("error", "You must set the Instant Client Path!");
          node.error("You must set the Instant Client Path!");
        } else {
          try {
            oracledb.initOracleClient({ libDir: node.instantclientpath });
          } catch (err) {
            // do nothing
          }
        }
        if (node.tnsname) {
          node.connectString = node.tnsname;
        } else {
          node.connectString = node.host + ":" + node.port + (node.db ? "/" + node.db : "");
        }
        node.firstConnection = false;
        oracledb.getConnection({
          user: node.user,
          password: node.password,
          connectString: node.connectString
        }, function (err, connection) {
          node.connectionInProgress = false;
          if (err) {
            node.status.emit("error", err);
            node.error("Oracle-server error connection to " + node.connectString + ": " + err.message);
            if (node.reconnect) {
              node.log("Retry connection to Oracle server in " + node.reconnectTimeout + " ms");
              node.reconnecting = setTimeout(node.claimConnection, node.reconnectTimeout);
            }
          } else {
            node.connection = connection;
            node.status.emit("connected");
            node.log("Connected to Oracle server " + node.connectString);
            node.queryQueued();
            delete node.reconnecting;
          }
        });
      }
      return node.status;
    };
    node.freeConnection = function () {
      if (node.reconnecting) {
        clearTimeout(node.reconnecting);
        delete node.reconnecting;
      }
      if (node.connection) {
        node.connection.release(function (err) {
          if (err) {
            node.error("Oracle-server error closing connection: " + err.message);
          }
          node.connection = null;
          node.status.emit("closed");
          node.status.removeAllListeners();
          node.log("Oracle server connection " + node.connectString + " closed");
        });
      }
    };
    node.query = function (msg, requestingNode, query, bindVars, resultAction, resultSetLimit) {
      bindVars = typeof bindVars === "undefined" ? [] : bindVars;
      requestingNode.log("Oracle query start execution");
      if (node.connection) {
        delete node.reconnecting;
        requestingNode.log("Oracle query execution started");
        var options = {
          autoCommit: true,
          outFormat: oracledb.OBJECT,
          maxRows: resultSetLimit,
          resultSet: resultAction === "multi"
        };
        //node.warn(query);
        //node.warn(bindVars);
        //node.warn(options);
        node.connection.execute(query, bindVars, options, function (err, result) {
          if (err) {
            var errorCode = err.message.slice(0, 9);
            requestingNode.error("Oracle query error: " + err.message + ", errorCode:" + errorCode, msg);
            node.status.emit("error", err);
            requestingNode.log("Checking errors for retry");
            if (errorCode === "DPI-1080:" || errorCode === "DPI-1010:" || errorCode === "ORA-12541" ||
              errorCode === "ORA-12514" || errorCode === "ORA-01109" || errorCode === "ORA-03113" ||
              errorCode === "ORA-03114") {
              node.connection = null;
              if (node.reconnect) {
                requestingNode.log("Oracle server connection lost, retry in " + node.reconnectTimeout + " ms");
                node.status.emit("reconnecting", "Reconnecting to " + node.connectionname);
                node.reconnecting = setTimeout(node.query, node.reconnectTimeout, requestingNode,
                  query, bindVars, resultAction, resultSetLimit);
              }
            }
          } else {
            switch (resultAction) {
              case "single":
                msg.payload = result;
                requestingNode.send(msg);
                requestingNode.log("Oracle query single result rows sent");
                break;
              case "multi":
                node.fetchRowsFromResultSet(msg, requestingNode, result.resultSet, resultSetLimit);
                requestingNode.log("Oracle query multi result rows sent");
                break;
              default:
                requestingNode.log("Oracle query no result rows sent");
                break;
            }
          }
        });
      } else {
        requestingNode.log("Oracle query execution queued");
        node.queryQueue.push({
          msg: msg,
          requestingNode: requestingNode,
          query: query,
          bindVars: bindVars,
          resultAction: resultAction,
          resultSetLimit: resultSetLimit
        });
        node.claimConnection();
      }
    };
    node.fetchRowsFromResultSet = function (msg, requestingNode, resultSet, maxRows) {
      resultSet.getRows(maxRows, function (err, rows) {
        if (err) {
          requestingNode.error("Oracle resultSet error: " + err.message);
        } else if (rows.length === 0) {
          resultSet.close(function () {
            if (err) {
              requestingNode.error("Oracle error closing resultSet: " + err.message);
            }
          });
        } else {
          msg.payload = rows;
          requestingNode.send(msg);
          requestingNode.log("Oracle query resultSet rows sent");
          node.fetchRowsFromResultSet(msg, requestingNode, resultSet, maxRows);
        }
      });
    };
    node.queryQueued = function () {
      while (node.connection && node.queryQueue.length > 0) {
        var e = node.queryQueue.shift();
        node.query(e.msg, e.requestingNode, e.query, e.bindVars, e.resultAction, e.resultSetLimit, e.sendResult);
      }
    };
  }
  RED.nodes.registerType("oracledb", OracleDb);
  RED.nodes.registerType("oracle-server", OracleServer, {
    credentials: {
      user: { type: "text" },
      password: { type: "password" }
    }
  });
};

//# sourceMappingURL=oracledb.js.map
