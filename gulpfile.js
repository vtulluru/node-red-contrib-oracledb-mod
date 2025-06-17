const { src, dest, series, parallel, watch } = require('gulp');
const concat = require('gulp-concat');
const ts = require('gulp-typescript');
const eslint = require('gulp-eslint-new');
const sourcemaps = require('gulp-sourcemaps');
const mocha = require('gulp-spawn-mocha');

const node_red_root = process.env.NODE_RED_ROOT;

// Create separate TypeScript projects from the new config files.
// This is the key to solving the compilation and scope issues.
const tsBackendProject = ts.createProject('src/nodejs/tsconfig.json');
const tsFrontendProject = ts.createProject('src/html/tsconfig.json');

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
function lint() {
  return src('src/nodejs/**/*.ts') // Only lint backend code
    .pipe(eslint())
    .pipe(eslint.format())
    .pipe(eslint.failAfterError());
}

// Compiles the backend TypeScript code (Node.js)
function compileBackend() {
  return src('src/nodejs/**/*.ts')
    .pipe(sourcemaps.init())
    .pipe(eslint())
    .pipe(eslint.format())
    .pipe(tsBackendProject())
    .pipe(sourcemaps.write('.', { includeContent: false, sourceRoot: '../../src/nodejs' }))
    .pipe(dest('transpiled/nodejs'));
}

// Compiles the frontend TypeScript code (Editor)
function compileFrontend() {
  // We do not lint the frontend code as it uses a different style (e.g., global RED object)
  return src('src/html/**/*.ts')
    .pipe(tsFrontendProject())
    .pipe(dest('transpiled/html'));
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
function test() {
  return src('transpiled/nodejs/**/*.spec.js', { read: false })
    .pipe(mocha({
      r: 'tools/mocha/setup.js',
      reporter: 'dot'
    }))
    .on('error', swallowError);
}

// Exported Gulp tasks
exports.clean = clean;
exports.lint = lint;
exports.compile = compile;
exports.build = series(clean, buildLib);
exports.test = series(clean, buildLib, test);
exports.default = exports.build;