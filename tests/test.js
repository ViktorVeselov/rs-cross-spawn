// End-to-end tests for the rs-cross-spawn NAPI binding.
// These exercise the same scenarios as the Rust integration tests, but through
// the native module loaded from JavaScript. Run with: `node tests/test.js`
// (after `bun run build` has produced the platform .node artifact).
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execProcess, spawn, killProcess } = require('../index.js');

const FIXTURES = path.resolve(__dirname, '..', 'target', 'test_fixtures');

function setupFixtures() {
  if (fs.existsSync(FIXTURES)) {
    fs.rmSync(FIXTURES, { recursive: true, force: true });
  }
  fs.mkdirSync(FIXTURES, { recursive: true });
  fs.mkdirSync(path.join(FIXTURES, 'node_modules', '.bin'), { recursive: true });

  // say-foo
  fs.writeFileSync(path.join(FIXTURES, 'say-foo'), '#!/usr/bin/env test_helper\n');
  fs.writeFileSync(path.join(FIXTURES, 'say-foo.bat'), '@test_helper echo foo\n');

  // shebang
  fs.writeFileSync(path.join(FIXTURES, 'shebang'), '#!/usr/bin/env test_helper\nshebang works!');

  // shebang-enoent
  fs.writeFileSync(path.join(FIXTURES, 'shebang-enoent'), '#!/usr/bin/env somecommandthatwillneverexist\n');

  // %CD%
  fs.writeFileSync(path.join(FIXTURES, '%CD%'), '#!/usr/bin/env test_helper\n');
  fs.writeFileSync(path.join(FIXTURES, '%CD%.bat'), '@test_helper echo special\n');

  // ()%!^&;, 
  fs.writeFileSync(path.join(FIXTURES, '()%!^&;, '), '#!/usr/bin/env test_helper\n');
  fs.writeFileSync(path.join(FIXTURES, '()%!^&;, .bat'), '@test_helper echo special\n');

  // cmd-shim
  fs.writeFileSync(path.join(FIXTURES, 'node_modules', '.bin', 'echo-cmd-shim.cmd'), '@test_helper echo %*\n');

  // whoami.cmd
  fs.writeFileSync(path.join(FIXTURES, 'whoami.cmd'), '@echo you sure are someone\n');

  // exit-1
  fs.writeFileSync(path.join(FIXTURES, 'exit-1'), '#!/usr/bin/env test_helper\n');
  fs.writeFileSync(path.join(FIXTURES, 'exit-1.bat'), '@test_helper exit 1\n');

  // Make executable on Unix
  if (process.platform !== 'win32') {
    for (const name of ['say-foo', 'shebang', 'shebang-enoent', '%CD%', '()%!^&;, ', 'exit-1']) {
      try {
        fs.chmodSync(path.join(FIXTURES, name), 0o755);
      } catch (e) { }
    }
  }
}

function run(cmd, args, options) {
  options = options || {};
  const envObj = options.env || { ...process.env };

  // Prepend test_helper build directory to PATH so shebang resolution can find it
  const HELPER_DIR = path.resolve(__dirname, '..', '..', 'cross-spawn', 'target', 'debug');
  const pathKey = Object.keys(envObj).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  envObj[pathKey] = `${HELPER_DIR}${process.platform === 'win32' ? ';' : ':'}${envObj[pathKey] || ''}`;

  // Convert object to array of KEY=VALUE strings for NAPI
  options.env = Object.entries(envObj).map(([k, v]) => `${k}=${v}`);

  // `execProcess` is a synchronous NAPI function: it returns the result object
  // directly (not a Promise).
  const res = execProcess(cmd, args || [], options);
  return {
    stdout: Buffer.from(res.stdout).toString('utf8'),
    stderr: Buffer.from(res.stderr).toString('utf8'),
    exitCode: res.exitCode,
    pid: res.pid,
  };
}

function norm(s) {
  return s.replace(/\r/g, '');
}

function testIsMusl() {
  console.log('Running unit tests for isMusl()...');
  const { isMusl } = require('../index.js');

  // Save originals
  const originalReportDescriptor = Object.getOwnPropertyDescriptor(process, 'report');

  function mockProcessReport(reportVal) {
    Object.defineProperty(process, 'report', {
      value: reportVal,
      configurable: true,
      writable: true,
      enumerable: true
    });
  }

  try {
    // Process.report is present and indicates glibc
    mockProcessReport({
      getReport: () => ({
        header: { glibcVersionRuntime: '2.31' }
      })
    });
    assert.strictEqual(isMusl(), false, 'isMusl() should be false if glibc is detected');

    // Process.report is present and indicates musl (no glibc version)
    mockProcessReport({
      getReport: () => ({
        header: {}
      })
    });
    assert.strictEqual(isMusl(), true, 'isMusl() should be true if glibc is not detected');

  } finally {
    // Restore originals
    if (originalReportDescriptor) {
      Object.defineProperty(process, 'report', originalReportDescriptor);
    } else {
      delete process.report;
    }
  }
  console.log('isMusl() unit tests passed successfully.');
}

async function main() {
  testIsMusl();
  console.log('Setting up dynamic test fixtures...');

  setupFixtures();

  // PATHEXT resolution: bare `say-foo` -> say-foo.bat on Windows.
  let r = run(path.join(FIXTURES, 'say-foo'), []);
  assert.strictEqual(norm(r.stdout).trim(), 'foo', 'pathext resolution');

  // Shebang via /usr/bin/env.
  r = run(path.join(FIXTURES, 'shebang'), []);
  assert.strictEqual(r.stdout, 'shebang works!', 'shebang /usr/bin/env');

  // Empty + spaced args using test_helper.
  r = run('test_helper', ['echo', 'foo', '', 'bar', 'André Cruz']);
  assert.strictEqual(norm(r.stdout), 'foo\n\nbar\nAndré Cruz', 'empty and spaced args');

  // Exit code 25.
  r = run('test_helper', ['exit', '25']);
  assert.strictEqual(r.exitCode, 25, 'exit code 25');

  // ENOENT for unknown command.
  let threw = false;
  try {
    run('somecommandthatwillneverexist', ['foo']);
  } catch (e) {
    threw = true;
  }
  assert.ok(threw, 'unknown command should throw');

  // No ENOENT when command exists but exits 1.
  r = run(path.join(FIXTURES, 'exit-1'), []);
  assert.strictEqual(r.exitCode, 1, 'exit-1 returns 1, no ENOENT');

  // No ENOENT when shebang interpreter is missing (file was found).
  r = run(path.join(FIXTURES, 'shebang-enoent'), []);
  assert.notStrictEqual(r.exitCode, 0, 'shebang-enoent runs but fails');

  // Command whose name is an environment variable (%CD%).
  r = run(path.join(FIXTURES, '%CD%'), []);
  assert.strictEqual(norm(r.stdout).trim(), 'special', 'env-var named command');

  // shell: true expands %RANDOM% on Windows.
  if (process.platform === 'win32') {
    r = run('echo', ['%RANDOM%'], { shell: true });
    assert.ok(/^\d+$/.test(norm(r.stdout).trim()), 'shell expands %RANDOM%');
  } else {
    r = run('echo', ['hello &&', 'echo there'], { shell: true });
    assert.strictEqual(norm(r.stdout).trim(), 'hello\nthere', 'shell compound command');
  }

  // Relative posix path.
  r = run(path.join('target', 'test_fixtures', 'say-foo'), []);
  assert.strictEqual(norm(r.stdout).trim(), 'foo', 'relative posix path');

  // Security check: control characters should throw an error on Windows
  if (process.platform === 'win32') {
    let threwSecurity = false;
    try {
      run(path.join(FIXTURES, 'say-foo'), ['hello\nworld']);
    } catch (e) {
      threwSecurity = e.message.toLowerCase().includes('newline') || e.message.toLowerCase().includes('invalid');
    }
    assert.ok(threwSecurity, 'control characters should throw security error');
  }

  // Test spawn (asynchronous streaming)
  console.log('-> verifying spawn (asynchronous)...');
  await new Promise((resolve, reject) => {
    let stdoutBuffer = [];
    const child = spawn(
      'node', ['-e', 'console.log("hello async");'],
      {},
      (err, chunk) => {
        if (chunk) stdoutBuffer.push(chunk);
      },
      (err, chunk) => {},
      (err, code) => {
        try {
          assert.strictEqual(code, 0, 'exit code of spawn should be 0');
          const output = Buffer.concat(stdoutBuffer).toString('utf8').trim();
          assert.strictEqual(output, 'hello async', 'async stdout matching');
          resolve();
        } catch (e) {
          reject(e);
        }
      }
    );
    assert.ok(child.pid > 0, 'spawned pid should be greater than 0');
  });
  console.log('-> spawn streaming verified.');

  // Test process termination (kill / killProcess)
  console.log('-> verifying process termination (child.kill())...');
  await new Promise((resolve, reject) => {
    const child = spawn(
      'node', ['-e', 'setTimeout(() => {}, 10000);'],
      {},
      (err, chunk) => {},
      (err, chunk) => {},
      (err, code) => {
        resolve();
      }
    );
    child.kill();
  });
  console.log('-> child.kill() verified.');

  console.log('-> verifying process termination (killProcess)...');
  await new Promise((resolve, reject) => {
    const child = spawn(
      'node', ['-e', 'setTimeout(() => {}, 10000);'],
      {},
      (err, chunk) => {},
      (err, chunk) => {},
      (err, code) => {
        resolve();
      }
    );
    killProcess(child.pid);
  });
  console.log('-> killProcess verified.');

  console.log('All rs-cross-spawn e2e tests passed.');
}

main().catch((e) => {
  console.error('rs-cross-spawn e2e tests FAILED:', e);
  process.exit(1);
});
