import net from "node:net";

const pipe = "\\\\.\\pipe\\luxe-image-sync-v1";
const imagePath = process.argv[2];
if (!imagePath) {
  console.error("usage: node plugins/tools/image-sync-client.mjs C:\\images\\IMG_0001.jpg");
  process.exitCode = 2;
} else {
  const socket = net.createConnection(pipe);
  socket.setEncoding("utf8");
  socket.on("connect", () => {
    socket.write(`${JSON.stringify({
      protocolVersion: 1,
      kind: "selection",
      sourceInstance: "image-sync-cli",
      sequence: Date.now(),
      imagePath,
    })}\n`);
  });
  socket.on("data", (chunk) => process.stdout.write(chunk));
  socket.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  setTimeout(() => socket.end(), 1000);
}
