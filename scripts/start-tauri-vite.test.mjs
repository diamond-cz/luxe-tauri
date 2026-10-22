import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { probeDevServer } from "./start-tauri-vite.mjs";

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("detects an unused development port", async () => {
  let url;
  await withServer((_request, response) => response.end(), async (address) => { url = address; });
  assert.deepEqual(await probeDevServer(url), { status: "free" });
});

test("reuses only the LUXE Vite development server", async () => {
  await withServer((_request, response) => {
    response.end('<script type="module" src="/@vite/client"></script><title>LUXE</title><script type="module" src="/src/main.tsx?t=123"></script>');
  }, async (url) => {
    assert.deepEqual(await probeDevServer(url), { status: "luxe" });
  });
});

test("does not reuse another service on the same port", async () => {
  await withServer((_request, response) => response.end("other app"), async (url) => {
    assert.deepEqual(await probeDevServer(url), { status: "occupied" });
  });
});
