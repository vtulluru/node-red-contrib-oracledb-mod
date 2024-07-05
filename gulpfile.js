const { src, dest, series, parallel, watch } = require('gulp');
const concat = require('gulp-concat');
const addsrc = require('gulp-add-src');
const ts = require('gulp-typescript');
const tslint = require('gulp-tslint');
const sourcemaps = require('gulp-sourcemaps');
const mocha = require('gulp-spawn-mocha');

const node_red_root = process.env.NODE_RED_ROOT;

// swallow errors in watch
function swallowError(error) {
  console.error(error.toString());
  this.emit('end');
}

// define typescript project
const tsProject = ts.createProject('tsconfig.json');

async function clean() {
  const del = await import('del');
  return del.deleteSync([
    'coverage',
    'transpiled'
  ]);
}

function compile() {
  return src('src/**/*.ts')
    .pipe(sourcemaps.init())
    .pipe(tslint({
      configuration: 'tools/tslint/tslint-node.json',
      formatter: 'prose'
    }))
    .pipe(tslint.report({ emitError: false }))
    .pipe(tsProject())
    .pipe(sourcemaps.write('.', { includeContent: false, sourceRoot: '../src/' }))
    .pipe(dest('transpiled'));
}

function lint() {
  return src('src/**/*.ts')
    .pipe(tslint({
      configuration: 'tools/tslint/tslint-node.json'
    }))
    .pipe(tslint.report());
}

function copyToLib() {
  return src([
    'src/html/*.html',
    'tools/concat/js_prefix.html',
    'transpiled/html/*.js',
    'tools/concat/js_suffix.html'
  ])
    .pipe(concat('oracledb.html'))
    .pipe(addsrc.append(['transpiled/nodejs/*.js', '!transpiled/nodejs/*.spec.js']))
    .pipe(dest('lib'));
}

function copyToNodeRed() {
  if (node_red_root) {
    return src(['lib/*.*'])
      .pipe(dest(node_red_root + '/node_modules/node-red-contrib-oracledb-mod/lib'));
  }
}

function test() {
  return src('transpiled/**/*.spec.js', { read: false })
    .pipe(mocha({
      r: 'tools/mocha/setup.js',
      reporter: 'dot'
    }))
    .on('error', swallowError);
}

function watchFiles() {
  watch('server/**/*.ts', compile);
}

exports.default = series(clean, compile);
exports.build = series(clean, compile, copyToLib, test, copyToNodeRed);
exports.buildClean = series(clean, compile, test);
exports.watch = series(clean, compile, watchFiles);
exports.clean = clean;
exports.cleanAll = series(clean, () => del(['node_modules']));
exports.compile = compile;
exports.lint = lint;
exports.copyToLib = copyToLib;
exports.copyToNodeRed = series(copyToLib, copyToNodeRed);
exports.test = series(copyToLib, test);
exports.testIntegration = series(copyToLib, () => {
  return src('transpiled/**/*.spec-i.js', { read: false })
    .pipe(mocha({ reporter: 'dot' }))
    .on('error', swallowError);
});
exports.testCoverage = series(copyToLib, () => {
  return src('transpiled/**/*.spec.js', { read: false })
    .pipe(mocha({ reporter: 'spec', istanbul: true }));
});
