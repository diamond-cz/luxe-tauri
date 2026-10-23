import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setInterval } from "node:timers";
import { pathToFileURL } from "node:url";

export const DEV_URL = "http://127.0.0.1:1420";
const PROJECT_MARKER = /<script type="module" src="\/src\/main\.tsx(?:\?[^\"]*)?"><\/script>/;

function isConnectionRefused(error) {
  return error?.cause?.code === "ECONNREFUSED" ||
    (error?.cause instanceof AggregateError &&
      error.cause.errors.every((cause) => cause.code === "ECONNREFUSED"));
}

export async function probeDevServer(url = DEV_URL) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return { status: "occupied" };
    const html = await response.text();
    return { status: PROJECT_MARKER.test(html) && html.includes("<title>LUXE</title>") && html.includes("/@vite/client")
      ? "luxe" : "occupied" };
  } catch (error) {
    return { status: isConnectionRefused(error) ? "free" : "occupied" };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { status } = await probeDevServer();
  if (status === "occupied") {
    console.error("端口 1420 已被其他服务占用。请关闭该服务后重新运行 npm run tauri:dev。");
    process.exitCode = 1;
  } else if (status === "luxe") {
    console.log("端口 1420 已运行本项目 Vite，复用现有开发服务器。");
    setInterval(() => {}, 60_000);
  } else {
    const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", (error) => {
      console.error("启动 Vite 失败：", error);
      process.exitCode = 1;
    });
    child.once("exit", (code) => { process.exitCode = code ?? 1; });
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => child.kill(signal));
    }
  }
}
