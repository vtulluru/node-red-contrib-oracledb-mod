/**
 * Tests for node-red-contrib-oracledb-mod.
 *
 * Two layers:
 *   - "Unit" — no DB required, exercise registration + pure functions.
 *   - "Live" — connects to a real Oracle DB. Skipped unless env vars are set.
 */
import * as Chai from "chai";
import * as dotenv from "dotenv";
dotenv.config();

const EventEmitter = require("events");
const fs = require("fs");
const expect = Chai.expect;

const oracleNodes = require("../../lib/oracledb");

const {
  ORACLEDBTEST_TNS_ADMIN,
  ORACLEDBTEST_CONNECTION_TYPE,
  ORACLEDBTEST_TNS_NAME,
  ORACLEDBTEST_USER,
  ORACLEDBTEST_PASSWORD,
  ORACLEDBTEST_HOST,
  ORACLEDBTEST_PORT,
  ORACLEDBTEST_DB
} = process.env;

const testNodes: any = {};
const httpRoutes: any = { get: {}, post: {} };
const nodeRegistry: any = {};

const REDmock: any = {
  nodes: {
    createNode: function (node: any, config: any) {
      for (const key in config) {
        if (Object.prototype.hasOwnProperty.call(config, key)) {
          node[key] = config[key];
        }
      }
      node.credentials = { user: ORACLEDBTEST_USER, password: ORACLEDBTEST_PASSWORD };
      node.log = (msg: string) => { /* silenced */ void msg; };
      node.error = (msg: string) => { /* silenced */ void msg; };
      node.warn = (msg: string) => { /* silenced */ void msg; };
      node.status = () => { /* noop */ };
      node._emitter = new EventEmitter();
      node.on = (event: string, action: any) => node._emitter.on(event, action);
      node.emit = (event: string, payload: any) => node._emitter.emit(event, payload);
    },
    registerType: function (nodeName: string, constructor: any) { testNodes[nodeName] = constructor; },
    registerNode: function (id: string, node: any) { nodeRegistry[id] = node; },
    getNode: (id: any) => nodeRegistry[id] || (typeof id === "object" ? id : null),
    getCredentials: (_id: any) => ({ user: ORACLEDBTEST_USER, password: ORACLEDBTEST_PASSWORD }),
    util: { cloneMessage: (msg: any) => JSON.parse(JSON.stringify(msg)) }
  },
  httpAdmin: {
    get: (route: string, _auth: any, handler: any) => { httpRoutes.get[route] = handler; },
    post: (route: string, _auth: any, handler: any) => { httpRoutes.post[route] = handler; }
  },
  auth: { needsPermission: (_p: string) => (_req: any, _res: any, next: any) => next && next() },
  util: { cloneMessage: (msg: any) => JSON.parse(JSON.stringify(msg)) }
};

oracleNodes(REDmock);

// Build a thin-mode server config from env.
const serverConfig: any = {
  connectionname: "Live Test Server",
  usethickmode: false,
  configdir: ORACLEDBTEST_TNS_ADMIN || "",
  connectiontype: ORACLEDBTEST_CONNECTION_TYPE || "Classic",
  tnsname: ORACLEDBTEST_TNS_NAME || "",
  host: ORACLEDBTEST_HOST || "localhost",
  port: ORACLEDBTEST_PORT || "1521",
  db: ORACLEDBTEST_DB || "orcl",
  poolmin: 0,
  poolmax: 2,
  poolincrement: 1,
  pooltimeout: 30,
  queuetimeout: 30000,
  stmtcachesize: 30,
  maxretries: 0,  // disable retries in tests for deterministic timing
  retrydelay: 100
};

function makeQueryNodeMock(onSend: (msg: any) => void, onError?: (err: any) => void) {
  return {
    log: () => { /* noop */ },
    warn: () => { /* noop */ },
    status: () => { /* noop */ },
    error: (err: any) => { if (onError) onError(err); },
    send: onSend
  };
}

// ---------- UNIT TESTS ----------
describe("Node registration", function () {
  it("registers oracledb node", function () {
    expect(testNodes).to.have.property("oracledb");
  });
  it("registers oracle-server config node", function () {
    expect(testNodes).to.have.property("oracle-server");
  });
});

describe("Legacy thick-mode heuristic", function () {
  it("treats a config with instantclientpath but no usethickmode as legacy thick", function () {
    // We don't actually init the client here — just verify the heuristic flag
    // by constructing a config node with no creds (will fail to connect, but
    // we only inspect the resolved fields).
    const cfg: any = { connectionname: "legacy", instantclientpath: "/opt/instantclient" };
    // Build via the registered constructor; will async-fail at createPool,
    // but synchronous field resolution runs first.
    const node: any = new testNodes["oracle-server"](cfg);
    expect(node.usethickmode).to.equal(true);
    expect(node.legacyMode).to.equal(true);
  });

  it("respects explicit usethickmode=false even when instantclientpath set", function () {
    const cfg: any = { connectionname: "explicit-thin", instantclientpath: "/opt/instantclient", usethickmode: false };
    const node: any = new testNodes["oracle-server"](cfg);
    expect(node.usethickmode).to.equal(false);
    expect(node.legacyMode).to.equal(false);
  });

  it("defaults to thin mode for a fresh config", function () {
    const cfg: any = { connectionname: "fresh" };
    const node: any = new testNodes["oracle-server"](cfg);
    expect(node.usethickmode).to.equal(false);
  });
});

describe("Editor endpoints (httpAdmin)", function () {
  it("registers GET /oracle-server/env", function () {
    expect(httpRoutes.get).to.have.property("/oracle-server/env");
  });
  it("registers GET /oracle-server/tnsnames", function () {
    expect(httpRoutes.get).to.have.property("/oracle-server/tnsnames");
  });
  it("registers POST /oracle-server/test", function () {
    expect(httpRoutes.post).to.have.property("/oracle-server/test");
  });

  it("registers GET /oracle-server/:id/stats", function () {
    expect(httpRoutes.get).to.have.property("/oracle-server/:id/stats");
  });

  it("stats endpoint returns pool_not_available for unknown id", function (done) {
    const handler = httpRoutes.get["/oracle-server/:id/stats"];
    handler({ params: { id: "no-such-node" } }, {
      json: (data: any) => {
        expect(data.ok).to.equal(false);
        expect(data.error).to.equal("pool_not_available");
        done();
      }
    });
  });

  it("env endpoint returns TNS_ADMIN", function (done) {
    const handler = httpRoutes.get["/oracle-server/env"];
    handler({}, {
      json: (data: any) => {
        expect(data).to.have.property("TNS_ADMIN");
        done();
      }
    });
  });

  it("tnsnames endpoint parses aliases when wallet is present", function (done) {
    if (!ORACLEDBTEST_TNS_ADMIN || !fs.existsSync(ORACLEDBTEST_TNS_ADMIN)) { this.skip(); return; }
    const handler = httpRoutes.get["/oracle-server/tnsnames"];
    handler({ query: { dir: ORACLEDBTEST_TNS_ADMIN } }, {
      json: (data: any) => {
        expect(data).to.have.property("aliases");
        expect(data.aliases).to.be.an("array").with.length.greaterThan(0);
        done();
      }
    });
  });

  it("tnsnames endpoint returns no_path error when nothing given and TNS_ADMIN env empty", function (done) {
    const handler = httpRoutes.get["/oracle-server/tnsnames"];
    const savedEnv = process.env.TNS_ADMIN;
    delete process.env.TNS_ADMIN;
    handler({ query: {} }, {
      json: (data: any) => {
        process.env.TNS_ADMIN = savedEnv;
        expect(data).to.have.property("error", "no_path");
        done();
      }
    });
  });

  it("tables endpoint returns pool_not_available when node has no pool", function (done) {
    const handler = httpRoutes.get["/oracle-server/:id/tables"];
    handler({ params: { id: "non-existent-node" } }, {
      json: (data: any) => {
        expect(data).to.have.property("ok", false);
        expect(data).to.have.property("error", "pool_not_available");
        done();
      }
    });
  });

  it("columns endpoint returns table_required when table parameter is missing", function (done) {
    const handler = httpRoutes.get["/oracle-server/:id/columns"];
    REDmock.nodes.registerNode("dummy-server", { pool: {} });
    handler({ params: { id: "dummy-server" }, query: {} }, {
      json: (data: any) => {
        expect(data).to.have.property("ok", false);
        expect(data).to.have.property("error", "table_required");
        done();
      }
    });
  });

  it("rejects continue transaction when msg._oracleTx is missing", function (done) {
    const testServer = new testNodes["oracle-server"](serverConfig);
    testServer.pool = { getConnection: () => Promise.resolve({}) };
    const queryNode = makeQueryNodeMock(() => {
      done(new Error("should have failed"));
    }, (err) => {
      expect(err).to.include("no active transaction found");
      done();
    });
    testServer.query({}, queryNode, "SELECT 1 FROM DUAL", [], "single", 100, false, "continue");
  });

  it("rejects commit transaction when msg._oracleTx is missing", function (done) {
    const testServer = new testNodes["oracle-server"](serverConfig);
    testServer.pool = { getConnection: () => Promise.resolve({}) };
    const queryNode = makeQueryNodeMock(() => {
      done(new Error("should have failed"));
    }, (err) => {
      expect(err).to.include("no active transaction found");
      done();
    });
    testServer.query({}, queryNode, "", [], "single", 100, false, "commit");
  });

  it("rejects rollback transaction when msg._oracleTx is missing", function (done) {
    const testServer = new testNodes["oracle-server"](serverConfig);
    testServer.pool = { getConnection: () => Promise.resolve({}) };
    const queryNode = makeQueryNodeMock(() => {
      done(new Error("should have failed"));
    }, (err) => {
      expect(err).to.include("no active transaction found");
      done();
    });
    testServer.query({}, queryNode, "", [], "single", 100, false, "rollback");
  });

  it("bindVars transforms type VECTOR and converts regular array to Float32Array", function (done) {
    const queryConfig = {
      name: "Vector transform test",
      query: "SELECT :v FROM DUAL",
      server: "mock-server-id",
      resultaction: "single"
    };
    const queryNode = new testNodes["oracledb"](queryConfig);
    queryNode.server = {
      query: (_msg: any, _node: any, _query: string, bindVars: any) => {
        expect(bindVars).to.have.property("v");
        expect(bindVars.v.val).to.be.instanceOf(Float32Array);
        expect(bindVars.v.val[0]).to.equal(1.5);
        expect(bindVars.v.val[1]).to.equal(2.5);
        done();
      }
    };
    queryNode.emit("input", {
      bindVars: {
        v: { type: "VECTOR", dir: "BIND_IN", val: [1.5, 2.5] }
      }
    });
  });

  it("dual output mode routes errors to second output port [null, msg]", function (done) {
    const testServer = new testNodes["oracle-server"](serverConfig);
    testServer.pool = null;
    const queryConfig = {
      name: "Dual output error test",
      query: "SELECT 1 FROM DUAL",
      server: "mock-server-id",
      splitoutputs: true
    };
    const queryNode = new testNodes["oracledb"](queryConfig);
    queryNode.server = testServer;
    queryNode.send = (out: any) => {
      expect(Array.isArray(out)).to.equal(true);
      expect(out[0]).to.be.null;
      expect(out[1]).to.be.an("object");
      expect(out[1].error).to.include("pool is not available");
      done();
    };
    queryNode.emit("input", {});
  });
});

// ---------- LIVE TESTS ----------
describe("Live Database Tests (thin mode)", function () {
  this.timeout(20000);
  const canRunLive = !!(ORACLEDBTEST_USER && ORACLEDBTEST_PASSWORD && ORACLEDBTEST_TNS_NAME && ORACLEDBTEST_TNS_ADMIN && fs.existsSync(ORACLEDBTEST_TNS_ADMIN));

  let serverNode: any;

  before(function () {
    if (!canRunLive) {
      console.warn("\nSkipping live tests. Set ORACLEDBTEST_TNS_ADMIN/USER/PASSWORD/TNS_NAME in .env to enable.\n");
      this.skip();
    }
    serverNode = new testNodes["oracle-server"](serverConfig);
  });

  it("creates a pool in thin mode", function (done) {
    if (serverNode.pool) return done();
    serverNode.status.once("connected", () => done());
    serverNode.status.once("error", (err: any) => done(new Error(err.message || String(err))));
  });

  it("executes SELECT and returns msg.oracle stats", function (done) {
    const queryNode = makeQueryNodeMock((msg: any) => {
      expect(msg.payload).to.be.an("array").with.lengthOf(1);
      expect(msg.payload[0].DUMMY).to.equal("X");
      expect(msg.oracle).to.be.an("object");
      expect(msg.oracle.mode).to.equal("single");
      expect(msg.oracle.rows).to.equal(1);
      expect(msg.oracle.durationMs).to.be.a("number").that.is.at.least(0);
      done();
    }, (err) => done(new Error(err)));
    serverNode.query({}, queryNode, "select dummy from dual", [], "single", 100);
  });

  it("executes SELECT with named bind via msg.payload object", function (done) {
    const queryConfig = {
      name: "Named bind",
      usequery: true,
      query: "select :v as v from dual",
      resultaction: "single",
      server: serverNode,
      usemappings: false,
      mappings: "[]",
      resultlimit: 100,
      usemany: false
    };
    const queryNode = new testNodes["oracledb"](queryConfig);
    queryNode.send = (msg: any) => {
      expect(msg.payload[0].V).to.equal("hello");
      done();
    };
    queryNode.error = (err: any) => done(new Error(err));
    queryNode.emit("input", { payload: { v: "hello" } });
  });

  it("executes single-meta and returns metadata + outBinds", function (done) {
    const queryNode = makeQueryNodeMock((msg: any) => {
      expect(msg.payload).to.be.an("object");
      expect(msg.payload).to.have.property("metaData");
      expect(msg.oracle.mode).to.equal("single-meta");
      done();
    }, (err) => done(new Error(err)));
    serverNode.query({}, queryNode, "select 1 as n from dual", [], "single-meta", 100);
  });

  it("executes PL/SQL block with OUT bind", function (done) {
    const oracledb = require("oracledb");
    const queryNode = makeQueryNodeMock((msg: any) => {
      expect(msg.payload.outBinds).to.have.property("result");
      expect(msg.payload.outBinds.result).to.equal("Success");
      done();
    }, (err) => done(new Error(err)));
    const bindVars = { result: { dir: oracledb.BIND_OUT, type: oracledb.STRING } };
    serverNode.query({}, queryNode, "BEGIN :result := 'Success'; END;", bindVars, "single-meta", 100);
  });

  it("executeMany inserts multiple rows in one call", function (done) {
    // Create a transient table, insert 5 rows via batch, drop it.
    const setupNode = makeQueryNodeMock(() => {
      const rows = [
        { id: 1, name: "alpha" },
        { id: 2, name: "beta" },
        { id: 3, name: "gamma" },
        { id: 4, name: "delta" },
        { id: 5, name: "epsilon" }
      ];
      const insertNode = makeQueryNodeMock((msg: any) => {
        expect(msg.payload.rowsAffected).to.equal(5);
        expect(msg.oracle.mode).to.equal("batch");
        // cleanup
        const dropNode = makeQueryNodeMock(() => done(), (err) => done(new Error(err)));
        serverNode.query({}, dropNode, "DROP TABLE nrtest_batch PURGE", [], "single-meta", 100);
      }, (err) => done(new Error(err)));
      serverNode.query({}, insertNode,
        "INSERT INTO nrtest_batch (id, name) VALUES (:id, :name)",
        rows, "single-meta", 100, true);
    }, (err) => done(new Error(err)));
    serverNode.query({}, setupNode,
      "CREATE TABLE nrtest_batch (id NUMBER PRIMARY KEY, name VARCHAR2(50))",
      [], "single-meta", 100);
  });

  it("streams multi result with chunkIndex metadata", function (done) {
    // Insert 5 rows in a transient table, query with maxRows=2 to force chunking.
    const setup = makeQueryNodeMock(() => {
      const insertNode = makeQueryNodeMock(() => {
        const chunks: any[] = [];
        const reader = makeQueryNodeMock((msg: any) => {
          chunks.push(msg);
          // After all chunks arrive, the resultset close happens; we wait one tick.
          if (chunks.length === 3) {
            expect(chunks[0].oracle).to.have.property("chunkIndex", 0);
            expect(chunks[1].oracle.chunkIndex).to.equal(1);
            expect(chunks[2].oracle.chunkIndex).to.equal(2);
            expect(chunks[2].oracle.totalRowsSoFar).to.equal(5);
            const drop = makeQueryNodeMock(() => done(), (err) => done(new Error(err)));
            serverNode.query({}, drop, "DROP TABLE nrtest_multi PURGE", [], "single-meta", 100);
          }
        }, (err) => done(new Error(err)));
        // chunk size 2 → expect chunks of 2, 2, 1
        serverNode.query({}, reader, "SELECT id FROM nrtest_multi ORDER BY id", [], "multi", 2);
      }, (err) => done(new Error(err)));
      serverNode.query({}, insertNode,
        "INSERT INTO nrtest_multi (id) VALUES (:id)",
        [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
        "single-meta", 100, true);
    }, (err) => done(new Error(err)));
    serverNode.query({}, setup,
      "CREATE TABLE nrtest_multi (id NUMBER PRIMARY KEY)", [], "single-meta", 100);
  });

  it("batch mode rejects non-array payload with a clear error", function (done) {
    const queryConfig = {
      name: "Bad batch",
      usequery: true,
      query: "INSERT INTO whatever VALUES (:v)",
      resultaction: "single",
      server: serverNode,
      usemappings: false,
      mappings: "[]",
      resultlimit: 100,
      usemany: true
    };
    const queryNode = new testNodes["oracledb"](queryConfig);
    queryNode.error = (err: any) => {
      expect(String(err)).to.match(/array/i);
      done();
    };
    queryNode.send = () => done(new Error("should not have sent a result"));
    queryNode.emit("input", { payload: { not: "an array" } });
  });

  it("test endpoint returns ok:false on bad credentials", function (done) {
    const handler = httpRoutes.post["/oracle-server/test"];
    handler({ body: {
      usethickmode: false,
      configdir: ORACLEDBTEST_TNS_ADMIN,
      tnsname: ORACLEDBTEST_TNS_NAME,
      user: ORACLEDBTEST_USER,
      password: "definitely-wrong-password-" + Date.now()
    } }, {
      json: (data: any) => {
        expect(data.ok).to.equal(false);
        expect(data.error).to.be.a("string");
        expect(data.timing).to.have.property("totalMs");
        done();
      }
    });
  });

  it("test endpoint connects and returns rich info", function (done) {
    const handler = httpRoutes.post["/oracle-server/test"];
    handler({ body: {
      usethickmode: false,
      configdir: ORACLEDBTEST_TNS_ADMIN,
      tnsname: ORACLEDBTEST_TNS_NAME,
      user: ORACLEDBTEST_USER,
      password: ORACLEDBTEST_PASSWORD
    } }, {
      json: (data: any) => {
        if (!data.ok) return done(new Error(data.error));
        expect(data.mode).to.equal("thin");
        expect(data.info).to.have.property("CURR_USER");
        expect(data.timing).to.have.property("connectMs");
        expect(data.schemas).to.be.an("array");
        done();
      }
    });
  });

  it("executes query with dynamic session tracing", function (done) {
    const queryNode = makeQueryNodeMock((msg: any) => {
      expect(msg.oracle).to.be.an("object");
      expect(msg.oracle.action).to.equal("order-processing");
      expect(msg.oracle.module).to.equal("inventory-service");
      expect(msg.oracle.clientInfo).to.equal("user-test-42");
      expect(msg.payload[0].ACT).to.equal("order-processing");
      expect(msg.payload[0].MOD).to.equal("inventory-service");
      expect(msg.payload[0].CI).to.equal("user-test-42");
      done();
    }, (err) => done(new Error(err)));
    const query = "SELECT SYS_CONTEXT('USERENV', 'ACTION') AS ACT, SYS_CONTEXT('USERENV', 'MODULE') AS MOD, SYS_CONTEXT('USERENV', 'CLIENT_INFO') AS CI FROM DUAL";
    serverNode.query(
      { action: "order-processing", module: "inventory-service", clientInfo: "user-test-42" },
      queryNode,
      query,
      [],
      "single",
      100
    );
  });

  it("binds native Float32Array vector and computes VECTOR_DISTANCE", function (done) {
    const queryNode = makeQueryNodeMock((msg: any) => {
      expect(msg.payload).to.be.an("array").with.lengthOf(1);
      expect(msg.payload[0].DIST).to.be.a("number");
      expect(msg.payload[0].DIST).to.equal(1);
      done();
    }, (err) => done(new Error(err)));
    const query = "SELECT VECTOR_DISTANCE(VECTOR('[1, 2, 3]'), :v, EUCLIDEAN) AS DIST FROM DUAL";
    const binds = { v: new Float32Array([1, 2, 4]) };
    serverNode.query({}, queryNode, query, binds, "single", 100);
  });

  it("multi-node transaction: executes across nodes with rollback and commit", async function () {
    const conn = await serverNode.pool.getConnection();
    try { await conn.execute("DROP TABLE TEST_UNICORN_TX"); } catch { /* ignore */ }
    await conn.execute("CREATE TABLE TEST_UNICORN_TX (id NUMBER, val VARCHAR2(50))");
    await conn.close();

    // 1. Begin transaction
    const msg1: any = { payload: { id: 1, val: "temp-row" } };
    await new Promise<void>((resolve, reject) => {
      const qn1 = makeQueryNodeMock((m: any) => {
        expect(m._oracleTx).to.be.an("object");
        expect(m._oracleTx.txId).to.be.a("string");
        resolve();
      }, reject);
      serverNode.query(msg1, qn1, "INSERT INTO TEST_UNICORN_TX (id, val) VALUES (:id, :val)", msg1.payload, "none", 100, false, "begin");
    });

    // 2. Rollback transaction
    await new Promise<void>((resolve, reject) => {
      const qn2 = makeQueryNodeMock((m: any) => {
        expect(m._oracleTx).to.be.undefined;
        resolve();
      }, reject);
      serverNode.query(msg1, qn2, "", [], "none", 100, false, "rollback");
    });

    // Verify 0 rows exist after rollback
    const verifyConn1 = await serverNode.pool.getConnection();
    const countRes1 = await verifyConn1.execute("SELECT COUNT(*) AS CNT FROM TEST_UNICORN_TX");
    await verifyConn1.close();
    expect(countRes1.rows[0][0]).to.equal(0);

    // 3. Begin + Commit
    const msg2: any = { payload: { id: 2, val: "persisted-row" } };
    await new Promise<void>((resolve, reject) => {
      const qn3 = makeQueryNodeMock(() => resolve(), reject);
      serverNode.query(msg2, qn3, "INSERT INTO TEST_UNICORN_TX (id, val) VALUES (:id, :val)", msg2.payload, "none", 100, false, "begin");
    });

    await new Promise<void>((resolve, reject) => {
      const qn4 = makeQueryNodeMock(() => resolve(), reject);
      serverNode.query(msg2, qn4, "", [], "none", 100, false, "commit");
    });

    // Verify 1 row committed
    const verifyConn2 = await serverNode.pool.getConnection();
    const countRes2 = await verifyConn2.execute("SELECT COUNT(*) AS CNT FROM TEST_UNICORN_TX");
    await verifyConn2.execute("DROP TABLE TEST_UNICORN_TX");
    await verifyConn2.close();
    expect(countRes2.rows[0][0]).to.equal(1);
  });

  it("live schema explorer endpoints return accessible tables and columns", function (done) {
    REDmock.nodes.registerNode("live-server-node", serverNode);
    const tablesHandler = httpRoutes.get["/oracle-server/:id/tables"];
    const columnsHandler = httpRoutes.get["/oracle-server/:id/columns"];

    tablesHandler({ params: { id: "live-server-node" }, query: {} }, {
      json: (data: any) => {
        if (!data.ok) return done(new Error(data.error));
        expect(data).to.have.property("ok", true);
        expect(data).to.have.property("dbName");
        expect(data.schemas).to.be.an("array").with.length.greaterThan(0);
        expect(data.tables).to.be.an("array").with.length.greaterThan(0);
        const sampleTable = data.tables[0];
        expect(sampleTable).to.have.property("TABLE_NAME");
        expect(sampleTable).to.have.property("OWNER");

        columnsHandler({ params: { id: "live-server-node" }, query: { table: sampleTable.TABLE_NAME, owner: sampleTable.OWNER } }, {
          json: (colData: any) => {
            if (!colData.ok) return done(new Error(colData.error));
            expect(colData).to.have.property("ok", true);
            expect(colData.columns).to.be.an("array").with.length.greaterThan(0);
            expect(colData.columns[0]).to.have.property("COLUMN_NAME");
            done();
          }
        });
      }
    });
  });

  it("binds positional Float32Array vector via msg.payload array", function (done) {
    const queryConfig = {
      name: "Positional vector query",
      query: "SELECT VECTOR_DISTANCE(VECTOR('[1, 2, 3]'), :1, EUCLIDEAN) AS DIST FROM DUAL",
      server: "mock-server-id",
      resultaction: "single"
    };
    const queryNode = new testNodes["oracledb"](queryConfig);
    queryNode.server = serverNode;
    queryNode.send = (msg: any) => {
      expect(msg.payload).to.be.an("array").with.lengthOf(1);
      expect(msg.payload[0].DIST).to.equal(1);
      done();
    };
    queryNode.error = (err: any) => done(new Error(err));
    queryNode.emit("input", { payload: [ new Float32Array([1, 2, 4]) ] });
  });

  it("formats returned vector as plain JavaScript Array when msg.vectorAsArray is true", function (done) {
    const queryNode = makeQueryNodeMock((msg: any) => {
      expect(msg.payload).to.be.an("array").with.lengthOf(1);
      expect(Array.isArray(msg.payload[0].V)).to.equal(true);
      expect(msg.payload[0].V).to.deep.equal([1, 2, 3]);
      done();
    }, (err) => done(new Error(err)));
    const query = "SELECT VECTOR('[1, 2, 3]', 3, FLOAT32) AS V FROM DUAL";
    serverNode.query({ vectorAsArray: true }, queryNode, query, [], "single", 100);
  });

  it("automatically rolls back and frees connection on SQL error inside transaction", async function () {
    const initialInUse = serverNode.pool.connectionsInUse;

    const msg: any = {};
    await new Promise<void>((resolve) => {
      const qn1 = makeQueryNodeMock(() => {
        resolve();
      }, () => resolve());
      serverNode.query(msg, qn1, "SELECT 1 FROM DUAL", [], "single", 100, false, "begin");
    });

    expect(msg._oracleTx).to.be.an("object");
    expect(msg._oracleTx.txId).to.be.a("string");

    // Execute invalid query in same transaction -> should fail, auto-rollback, and delete msg._oracleTx
    await new Promise<void>((resolve) => {
      const qn2 = makeQueryNodeMock(() => {
        resolve();
      }, (err: any) => {
        expect(err).to.include("Oracle query error");
        expect(msg._oracleTx).to.be.undefined;
        resolve();
      });
      serverNode.query(msg, qn2, "SELECT * FROM NON_EXISTENT_UNICORN_TABLE_XYZ", [], "single", 100, false, "continue");
    });

    // Verify connection was returned to pool
    await new Promise((r) => setTimeout(r, 200));
    expect(serverNode.pool.connectionsInUse).to.equal(initialInUse);
  });

  it("executes sequential array of queries in one round-trip", function (done) {
    const queryConfig = {
      name: "Array query test",
      server: "mock-server-id",
      resultaction: "single"
    };
    const queryNode = new testNodes["oracledb"](queryConfig);
    queryNode.server = serverNode;
    queryNode.send = (msg: any) => {
      expect(msg.payload).to.be.an("array").with.lengthOf(2);
      expect(msg.payload[0][0].VAL).to.equal(10);
      expect(msg.payload[1][0].VAL).to.equal(20);
      expect(msg.oracle.statementsExecuted).to.equal(2);
      expect(msg.oracle.mode).to.equal("array");
      done();
    };
    queryNode.error = (err: any) => done(new Error(err));
    queryNode.emit("input", {
      query: [
        "SELECT 10 AS VAL FROM DUAL",
        "SELECT 20 AS VAL FROM DUAL"
      ]
    });
  });

  it("dual output mode routes successful result to first output port [msg, null]", function (done) {
    const queryConfig = {
      name: "Dual output success test",
      query: "SELECT 42 AS ANSWER FROM DUAL",
      server: "mock-server-id",
      resultaction: "single",
      splitoutputs: true
    };
    const queryNode = new testNodes["oracledb"](queryConfig);
    queryNode.server = serverNode;
    queryNode.send = (out: any) => {
      expect(Array.isArray(out)).to.equal(true);
      expect(out[0]).to.be.an("object");
      expect(out[0].payload[0].ANSWER).to.equal(42);
      expect(out[1]).to.be.null;
      done();
    };
    queryNode.error = (err: any) => done(new Error(err));
    queryNode.emit("input", {});
  });

  after(async function () {
    if (serverNode && serverNode.pool) {
      try { await serverNode.pool.close(0); } catch { /* ignore */ }
    }
  });
});
