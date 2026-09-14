const { src, dest, series, parallel, watch } = require('gulp');
const concat = require('gulp-concat');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const node_red_root = process.env.NODE_RED_ROOT;

// A simple error handler for the 'watch' task
function swallowError(error) {
  console.error(error.toString());
  this.emit('end');
}

// Cleans the build output directories
async function clean() {
  const del = await import('del');
  return del.deleteSync(['coverage', 'transpiled', 'lib']);
}

// Lints the backend TypeScript source files
async function lint() {
  const { stdout, stderr } = await execPromise('npx eslint src/nodejs/**/*.ts');
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

// Compiles the backend TypeScript code (Node.js)
async function compileBackend() {
  await execPromise('npx tsc -p src/nodejs/tsconfig.json');
}

// Compiles the frontend TypeScript code (Editor)
async function compileFrontend() {
  await execPromise('npx tsc -p src/html/tsconfig.json');
}

// Combines both compile tasks to run in parallel
const compile = parallel(compileBackend, compileFrontend);

// Builds the final frontend HTML file for Node-RED
function buildHtml() {
  return src([
    'src/html/*.html',
    'tools/concat/js_prefix.html',
    'transpiled/html/*.js',
    'tools/concat/js_suffix.html'
  ])
    .pipe(concat('oracledb.html'))
    .pipe(dest('lib'));
}

// Copies the final backend JS file to the lib directory
function buildJs() {
  return src(['transpiled/nodejs/*.js', '!transpiled/nodejs/*.spec.js'])
    .pipe(dest('lib'));
}

// The main build task that creates the final 'lib' directory
const buildLib = series(compile, parallel(buildHtml, buildJs));

// Runs the unit tests
async function test() {
  try {
    const { stdout, stderr } = await execPromise('npx mocha --require tools/mocha/setup.js --reporter dot "transpiled/nodejs/**/*.spec.js"');
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    throw err;
  }
}

// Exported Gulp tasks
exports.clean = clean;
exports.lint = lint;
exports.compile = compile;
exports.build = series(clean, buildLib);
exports.test = series(clean, buildLib, test);
exports.default = exports.build;