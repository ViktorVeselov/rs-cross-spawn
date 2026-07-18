const { platform, arch } = process

let nativeBinding = null
let loadError = null

function isMusl() {
  if (process.report && typeof process.report.getReport === 'function') {
    try {
      const report = process.report.getReport()
      const header = typeof report === 'string' ? JSON.parse(report).header : report.header
      return !header.glibcVersionRuntime
    } catch (e) {}
  }
  return false
}

switch (platform) {
  case 'android':
    switch (arch) {
      case 'arm64':
        try {
          nativeBinding = require('./rs-cross-spawn.android-arm64.node')
        } catch (e) {
          try {
            nativeBinding = require('@rs-cross-spawn/android-arm64')
          } catch (err) {
            loadError = err
          }
        }
        break
      case 'arm':
        try {
          nativeBinding = require('./rs-cross-spawn.android-arm-eabi.node')
        } catch (e) {
          try {
            nativeBinding = require('@rs-cross-spawn/android-arm-eabi')
          } catch (err) {
            loadError = err
          }
        }
        break
      default:
        throw new Error(`Unsupported architecture on Android ${arch}`)
    }
    break
  case 'win32':
    switch (arch) {
      case 'x64':
        try {
          nativeBinding = require('./rs-cross-spawn.win32-x64-msvc.node')
        } catch (e) {
          try {
            nativeBinding = require('@rs-cross-spawn/win32-x64-msvc')
          } catch (err) {
            loadError = err
          }
        }
        break
      case 'ia32':
        try {
          nativeBinding = require('./rs-cross-spawn.win32-ia32-msvc.node')
        } catch (e) {
          try {
            nativeBinding = require('@rs-cross-spawn/win32-ia32-msvc')
          } catch (err) {
            loadError = err
          }
        }
        break
      case 'arm64':
        try {
          nativeBinding = require('./rs-cross-spawn.win32-arm64-msvc.node')
        } catch (e) {
          try {
            nativeBinding = require('@rs-cross-spawn/win32-arm64-msvc')
          } catch (err) {
            loadError = err
          }
        }
        break
      default:
        throw new Error(`Unsupported architecture on Windows: ${arch}`)
    }
    break
  case 'darwin':
    try {
      nativeBinding = require('./rs-cross-spawn.darwin-universal.node')
    } catch (e) {
      try {
        nativeBinding = require('@rs-cross-spawn/darwin-universal')
      } catch (err) {
        // Continue to check specific architecture
      }
    }
    if (!nativeBinding) {
      switch (arch) {
        case 'x64':
          try {
            nativeBinding = require('./rs-cross-spawn.darwin-x64.node')
          } catch (e) {
            try {
              nativeBinding = require('@rs-cross-spawn/darwin-x64')
            } catch (err) {
              loadError = err
            }
          }
          break
        case 'arm64':
          try {
            nativeBinding = require('./rs-cross-spawn.darwin-arm64.node')
          } catch (e) {
            try {
              nativeBinding = require('@rs-cross-spawn/darwin-arm64')
            } catch (err) {
              loadError = err
            }
          }
          break
        default:
          throw new Error(`Unsupported architecture on macOS: ${arch}`)
      }
    }
    break
  case 'freebsd':
    if (arch !== 'x64') {
      throw new Error(`Unsupported architecture on FreeBSD: ${arch}`)
    }
    try {
      nativeBinding = require('./rs-cross-spawn.freebsd-x64.node')
    } catch (e) {
      try {
        nativeBinding = require('@rs-cross-spawn/freebsd-x64')
      } catch (err) {
        loadError = err
      }
    }
    break
  case 'linux':
    switch (arch) {
      case 'x64':
        if (isMusl()) {
          try {
            nativeBinding = require('./rs-cross-spawn.linux-x64-musl.node')
          } catch (e) {
            try {
              nativeBinding = require('@rs-cross-spawn/linux-x64-musl')
            } catch (err) {
              loadError = err
            }
          }
        } else {
          try {
            nativeBinding = require('./rs-cross-spawn.linux-x64-gnu.node')
          } catch (e) {
            try {
              nativeBinding = require('@rs-cross-spawn/linux-x64-gnu')
            } catch (err) {
              loadError = err
            }
          }
        }
        break
      case 'arm64':
        if (isMusl()) {
          try {
            nativeBinding = require('./rs-cross-spawn.linux-arm64-musl.node')
          } catch (e) {
            try {
              nativeBinding = require('@rs-cross-spawn/linux-arm64-musl')
            } catch (err) {
              loadError = err
            }
          }
        } else {
          try {
            nativeBinding = require('./rs-cross-spawn.linux-arm64-gnu.node')
          } catch (e) {
            try {
              nativeBinding = require('@rs-cross-spawn/linux-arm64-gnu')
            } catch (err) {
              loadError = err
            }
          }
        }
        break
      case 'arm':
        if (isMusl()) {
          try {
            nativeBinding = require('./rs-cross-spawn.linux-arm-musleabihf.node')
          } catch (e) {
            try {
              nativeBinding = require('@rs-cross-spawn/linux-arm-musleabihf')
            } catch (err) {
              loadError = err
            }
          }
        } else {
          try {
            nativeBinding = require('./rs-cross-spawn.linux-arm-gnueabihf.node')
          } catch (e) {
            try {
              nativeBinding = require('@rs-cross-spawn/linux-arm-gnueabihf')
            } catch (err) {
              loadError = err
            }
          }
        }
        break
      case 'riscv64':
        if (isMusl()) {
          try {
            nativeBinding = require('./rs-cross-spawn.linux-riscv64-musl.node')
          } catch (e) {
            try {
              nativeBinding = require('@rs-cross-spawn/linux-riscv64-musl')
            } catch (err) {
              loadError = err
            }
          }
        } else {
          try {
            nativeBinding = require('./rs-cross-spawn.linux-riscv64-gnu.node')
          } catch (e) {
            try {
              nativeBinding = require('@rs-cross-spawn/linux-riscv64-gnu')
            } catch (err) {
              loadError = err
            }
          }
        }
        break
      case 's390x':
        try {
          nativeBinding = require('./rs-cross-spawn.linux-s390x-gnu.node')
        } catch (e) {
          try {
            nativeBinding = require('@rs-cross-spawn/linux-s390x-gnu')
          } catch (err) {
            loadError = err
          }
        }
        break
      default:
        throw new Error(`Unsupported architecture on Linux: ${arch}`)
    }
    break
  default:
    throw new Error(`Unsupported OS: ${platform}, architecture: ${arch}`)
}

if (!nativeBinding) {
  if (loadError) {
    throw loadError
  }
  throw new Error(`Failed to load native binding`)
}

const { execProcess, spawn, killProcess } = nativeBinding

module.exports.execProcess = execProcess
module.exports.spawn = spawn
module.exports.killProcess = killProcess
module.exports.isMusl = isMusl
