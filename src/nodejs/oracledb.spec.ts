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
    getNode: (id: any) => id,
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
    if (!ORACLEDBTEST_TNS_ADMIN) { this.skip(); return; }
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
});

// ---------- LIVE TESTS ----------
describe("Live Database Tests (thin mode)", function () {
  this.timeout(20000);
  const canRunLive = !!(ORACLEDBTEST_USER && ORACLEDBTEST_PASSWORD && ORACLEDBTEST_TNS_NAME && ORACLEDBTEST_TNS_ADMIN);

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

  after(async function () {
    if (serverNode && serverNode.pool) {
      try { await serverNode.pool.close(0); } catch { /* ignore */ }
    }
  });
});
