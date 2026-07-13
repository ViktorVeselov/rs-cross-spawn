# rs-cross-spawn

Cross-platform process spawning powered by Rust — a drop-in native replacement for `child_process.spawn` with PATHEXT resolution, CMD built-in detection, and `CREATE_NO_WINDOW` support.

Built with [napi-rs](https://napi.rs) wrapping the [cross-spawn](https://crates.io/crates/cross-spawn) Rust crate.

## Why?

The npm package `cross-spawn` solves cross-platform spawn issues by adding fallback logic in JavaScript. `rs-cross-spawn` solves the same problem at the native layer — one implementation, no fallback, no JavaScript workarounds.

## API

### `execProcess(cmd, args?, options?) → { pid, stdout, stderr, exitCode }`

Buffered execution — spawns a process and returns stdout/stderr as buffers once it exits.

```js
const { execProcess } = require('rs-cross-spawn');
const result = execProcess('node', ['-e', 'console.log("hi")']);
console.log(result.stdout.toString()); // "hi\n"
```

### `spawn(cmd, args?, options?, onStdout?, onStderr?, onExit?) → { pid, kill() }`

Streaming execution — buffers of stdout/stderr are delivered via callbacks as they arrive.

Callbacks receive `(error, value)` following Node.js convention (first argument is `null` on success).

```js
const { spawn } = require('rs-cross-spawn');
const child = spawn(
  'node', ['-e', 'setInterval(() => console.log("tick"), 1000)'],
  { windows_hide: true },
  (err, chunk) => process.stdout.write(chunk),  // onStdout
  (err, chunk) => process.stderr.write(chunk),  // onStderr
  (err, code) => console.log('exited with', code) // onExit
);
// later: child.kill();
```

### `killProcess(pid) → void`

Kill a process tree by PID. Uses `taskkill /F /T` on Windows, `kill -TERM` on Unix.

## Options

| Option | Type | Description |
|--------|------|-------------|
| `cwd` | `string?` | Working directory |
| `env` | `string[]?` | Environment variables (`KEY=VALUE`). Clears inherited env. |
| `windows_hide` | `boolean?` | (Windows only) `CREATE_NO_WINDOW` flag — no console window pops up |
| `shell` | `boolean?` | Run via shell (`cmd.exe` or `/bin/sh`) |

## License

MIT
