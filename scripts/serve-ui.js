const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.UI_PORT || 8080);
const root = path.resolve(__dirname, "..", "dao-ui");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

function send(res, status, content, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(content);
}

const server = http.createServer((req, res) => {
  const reqPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const target = path.normalize(path.join(root, reqPath));

  if (!target.startsWith(root)) {
    return send(res, 403, "Forbidden");
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      return send(res, 404, "Not found");
    }
    const ext = path.extname(target).toLowerCase();
    send(res, 200, data, mimeTypes[ext] || "application/octet-stream");
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`DAO UI disponível em http://0.0.0.0:${port}`);
});
