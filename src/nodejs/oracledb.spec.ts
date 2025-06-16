/**
 * Tests for oracledb
 */
import * as Chai from "chai";
import * as dotenv from "dotenv";
dotenv.config(); // Load environment variables from .env file

const EventEmitter = require("events");
const expect = Chai.expect;

const oracleNodes = require("../../lib/oracledb");

// --- Load Test Configuration from Environment ---
const {
  ORACLEDBTEST_INSTANT_CLIENT_PATH,
  ORACLEDBTEST_CONNECTION_TYPE,
  ORACLEDBTEST_TNS_NAME,
  ORACLEDBTEST_USER,
  ORACLEDBTEST_PASSWORD,
  ORACLEDBTEST_HOST,
  ORACLEDBTEST_PORT,
  ORACLEDBTEST_DB
} = process.env;

const testNodes = {};
const nodeListener = new EventEmitter();

// --- A more complete mock of the Node-RED runtime ---
const REDmock = {
  nodes: {
    createNode: function (node, config) {
      for (const key in config) {
        if (Object.prototype.hasOwnProperty.call(config, key)) {
          node[key] = config[key];
        }
      }
      // Provide credentials from the test environment
      node.credentials = {
        user: ORACLEDBTEST_USER,
        password: ORACLEDBTEST_PASSWORD
      };
      node.log = (msg) => console.log(`[LOG] ${msg}`);
      node.error = (msg) => console.error(`[ERROR] ${msg}`);
      node.warn = (msg) => console.warn(`[WARN] ${msg}`);
      node.status = () => {};
      node.on = (event, action) => nodeListener.on(event, action);
    },
    registerType: function (nodeName, constructor) {
      testNodes[nodeName] = constructor;
    },
    getNode: (id) => id
  }
};

oracleNodes(REDmock);

// --- Build the server configuration based on the environment ---
const serverConfig = {
  instantclientpath: ORACLEDBTEST_INSTANT_CLIENT_PATH,
  connectiontype: ORACLEDBTEST_CONNECTION_TYPE || "Classic",
  tnsname: ORACLEDBTEST_TNS_NAME,
  host: ORACLEDBTEST_HOST || "localhost",
  port: ORACLEDBTEST_PORT || "1521",
  db: ORACLEDBTEST_DB || "orcl",
  connectionname: "Live Test Server",
  poolmin: 0,
  poolmax: 2,
  pooltimeout: 30
};

// Helper function to simulate a message arriving at a node's input
function sendMessage(node, msg, done) {
  node.send = (msgOut) => {
    console.log("[SEND]", msgOut);
    done();
  };
  node.error = (err) => {
    done(new Error(err)); // Fail the test if the node calls .error()
  };
  nodeListener.emit("input", msg);
}


describe("Test Node Registration", function() {
    it("should register oracledb node", function() {
        expect(testNodes).to.have.property("oracledb");
    });
    it("should register oracle-server node", function() {
        expect(testNodes).to.have.property("oracle-server");
    });
});


// --- Rewritten Live Database Tests ---
describe("Live Database Tests", function() {
  this.timeout(10000); // Increase timeout for potentially slow remote connections

  const canRunLiveTests = !!(ORACLEDBTEST_INSTANT_CLIENT_PATH && ORACLEDBTEST_USER);

  before(function() {
    if (!canRunLiveTests) {
      console.warn("\nSkipping live database tests. Please create a .env file with test credentials (see README for details).\n");
      this.skip();
    }
  });

  const serverNode = new testNodes["oracle-server"](serverConfig);
  
  it("should create an Oracle database connection pool", function (done) {
    // FIX THE RACE CONDITION: Check if the pool is already connected.
    if (serverNode.pool) {
      // If the pool exists, the "connected" event already fired. We can pass immediately.
      expect(serverNode.pool).to.not.be.null;
      return done();
    }
    
    // If the pool is not yet ready, it's safe to listen for the events.
    serverNode.status.once("connected", () => {
      expect(serverNode.pool).to.not.be.null;
      done();
    });
    
    serverNode.status.once("error", (err) => {
      done(new Error(err.message));
    });
  });

  it("should successfully execute a query", function (done) {
    const queryNode = {
      log: () => {},
      error: (msg) => done(new Error(msg)),
      send: (msg) => {
        expect(msg.payload).to.be.an("array").with.lengthOf(1);
        done();
      }
    };
    serverNode.query({}, queryNode, "select 1 from dual", [], "single", 100);
  });

  it("should successfully execute a query with a parameter", function (done) {
    const queryNode = {
      log: () => {},
      error: (msg) => done(new Error(msg)),
      send: (msg) => {
        expect(msg.payload).to.be.an("array").with.lengthOf(1);
        expect(msg.payload[0].DUMMY).to.equal("X");
        done();
      }
    };
    serverNode.query({}, queryNode, "select dummy from dual where dummy = :v1", ["X"], "single", 100);
  });

  it("should run a query via the oracledb node", function (done) {
    const queryConfig = {
      name: "Test Query Node",
      usequery: true,
      query: "select 'test' as result from dual",
      resultaction: "single",
      server: serverNode,
      usemappings: false,
      resultlimit: 100
    };
    const queryNode = new testNodes["oracledb"](queryConfig);
    const msg = { payload: [] };
    sendMessage(queryNode, msg, done);
  });

  // Clean up the pool after tests are done
  after(async function() {
    if(serverNode && serverNode.pool) {
      await serverNode.pool.close(0);
    }
  });
});