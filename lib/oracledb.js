"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
module.exports = function (RED) {
    "use strict";
    const oracledb = require("oracledb");
    const resolvePath = require("object-resolve-path");
    const events = require("events");
    oracledb.fetchAsBuffer = [oracledb.BLOB];
    oracledb.fetchAsString = [oracledb.CLOB];
    // Process-wide thick-mode guard. initOracleClient() can only be called once
    // per Node-RED process; a second call with a different libDir throws NJS-077.
    // Track state so multiple oracle-server configs cooperate.
    const thickInitState = {
        initialized: false,
        libDir: "",
        configDir: ""
    };
    // Errors that are worth retrying: pool/connection dropped, network blip, TLS
    // handshake glitch on ADB. Anything else (syntax, permissions, ORA-12154)
    // surfaces immediately.
    const TRANSIENT_ERROR_PATTERNS = [
        /NJS-003/, // invalid connection
        /NJS-040/, // connection request timeout
        /NJS-500/, // connection terminated
        /NJS-501/, // connection lost contact
        /ORA-03113/, // end-of-file on comms channel
        /ORA-03114/, // not connected to Oracle
        /ORA-12170/, // TNS connect timeout
        /ORA-12541/, // no listener
        /ORA-12537/, // connection closed
        /ORA-12514/ // listener does not currently know of service (ADB warming up)
    ];
    function isTransientError(err) {
        if (!err || !err.message)
            return false;
        return TRANSIENT_ERROR_PATTERNS.some(re => re.test(err.message));
    }
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    function normalizeBindValue(val) {
        if (val instanceof Float32Array || val instanceof Float64Array) {
            return { type: oracledb.DB_TYPE_VECTOR, val };
        }
        if (val && typeof val === "object" && (val.type === "vector" || val.type === oracledb.DB_TYPE_VECTOR) && Array.isArray(val.val)) {
            return { type: oracledb.DB_TYPE_VECTOR, val: new Float32Array(val.val) };
        }
        return val;
    }
    function transformBindVars(bindVars) {
        const transformed = {};
        for (const key in bindVars) {
            if (Object.prototype.hasOwnProperty.call(bindVars, key)) {
                const bindVar = bindVars[key];
                let bindType = oracledb[bindVar.type] || bindVar.type;
                if (bindVar.type === "DB_TYPE_VECTOR" || bindVar.type === "VECTOR" || bindVar.type === oracledb.DB_TYPE_VECTOR) {
                    bindType = oracledb.DB_TYPE_VECTOR;
                }
                transformed[key] = {
                    dir: oracledb[bindVar.dir] || bindVar.dir || oracledb.BIND_IN,
                    type: bindType
                };
                if (bindVar.hasOwnProperty("val")) {
                    if (bindType === oracledb.DB_TYPE_VECTOR && Array.isArray(bindVar.val) && !(bindVar.val instanceof Float32Array)) {
                        transformed[key].val = new Float32Array(bindVar.val);
                    }
                    else {
                        transformed[key].val = bindVar.val;
                    }
                }
                if (bindVar.maxSize)
                    transformed[key].maxSize = bindVar.maxSize;
            }
        }
        return transformed;
    }
    function initialize(node) {
        if (node.server) {
            if (node.server.pool) {
                node.status({ fill: "green", shape: "dot", text: "connected" });
            }
            else {
                node.status({ fill: "grey", shape: "dot", text: "unconnected" });
            }
            node.serverStatus = node.server.status;
            node.serverStatus.on("connecting", () => {
                node.status({ fill: "green", shape: "ring", text: "connecting..." });
            });
            node.serverStatus.on("connected", () => {
                node.status({ fill: "green", shape: "dot", text: "connected" });
            });
            node.serverStatus.on("closed", () => {
                node.status({ fill: "red", shape: "ring", text: "disconnected" });
            });
            node.serverStatus.on("error", (err) => {
                const shortError = err.message.split("\n")[0];
                node.status({ fill: "red", shape: "dot", text: shortError });
            });
        }
        else {
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
            node.status({ fill: "blue", shape: "dot", text: "running..." });
            const useQuery = n.usequery;
            const query = (useQuery || !msg.query) ? n.query : msg.query;
            const useMappings = n.usemappings;
            // executeMany batch mode: msg.payload must be an array of objects (named binds)
            // or array of arrays (positional). Caller signals intent either via the node
            // option `usemany` or by setting msg.executeMany = true.
            const useMany = !!(n.usemany || msg.executeMany);
            let mappings = [];
            try {
                mappings = n.mappings ? JSON.parse(n.mappings) : [];
            }
            catch (e) {
                node.error("Error parsing Field Mappings JSON: " + e.message, msg);
                node.status({ fill: "red", shape: "dot", text: "Invalid Mappings" });
                return;
            }
            const resultAction = msg.resultAction || n.resultaction;
            const resultSetLimit = parseInt(msg.resultSetLimit || n.resultlimit, 10) || 100;
            const txAction = (msg.txAction || msg.transaction || n.txaction || "auto").toLowerCase();
            let bindVars = null;
            if (useMany) {
                if (!Array.isArray(msg.payload)) {
                    node.error("Batch mode (executeMany) requires msg.payload to be an array of objects or arrays.", msg);
                    node.status({ fill: "red", shape: "dot", text: "Batch needs array payload" });
                    return;
                }
                bindVars = msg.payload;
            }
            else if (msg.bindVars) {
                try {
                    bindVars = transformBindVars(msg.bindVars);
                }
                catch (err) {
                    node.error("Error transforming bind variables: " + err.message, msg);
                    node.status({ fill: "red", shape: "dot", text: "Invalid BindVars" });
                    return;
                }
            }
            else if (msg.payload && typeof msg.payload === "object" && !Array.isArray(msg.payload) && !useMappings) {
                const queryBinds = new Set();
                const regex = /:(\w+)/g;
                let match;
                while ((match = regex.exec(query)) !== null) {
                    queryBinds.add(match[1]);
                }
                if (queryBinds.size > 0) {
                    const cleanBinds = {};
                    const payloadAsAny = msg.payload;
                    queryBinds.forEach(bindName => {
                        if (payloadAsAny.hasOwnProperty(bindName)) {
                            cleanBinds[bindName] = normalizeBindValue(payloadAsAny[bindName]);
                        }
                    });
                    bindVars = cleanBinds;
                }
                else {
                    bindVars = {};
                }
            }
            else {
                const params = [];
                if (useMappings && msg.payload && !Array.isArray(msg.payload)) {
                    for (let i = 0; i < mappings.length; i++) {
                        let value;
                        try {
                            value = resolvePath(msg.payload, mappings[i]);
                        }
                        catch {
                            value = null;
                        }
                        params.push(normalizeBindValue(value));
                    }
                }
                else if (Array.isArray(msg.payload)) {
                    params.push(...msg.payload.map(normalizeBindValue));
                }
                bindVars = params;
            }
            node.server.query(msg, node, query, bindVars, resultAction, resultSetLimit, useMany, txAction);
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
        node.poolmin = parseInt(n.poolmin, 10) || 0;
        node.poolmax = parseInt(n.poolmax, 10) || 4;
        node.poolincrement = parseInt(n.poolincrement, 10) || 1;
        node.pooltimeout = parseInt(n.pooltimeout, 10) || 60;
        node.queuetimeout = parseInt(n.queuetimeout, 10) || 60000;
        node.stmtcachesize = parseInt(n.stmtcachesize, 10);
        if (isNaN(node.stmtcachesize))
            node.stmtcachesize = 30;
        // Mode resolution. Legacy configs (pre-0.8) have instantclientpath set but
        // no usethickmode field — keep them on thick to avoid breaking deploys.
        if (n.usethickmode === undefined) {
            node.usethickmode = !!node.instantclientpath; // legacy heuristic
            node.legacyMode = node.usethickmode;
        }
        else {
            node.usethickmode = n.usethickmode === true || n.usethickmode === "true";
            node.legacyMode = false;
        }
        // Wallet / TNS_ADMIN — works in both thin and thick mode in oracledb 6.x.
        node.configdir = n.configdir || "";
        node.walletlocation = n.walletlocation || "";
        node.walletpassword = (node.credentials && node.credentials.walletpassword) || "";
        node.maxretries = parseInt(n.maxretries, 10);
        if (isNaN(node.maxretries))
            node.maxretries = 3;
        node.retrydelay = parseInt(n.retrydelay, 10) || 1000;
        node.pool = null;
        node.status = new events.EventEmitter();
        node.status.setMaxListeners(0);
        // High-water-mark counters — help operators tune poolMax. Sampled on each
        // query (cheap) and reset when the pool is recreated.
        node.peakConnectionsInUse = 0;
        node.peakQueueLength = 0;
        node.peakSince = null;
        function samplePeaks() {
            if (!node.pool)
                return;
            const inUse = node.pool.connectionsInUse || 0;
            if (inUse > node.peakConnectionsInUse)
                node.peakConnectionsInUse = inUse;
            try {
                const s = typeof node.pool.getStatistics === "function" ? node.pool.getStatistics() : null;
                const qLen = s ? s.currentQueueLength : 0;
                if (qLen > node.peakQueueLength)
                    node.peakQueueLength = qLen;
            }
            catch { /* ignore */ }
        }
        async function connect() {
            if (node.pool)
                return;
            node.status.emit("connecting");
            if (node.usethickmode) {
                try {
                    if (!thickInitState.initialized) {
                        const initOpts = {};
                        if (node.instantclientpath)
                            initOpts.libDir = node.instantclientpath;
                        if (node.configdir)
                            initOpts.configDir = node.configdir;
                        oracledb.initOracleClient(initOpts);
                        thickInitState.initialized = true;
                        thickInitState.libDir = node.instantclientpath || "";
                        thickInitState.configDir = node.configdir || "";
                        if (node.legacyMode) {
                            node.warn("Running in thick mode (legacy compat). Thin mode is recommended for v0.8+. Switch \"Driver mode\" to Thin in the config node to migrate. See README.");
                        }
                    }
                    else if (node.instantclientpath && thickInitState.libDir &&
                        node.instantclientpath !== thickInitState.libDir) {
                        node.warn(`Thick client already initialized with libDir=${thickInitState.libDir}; this config's libDir=${node.instantclientpath} ignored.`);
                    }
                }
                catch (err) {
                    if (err.message.indexOf("NJS-077") !== -1 || err.message.indexOf("NJS-019") !== -1) {
                        // already initialized — fine
                        thickInitState.initialized = true;
                    }
                    else {
                        node.error("Oracle-server error initializing thick client: " + err.message);
                        (node.status.listenerCount("error") > 0 ? node.status.emit("error", err) : null);
                        return;
                    }
                }
            }
            const connectString = n.tnsname ? n.tnsname : `${node.host}:${node.port}/${node.db}`;
            const poolConfig = {
                user: node.user,
                password: node.password,
                connectString: connectString,
                poolMin: node.poolmin,
                poolMax: node.poolmax,
                poolIncrement: node.poolincrement,
                poolTimeout: node.pooltimeout,
                queueTimeout: node.queuetimeout,
                stmtCacheSize: node.stmtcachesize
            };
            // Thin mode reads wallet via these pool options; thick mode reads them
            // via the configDir passed to initOracleClient + sqlnet.ora.
            if (!node.usethickmode) {
                if (node.configdir)
                    poolConfig.configDir = node.configdir;
                if (node.walletlocation)
                    poolConfig.walletLocation = node.walletlocation;
                if (node.walletpassword)
                    poolConfig.walletPassword = node.walletpassword;
            }
            try {
                node.pool = await oracledb.createPool(poolConfig);
                node.peakConnectionsInUse = 0;
                node.peakQueueLength = 0;
                node.peakSince = new Date().toISOString();
                node.status.emit("connected");
                node.log(`Oracle pool created (${node.usethickmode ? "thick" : "thin"} mode) for ${connectString} [poolMin=${node.poolmin}, poolMax=${node.poolmax}]`);
            }
            catch (err) {
                (node.status.listenerCount("error") > 0 ? node.status.emit("error", err) : null);
                node.error("Oracle-server pool creation failed: " + err.message);
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
                }
                catch (err) {
                    node.error("Error closing Oracle connection pool: " + err.message);
                }
            }
            done();
        });
        function isPLSQLBlock(query) {
            const trimmedQuery = query.trim().toUpperCase();
            const plsqlPatterns = [
                /^BEGIN\s/,
                /^DECLARE\s/,
                /\bBEGIN\s.*\bEND\s*;?\s*$/s
            ];
            return plsqlPatterns.some(pattern => pattern.test(trimmedQuery));
        }
        // Run an async op with bounded retries on transient errors. Each retry uses
        // exponential backoff (delay * 2^attempt) capped at 10s.
        async function withRetry(op, label, requestingNode) {
            let lastErr;
            for (let attempt = 0; attempt <= node.maxretries; attempt++) {
                try {
                    return await op();
                }
                catch (err) {
                    lastErr = err;
                    if (!isTransientError(err) || attempt === node.maxretries)
                        throw err;
                    const delay = Math.min(node.retrydelay * Math.pow(2, attempt), 10000);
                    requestingNode.warn(`${label} transient error (${err.message.split("\n")[0]}); retry ${attempt + 1}/${node.maxretries} in ${delay}ms`);
                    await sleep(delay);
                }
            }
            throw lastErr;
        }
        // Reset a node's status back to "connected" after a delay. Tracks the
        // pending timer on the node so back-to-back queries don't clobber each
        // other's result badges.
        function scheduleStatusReset(rn, delayMs) {
            if (rn._oracleStatusTimer)
                clearTimeout(rn._oracleStatusTimer);
            rn._oracleStatusTimer = setTimeout(() => {
                rn._oracleStatusTimer = null;
                if (node.pool)
                    rn.status({ fill: "green", shape: "dot", text: "connected" });
            }, delayMs);
        }
        node.query = async function (msg, requestingNode, query, bindVars, resultAction, resultSetLimit, useMany, txAction) {
            if (!node.pool) {
                const errText = "Connection pool is not available.";
                requestingNode.error(errText, msg);
                requestingNode.status({ fill: "red", shape: "dot", text: errText });
                return;
            }
            const txMode = (txAction || msg.txAction || msg.transaction || "auto").toLowerCase();
            const isTx = txMode === "begin" || txMode === "continue" || txMode === "commit" || txMode === "rollback";
            let connection = null;
            let shouldCloseConnection = !isTx || txMode === "commit" || txMode === "rollback";
            const t0 = Date.now();
            let waitingTimer = null;
            try {
                if (txMode === "continue" || txMode === "commit" || txMode === "rollback") {
                    if (!msg._oracleTx || !msg._oracleTx.connection) {
                        throw new Error(`Transaction error: '${txMode}' requested but no active transaction found on msg._oracleTx.`);
                    }
                    connection = msg._oracleTx.connection;
                    if (msg._oracleTx.timer)
                        clearTimeout(msg._oracleTx.timer);
                }
                else {
                    waitingTimer = setTimeout(() => {
                        requestingNode.status({ fill: "yellow", shape: "ring", text: `waiting for pool slot... (${node.pool.connectionsInUse}/${node.pool.connectionsOpen})` });
                    }, 150);
                    connection = await withRetry(() => node.pool.getConnection(), "getConnection", requestingNode);
                    clearTimeout(waitingTimer);
                    samplePeaks();
                }
                // Dynamic session tracing (SYS_CONTEXT USERENV attributes)
                const action = msg.action || msg.oracleAction;
                const moduleName = msg.module || msg.oracleModule || (requestingNode ? requestingNode.name : null) || "node-red";
                const clientInfo = msg.clientInfo || msg.clientId || msg.user || msg.oracleClientInfo;
                if (action && typeof connection.action !== "undefined") {
                    try {
                        connection.action = String(action);
                    }
                    catch { /* ignore */ }
                }
                if (moduleName && typeof connection.module !== "undefined") {
                    try {
                        connection.module = String(moduleName);
                    }
                    catch { /* ignore */ }
                }
                if (clientInfo && typeof connection.clientInfo !== "undefined") {
                    try {
                        connection.clientInfo = String(clientInfo);
                    }
                    catch { /* ignore */ }
                }
                // If explicit rollback requested:
                if (txMode === "rollback") {
                    await connection.rollback();
                    delete msg._oracleTx;
                    const elapsed = Date.now() - t0;
                    requestingNode.status({ fill: "yellow", shape: "ring", text: `tx: rolled back · ${elapsed}ms` });
                    scheduleStatusReset(requestingNode, 3000);
                    msg.oracle = { durationMs: elapsed, transaction: "rollback" };
                    requestingNode.send(msg);
                    return;
                }
                const trimmedQuery = (query || "").trim();
                const finalQuery = isPLSQLBlock(trimmedQuery) ? trimmedQuery : trimmedQuery.replace(/;$/, "");
                let result = null;
                if (finalQuery.length > 0) {
                    const options = {
                        autoCommit: txMode === "auto",
                        outFormat: oracledb.OBJECT,
                        maxRows: resultSetLimit
                    };
                    if (!useMany)
                        options.resultSet = resultAction === "multi";
                    result = useMany
                        ? await withRetry(() => connection.executeMany(finalQuery, bindVars, options), "executeMany", requestingNode)
                        : await withRetry(() => connection.execute(finalQuery, bindVars || [], options), "execute", requestingNode);
                }
                if (txMode === "commit") {
                    await connection.commit();
                    delete msg._oracleTx;
                }
                else if (txMode === "begin") {
                    const txId = "tx_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
                    const txTimer = setTimeout(async () => {
                        try {
                            await connection.rollback();
                            await connection.close();
                            requestingNode.warn(`Oracle transaction ${txId} timed out after 60s and was rolled back.`);
                        }
                        catch { /* ignore */ }
                    }, 60000);
                    msg._oracleTx = {
                        txId,
                        connection,
                        timer: txTimer,
                        serverId: node.id,
                        startedAt: Date.now()
                    };
                }
                else if (txMode === "continue") {
                    msg._oracleTx.timer = setTimeout(async () => {
                        try {
                            await connection.rollback();
                            await connection.close();
                            requestingNode.warn(`Oracle transaction ${msg._oracleTx.txId} timed out after 60s and was rolled back.`);
                        }
                        catch { /* ignore */ }
                    }, 60000);
                }
                const elapsed = Date.now() - t0;
                const headWord = trimmedQuery.replace(/^\s+/, "").toUpperCase().split(/\s+/)[0] || "";
                const ddlVerbs = new Set(["CREATE", "DROP", "ALTER", "TRUNCATE", "GRANT", "REVOKE", "RENAME", "COMMENT"]);
                let summary;
                if (txMode === "commit") {
                    summary = `tx: committed · ${elapsed}ms`;
                }
                else if (txMode === "begin") {
                    summary = `tx: begin · ${elapsed}ms`;
                }
                else if (txMode === "continue") {
                    summary = `tx: continue · ${elapsed}ms`;
                }
                else if (useMany) {
                    summary = `batch: ${(result && result.rowsAffected) || 0} rows · ${elapsed}ms`;
                }
                else if (result && result.rows) {
                    summary = `${result.rows.length} row${result.rows.length === 1 ? "" : "s"} · ${elapsed}ms`;
                }
                else if (ddlVerbs.has(headWord)) {
                    summary = `${headWord.toLowerCase()} ok · ${elapsed}ms`;
                }
                else if (isPLSQLBlock(trimmedQuery)) {
                    summary = `PL/SQL ok · ${elapsed}ms`;
                }
                else if (result && typeof result.rowsAffected === "number") {
                    summary = `${result.rowsAffected} affected · ${elapsed}ms`;
                }
                else {
                    summary = `done · ${elapsed}ms`;
                }
                requestingNode.status({ fill: "green", shape: isTx && txMode !== "commit" ? "ring" : "dot", text: summary });
                scheduleStatusReset(requestingNode, 3000);
                // Stats sidecar
                const stats = {
                    durationMs: elapsed,
                    mode: useMany ? "batch" : (resultAction || "none"),
                    transaction: txMode,
                    statementKind: ddlVerbs.has(headWord) ? "ddl"
                        : isPLSQLBlock(trimmedQuery) ? "plsql"
                            : (headWord === "SELECT" ? "query" : (headWord || "unknown").toLowerCase())
                };
                if (action)
                    stats.action = String(action);
                if (moduleName)
                    stats.module = String(moduleName);
                if (clientInfo)
                    stats.clientInfo = String(clientInfo);
                if (result && typeof result.rowsAffected === "number")
                    stats.rowsAffected = result.rowsAffected;
                if (result && result.rows)
                    stats.rows = result.rows.length;
                function formatRowVectors(row) {
                    if (!row || typeof row !== "object" || !msg.vectorAsArray)
                        return row;
                    const copy = { ...row };
                    for (const k in copy) {
                        if (copy[k] instanceof Float32Array || copy[k] instanceof Float64Array) {
                            copy[k] = Array.from(copy[k]);
                        }
                    }
                    return copy;
                }
                if (useMany && result) {
                    msg.payload = {
                        rowsAffected: result.rowsAffected,
                        outBinds: result.outBinds,
                        batchErrors: result.batchErrors
                    };
                    msg.oracle = stats;
                    requestingNode.send(msg);
                }
                else if (result) {
                    switch (resultAction) {
                        case "single": {
                            msg.payload = Array.isArray(result.rows) ? result.rows.map(formatRowVectors) : result.rows;
                            msg.oracle = stats;
                            requestingNode.send(msg);
                            break;
                        }
                        case "single-meta": {
                            msg.payload = {
                                rowsAffected: result.rowsAffected,
                                metaData: result.metaData,
                                outBinds: result.outBinds
                            };
                            msg.oracle = stats;
                            requestingNode.send(msg);
                            break;
                        }
                        case "multi": {
                            if (result.resultSet) {
                                const resultSet = result.resultSet;
                                let rows;
                                let chunkIdx = 0;
                                let totalRows = 0;
                                do {
                                    rows = await resultSet.getRows(resultSetLimit);
                                    if (rows.length > 0) {
                                        totalRows += rows.length;
                                        const newMsg = RED.util.cloneMessage(msg);
                                        newMsg.payload = rows.map(formatRowVectors);
                                        newMsg.oracle = { ...stats, rows: rows.length, chunkIndex: chunkIdx++, totalRowsSoFar: totalRows };
                                        requestingNode.send(newMsg);
                                    }
                                } while (rows.length > 0);
                                await resultSet.close();
                                requestingNode.status({ fill: "green", shape: isTx && txMode !== "commit" ? "ring" : "dot", text: `${totalRows} rows · ${Date.now() - t0}ms` });
                                scheduleStatusReset(requestingNode, 3000);
                            }
                            break;
                        }
                        case "none":
                        default:
                            msg.oracle = stats;
                            if (txMode === "commit" || txMode === "begin" || txMode === "continue") {
                                requestingNode.send(msg);
                            }
                            break;
                    }
                }
                else {
                    msg.oracle = stats;
                    requestingNode.send(msg);
                }
            }
            catch (err) {
                if (waitingTimer)
                    clearTimeout(waitingTimer);
                if (isTx && connection) {
                    try {
                        await connection.rollback();
                        await connection.close();
                    }
                    catch { /* ignore */ }
                    delete msg._oracleTx;
                    shouldCloseConnection = false;
                }
                let shortError = err.message ? err.message.split("\n")[0] : String(err);
                if (/NJS-040/.test(shortError) && node.pool) {
                    try {
                        const s = typeof node.pool.getStatistics === "function" ? node.pool.getStatistics() : null;
                        const qLen = s ? s.currentQueueLength : "?";
                        shortError = `${shortError} (pool exhausted: ${node.pool.connectionsInUse}/${node.pool.connectionsOpen} in use, ${qLen} queued, waited ${node.queuetimeout}ms)`;
                    }
                    catch { /* ignore */ }
                }
                requestingNode.error(`Oracle query error: ${shortError}`, msg);
                requestingNode.status({ fill: "red", shape: "dot", text: shortError });
                scheduleStatusReset(requestingNode, 5000);
            }
            finally {
                if (connection && shouldCloseConnection) {
                    try {
                        await connection.close();
                    }
                    catch (err) {
                        requestingNode.error("Error releasing connection: " + err.message);
                    }
                }
            }
        };
    }
    // Editor helper: parse tnsnames.ora from a wallet/TNS_ADMIN directory and
    // return the alias list so the config dialog can offer a dropdown.
    // Requires flow-write permission to avoid an anonymous file-read endpoint.
    // Reports the server-side TNS_ADMIN env var so the editor can hint the user.
    RED.httpAdmin.get("/oracle-server/env", RED.auth.needsPermission("flows.write"), function (_req, res) {
        res.json({ TNS_ADMIN: process.env.TNS_ADMIN || "" });
    });
    // Returns live pool statistics for a deployed oracle-server config node.
    // Used by the "Pool Stats" panel in the editor; also handy for monitoring
    // dashboards (`curl /oracle-server/<id>/stats` with admin auth).
    RED.httpAdmin.get("/oracle-server/:id/stats", RED.auth.needsPermission("flows.write"), function (req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (!node || !node.pool)
            return res.json({ ok: false, error: "pool_not_available" });
        try {
            const s = typeof node.pool.getStatistics === "function" ? node.pool.getStatistics() : null;
            const summary = {
                connectionsOpen: node.pool.connectionsOpen,
                connectionsInUse: node.pool.connectionsInUse,
                poolMin: node.pool.poolMin,
                poolMax: node.pool.poolMax,
                queueLength: s ? s.currentQueueLength : null,
                queueMax: s ? s.queueMax : null,
                peakConnectionsInUse: node.peakConnectionsInUse || 0,
                peakQueueLength: node.peakQueueLength || 0,
                peakSince: node.peakSince,
                gatheredAt: new Date().toISOString()
            };
            res.json({ ok: true, mode: node.usethickmode ? "thick" : "thin", summary, raw: s });
        }
        catch (err) {
            res.json({ ok: false, error: err.message });
        }
    });
    // One-shot connection test. Body is the in-editor form state; if `nodeId` is
    // supplied and the password field is blank/placeholder, we fall back to the
    // credentials stored against that node.
    RED.httpAdmin.post("/oracle-server/test", RED.auth.needsPermission("flows.write"), async function (req, res) {
        const body = req.body || {};
        let user = body.user;
        let password = body.password;
        let walletPassword = body.walletpassword;
        if (body.nodeId) {
            const cred = RED.nodes.getCredentials(body.nodeId) || {};
            if (!user)
                user = cred.user;
            if (!password || password === "__PWRD__")
                password = cred.password;
            if (!walletPassword || walletPassword === "__PWRD__")
                walletPassword = cred.walletpassword;
        }
        const useThick = body.usethickmode === true || body.usethickmode === "true";
        if (useThick && !thickInitState.initialized) {
            try {
                const opts = {};
                if (body.instantclientpath)
                    opts.libDir = body.instantclientpath;
                if (body.configdir)
                    opts.configDir = body.configdir;
                oracledb.initOracleClient(opts);
                thickInitState.initialized = true;
            }
            catch (err) {
                if (err.message.indexOf("NJS-077") === -1 && err.message.indexOf("NJS-019") === -1) {
                    return res.json({ ok: false, error: "Thick init failed: " + err.message });
                }
                thickInitState.initialized = true;
            }
        }
        const connectString = body.tnsname || `${body.host || "localhost"}:${body.port || 1521}/${body.db || "orcl"}`;
        const cfg = { connectString, user, password };
        if (!useThick) {
            if (body.configdir)
                cfg.configDir = body.configdir;
            if (body.walletlocation)
                cfg.walletLocation = body.walletlocation;
            if (walletPassword)
                cfg.walletPassword = walletPassword;
        }
        let conn;
        const t0 = Date.now();
        let tConnect = 0;
        try {
            conn = await oracledb.getConnection(cfg);
            tConnect = Date.now() - t0;
            const r = await conn.execute("SELECT USER AS CURR_USER, " +
                " SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS CURR_SCHEMA, " +
                " SYS_CONTEXT('USERENV','SERVICE_NAME') AS SERVICE, " +
                " SYS_CONTEXT('USERENV','DB_NAME') AS DB_NAME, " +
                " SYS_CONTEXT('USERENV','SERVER_HOST') AS SERVER_HOST " +
                "FROM DUAL", [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
            // Best-effort schema enumeration. ALL_USERS is readable by every Oracle
            // user but may be empty for very locked-down accounts; we swallow errors.
            let schemas = [];
            let schemaTotal = 0;
            try {
                const s = await conn.execute("SELECT username FROM all_users ORDER BY username", [], { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 200 });
                schemas = s.rows.map(row => row[0]);
                schemaTotal = schemas.length;
            }
            catch { /* ignore */ }
            const tTotal = Date.now() - t0;
            res.json({ ok: true, mode: useThick ? "thick" : "thin", info: r.rows[0], connectString, schemas, schemaTotal, timing: { connectMs: tConnect, totalMs: tTotal } });
        }
        catch (err) {
            const tFail = Date.now() - t0;
            res.json({ ok: false, error: err.message.split("\n")[0], connectString, timing: { totalMs: tFail } });
        }
        finally {
            if (conn) {
                try {
                    await conn.close();
                }
                catch { /* ignore */ }
            }
        }
    });
    RED.httpAdmin.get("/oracle-server/tnsnames", RED.auth.needsPermission("flows.write"), function (req, res) {
        const path = require("path");
        const fs = require("fs");
        // Try caller-supplied paths first, then fall back to TNS_ADMIN env. Each
        // candidate is a directory containing tnsnames.ora.
        const candidates = [];
        if (typeof req.query.dir === "string" && req.query.dir.trim())
            candidates.push(req.query.dir.trim());
        if (typeof req.query.walletLocation === "string" && req.query.walletLocation.trim())
            candidates.push(req.query.walletLocation.trim());
        if (process.env.TNS_ADMIN)
            candidates.push(process.env.TNS_ADMIN);
        // De-dupe while preserving order.
        const seen = new Set();
        const ordered = candidates.filter(c => { const r = path.resolve(c); if (seen.has(r))
            return false; seen.add(r); return true; });
        function tryNext(i, tried) {
            if (i >= ordered.length) {
                return res.json({ error: "not_found", tried });
            }
            const dir = ordered[i];
            const tnsPath = path.resolve(dir, "tnsnames.ora");
            tried.push(tnsPath);
            fs.readFile(tnsPath, "utf8", (err, data) => {
                if (err)
                    return tryNext(i + 1, tried);
                const aliases = [];
                const re = /^([A-Za-z0-9_$#.]+)\s*=/gm;
                let m;
                while ((m = re.exec(data)) !== null)
                    aliases.push(m[1]);
                res.json({ aliases: [...new Set(aliases)].sort(), source: tnsPath });
            });
        }
        if (!ordered.length)
            return res.json({ error: "no_path", tried: [] });
        tryNext(0, []);
    });
    // Returns database hierarchy (dbName, schemas, tables, views) for Schema Explorer
    RED.httpAdmin.get("/oracle-server/:id/tables", RED.auth.needsPermission("flows.write"), async function (req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (!node || !node.pool)
            return res.json({ ok: false, error: "pool_not_available" });
        let conn;
        try {
            conn = await node.pool.getConnection();
            // Get DB name and current schema
            const ctxRes = await conn.execute("SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS DB_NAME, SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS CURRENT_SCHEMA FROM DUAL", [], { outFormat: oracledb.OBJECT });
            const dbName = ctxRes.rows && ctxRes.rows[0] ? ctxRes.rows[0].DB_NAME : "";
            const currentSchema = ctxRes.rows && ctxRes.rows[0] ? ctxRes.rows[0].CURRENT_SCHEMA : "";
            // Fast lookup of user/application schemas
            const schemasRes = await conn.execute(`
        SELECT username AS owner
        FROM all_users
        WHERE oracle_maintained = 'N'
        ORDER BY username
      `, [], { outFormat: oracledb.OBJECT });
            const schemas = (schemasRes.rows || []).map((r) => r.OWNER);
            if (currentSchema && !schemas.includes(currentSchema)) {
                schemas.unshift(currentSchema);
            }
            const reqQuery = req.query || {};
            const targetSchema = reqQuery.schema ? String(reqQuery.schema).toUpperCase() : (currentSchema || (schemas.length ? schemas[0] : ""));
            let query;
            const binds = {};
            if (targetSchema) {
                query = `
          SELECT owner, table_name, 'TABLE' AS object_type
          FROM all_tables
          WHERE owner = :schema
          UNION ALL
          SELECT owner, view_name AS table_name, 'VIEW' AS object_type
          FROM all_views
          WHERE owner = :schema
          ORDER BY object_type, table_name
        `;
                binds.schema = targetSchema;
            }
            else {
                query = `
          SELECT owner, table_name, 'TABLE' AS object_type
          FROM all_tables
          WHERE owner IN (SELECT username FROM all_users WHERE oracle_maintained = 'N')
          UNION ALL
          SELECT owner, view_name AS table_name, 'VIEW' AS object_type
          FROM all_views
          WHERE owner IN (SELECT username FROM all_users WHERE oracle_maintained = 'N')
          ORDER BY owner, object_type, table_name
          FETCH FIRST 200 ROWS ONLY
        `;
            }
            const result = await conn.execute(query, binds, { outFormat: oracledb.OBJECT });
            res.json({
                ok: true,
                dbName,
                currentSchema,
                schemas,
                tables: result.rows
            });
        }
        catch (err) {
            res.json({ ok: false, error: err.message ? err.message.split("\n")[0] : String(err) });
        }
        finally {
            if (conn) {
                try {
                    await conn.close();
                }
                catch { /* ignore */ }
            }
        }
    });
    // Returns column definitions for a selected table in the Schema Explorer
    RED.httpAdmin.get("/oracle-server/:id/columns", RED.auth.needsPermission("flows.write"), async function (req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (!node || !node.pool)
            return res.json({ ok: false, error: "pool_not_available" });
        const reqQuery = req.query || {};
        const tableName = String(reqQuery.table || "").toUpperCase();
        const owner = reqQuery.owner ? String(reqQuery.owner).toUpperCase() : "";
        if (!tableName)
            return res.json({ ok: false, error: "table_required" });
        let conn;
        try {
            conn = await node.pool.getConnection();
            let query = `
        SELECT column_name, data_type, data_length, data_precision, data_scale, nullable, identity_column, virtual_column
        FROM all_tab_cols
        WHERE table_name = :tableName
          AND hidden_column = 'NO'
          AND virtual_column = 'NO'
      `;
            const binds = { tableName };
            if (owner) {
                query += " AND owner = :owner";
                binds.owner = owner;
            }
            query += " ORDER BY column_id";
            const result = await conn.execute(query, binds, { outFormat: oracledb.OBJECT });
            res.json({ ok: true, columns: result.rows });
        }
        catch (err) {
            res.json({ ok: false, error: err.message ? err.message.split("\n")[0] : String(err) });
        }
        finally {
            if (conn) {
                try {
                    await conn.close();
                }
                catch { /* ignore */ }
            }
        }
    });
    RED.nodes.registerType("oracledb", OracleDb);
    RED.nodes.registerType("oracle-server", OracleServer, {
        credentials: {
            user: { type: "text" },
            password: { type: "password" },
            walletpassword: { type: "password" }
        }
    });
};
//# sourceMappingURL=oracledb.js.map