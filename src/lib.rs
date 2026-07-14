use std::io::Read;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;

use napi::*;
use napi::bindgen_prelude::Buffer;
use napi::threadsafe_function::*;
use napi_derive::napi;

#[napi(object)]
pub struct SpawnOptions {
    pub cwd: Option<String>,
    pub env: Option<Vec<String>>,
    pub windows_hide: Option<bool>,
    pub shell: Option<bool>,
}

fn configure_command(cmd: &str, args: &[String], options: &Option<SpawnOptions>) -> cross_spawn::Command {
    let mut builder = cross_spawn::Command::new(cmd);
    builder.args(args);

    #[cfg(windows)]
    builder.double_escape_validator(|path| {
        let lower = path.to_string_lossy().to_lowercase();
        if !lower.ends_with(".cmd") {
            return false;
        }
        let norm = lower.replace('\\', "/");
        if let Some(idx) = norm.find("node_modules/.bin/") {
            let after = &norm[idx + "node_modules/.bin/".len()..];
            !after.contains('/')
        } else {
            false
        }
    });

    if let Some(opts) = options {
        if let Some(cwd) = &opts.cwd {
            builder.current_dir(cwd);
        }
        if let Some(env_vars) = &opts.env {
            builder.env_clear();
            for entry in env_vars {
                if let Some((k, v)) = entry.split_once('=') {
                    builder.env(k, v);
                }
            }
        }
        if let Some(shell) = opts.shell {
            builder.shell(shell);
        }
        #[cfg(windows)]
        if opts.windows_hide.unwrap_or(false) {
            builder.windows_hide(true);
        }
    }

    builder
}

#[napi]
pub fn exec_process(
    env: Env,
    cmd: String,
    args: Vec<String>,
    options: Option<SpawnOptions>,
) -> Result<JsObject> {
    if cmd.is_empty() {
        return Err(Error::new(Status::InvalidArg, "[execProcess] EMPTY_COMMAND"));
    }

    let mut builder = configure_command(&cmd, &args, &options);
    builder.stdout(std::process::Stdio::piped());
    builder.stderr(std::process::Stdio::piped());

    let mut child = builder.spawn().map_err(|e| {
        Error::new(Status::GenericFailure, format!("[execProcess] {}", e))
    })?;

    let pid = child.id() as i32;
    if pid <= 0 {
        return Err(Error::new(Status::GenericFailure, "[execProcess] INVALID_PID"));
    }

    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();

    if let Some(ref mut out) = child.stdout {
        out.read_to_end(&mut stdout_buf)
            .map_err(|_| Error::new(Status::GenericFailure, "[execProcess] READ_ERROR"))?;
    }

    if let Some(ref mut err) = child.stderr {
        err.read_to_end(&mut stderr_buf)
            .map_err(|_| Error::new(Status::GenericFailure, "[execProcess] READ_ERROR"))?;
    }

    let status = child
        .wait()
        .map_err(|_| Error::new(Status::GenericFailure, "[execProcess] WAIT_ERROR"))?;

    let exit_code = status.code().unwrap_or(-1);

    let mut obj = env.create_object()?;
    obj.set_named_property("pid", pid)?;
    obj.set_named_property("stdout", Buffer::from(stdout_buf))?;
    obj.set_named_property("stderr", Buffer::from(stderr_buf))?;
    obj.set_named_property("exitCode", exit_code)?;

    Ok(obj)
}

#[napi]
pub fn spawn(
    env: Env,
    cmd: String,
    args: Vec<String>,
    options: Option<SpawnOptions>,
    on_stdout: Option<JsFunction>,
    on_stderr: Option<JsFunction>,
    on_exit: Option<JsFunction>,
) -> Result<JsObject> {
    if cmd.is_empty() {
        return Err(Error::new(Status::InvalidArg, "[spawn] empty command"));
    }

    let mut builder = configure_command(&cmd, &args, &options);
    builder.stdout(std::process::Stdio::piped());
    builder.stderr(std::process::Stdio::piped());

    let mut child = builder.spawn().map_err(|e| {
        Error::new(Status::GenericFailure, format!("[spawn] {}", e))
    })?;

    let pid = child.id();
    let killed = Arc::new(AtomicBool::new(false));

    let tsfn_stdout = if let Some(func) = on_stdout {
        let tsfn: ThreadsafeFunction<Vec<u8>> =
            env.create_threadsafe_function(&func, 0, |ctx: ThreadSafeCallContext<Vec<u8>>| {
                Ok(vec![Buffer::from(ctx.value)])
            })?;
        Some(tsfn)
    } else {
        None
    };

    let tsfn_stderr = if let Some(func) = on_stderr {
        let tsfn: ThreadsafeFunction<Vec<u8>> =
            env.create_threadsafe_function(&func, 0, |ctx: ThreadSafeCallContext<Vec<u8>>| {
                Ok(vec![Buffer::from(ctx.value)])
            })?;
        Some(tsfn)
    } else {
        None
    };

    let tsfn_exit = if let Some(func) = on_exit {
        let tsfn: ThreadsafeFunction<i32> =
            env.create_threadsafe_function(&func, 0, |ctx: ThreadSafeCallContext<i32>| {
                Ok(vec![ctx.value])
            })?;
        Some(tsfn)
    } else {
        None
    };

    let k1 = killed.clone();
    let k2 = killed.clone();
    thread::spawn(move || {
        if let Some(tsfn) = tsfn_stdout {
            let k = k1.clone();
            if let Some(mut stdout) = child.stdout.take() {
                thread::spawn(move || {
                    let mut buf = [0u8; 8192];
                    loop {
                        if k.load(Ordering::Relaxed) {
                            let _ = stdout.read_to_end(&mut vec![]);
                            break;
                        }
                        match stdout.read(&mut buf) {
                            Ok(0) => break,
                            Ok(n) => {
                                let chunk = buf[..n].to_vec();
                                if Status::Ok != tsfn.call(Ok(chunk), ThreadsafeFunctionCallMode::NonBlocking) {
                                    break;
                                }
                            }
                            Err(_) => break,
                        }
                    }
                });
            }
        }

        if let Some(tsfn) = tsfn_stderr {
            let k = k2.clone();
            if let Some(mut stderr) = child.stderr.take() {
                thread::spawn(move || {
                    let mut buf = [0u8; 8192];
                    loop {
                        if k.load(Ordering::Relaxed) {
                            let _ = stderr.read_to_end(&mut vec![]);
                            break;
                        }
                        match stderr.read(&mut buf) {
                            Ok(0) => break,
                            Ok(n) => {
                                let chunk = buf[..n].to_vec();
                                if Status::Ok != tsfn.call(Ok(chunk), ThreadsafeFunctionCallMode::NonBlocking) {
                                    break;
                                }
                            }
                            Err(_) => break,
                        }
                    }
                });
            }
        }

        let exit_code = child
            .wait()
            .map(|s| s.code().unwrap_or(-1))
            .unwrap_or(-1);

        if let Some(tsfn) = tsfn_exit {
            let _ = tsfn.call(Ok(exit_code), ThreadsafeFunctionCallMode::NonBlocking);
        }
    });

    let mut obj = env.create_object()?;
    obj.set_named_property("pid", pid as i32)?;

    let kill_k = killed.clone();
    let kill_fn = env.create_function_from_closure("kill", move |_: CallContext<'_>| {
        kill_k.store(true, Ordering::Relaxed);
        cross_spawn::kill(pid).map_err(|e| {
            Error::new(Status::GenericFailure, format!("[kill] {}", e))
        })
    })?;
    obj.set_named_property("kill", kill_fn)?;

    Ok(obj)
}

#[napi]
pub fn kill_process(pid: i32) -> Result<()> {
    if pid <= 0 {
        return Err(Error::new(Status::InvalidArg, "[killProcess] invalid pid"));
    }
    cross_spawn::kill(pid as u32).map_err(|e| {
        Error::new(Status::GenericFailure, format!("[killProcess] {}", e))
    })
}
