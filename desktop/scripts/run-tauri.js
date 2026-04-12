const { mkdirSync } = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const tauriArgs = process.argv.slice(2);

if (tauriArgs.length === 0) {
  console.error("Usage: node scripts/run-tauri.js <dev|build> [...args]");
  process.exit(1);
}

const env = { ...process.env };

if (process.platform === "win32" && !env.CARGO_TARGET_DIR) {
  // The LiveKit/WebRTC native dependency tree exceeds MAX_PATH inside the
  // default Tauri target directory on some Windows workspaces. A short target
  // path keeps desktop builds reproducible without changing the app code.
  const targetDir = path.join(os.tmpdir(), "singravox-tauri-target");
  mkdirSync(targetDir, { recursive: true });
  env.CARGO_TARGET_DIR = targetDir;
}

if (process.platform === "linux" && !`${env.RUSTFLAGS ?? ""}`.includes("--cap-lints")) {
  // rustc currently panics while rendering lint diagnostics for this Tauri
  // crate graph on Linux. Capping lints keeps local Linux/WSL builds stable
  // until the upstream compiler bug is fixed.
  env.RUSTFLAGS = `${env.RUSTFLAGS ?? ""} --cap-lints allow`.trim();
}

const child = spawn("tauri", tauriArgs, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

