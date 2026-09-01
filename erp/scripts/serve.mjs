import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
const port = Number.parseInt(portArgument?.slice("--port=".length) ?? process.env.CRYO_ERP_PORT ?? "4173", 10);
const host = "127.0.0.1";

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("CRYO ERP preview port must be an integer from 1024 to 65535.");
}
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function resolveRequestPath(rawUrl) {
  const url = new URL(rawUrl, `http://${host}:${port}`);
  const decoded = decodeURIComponent(url.pathname);
  const relativePath = normalize(decoded).replace(/^[/\\]+/, "");
  const candidate = resolve(repoRoot, relativePath || "index.html");
  if (candidate !== repoRoot && !candidate.startsWith(`${repoRoot}${sep}`)) return null;
  return candidate;
}

const server = createServer(async (request, response) => {
  try {
    let filePath = resolveRequestPath(request.url ?? "/");
    if (!filePath) {
      response.writeHead(400).end("Bad request");
      return;
    }

    let fileStat = await stat(filePath).catch(() => null);
    if (fileStat?.isDirectory()) {
      filePath = join(filePath, "index.html");
      fileStat = await stat(filePath).catch(() => null);
    }

    if (!fileStat?.isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Internal server error");
  }
});

server.listen(port, host, () => {
  console.log(`CRYO ERP local preview: http://${host}:${port}/erp/`);
});
