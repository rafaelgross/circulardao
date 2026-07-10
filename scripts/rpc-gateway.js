const http = require("http");

const PUBLIC_PORT = Number(process.env.PUBLIC_PORT || 8545);
const RPC_HOST = process.env.RPC_HOST || "127.0.0.1";
const RPC_PORT = Number(process.env.RPC_PORT || 8546);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    return res.end();
  }

  if (req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      service: "Hardhat JSON-RPC Gateway",
      message: "Use POST com JSON-RPC. Exemplo: {\"jsonrpc\":\"2.0\",\"method\":\"eth_chainId\",\"params\":[],\"id\":1}",
      upstream: `http://${RPC_HOST}:${RPC_PORT}`
    });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      ok: false,
      error: "Método não suportado. Use GET para status ou POST para JSON-RPC."
    });
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 2 * 1024 * 1024) {
      req.destroy();
    }
  });

  req.on("end", () => {
    if (!body.trim()) {
      return sendJson(res, 400, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Empty request body. Envie um JSON-RPC válido no POST."
        }
      });
    }

    try {
      JSON.parse(body);
    } catch (err) {
      return sendJson(res, 400, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: `JSON inválido: ${err.message}`
        }
      });
    }

    const proxyReq = http.request({
      hostname: RPC_HOST,
      port: RPC_PORT,
      method: "POST",
      path: "/",
      headers: {
        "Content-Type": req.headers["content-type"] || "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, (proxyRes) => {
      let responseBody = "";
      proxyRes.on("data", (chunk) => { responseBody += chunk; });
      proxyRes.on("end", () => {
        res.writeHead(proxyRes.statusCode || 200, {
          "Content-Type": proxyRes.headers["content-type"] || "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        });
        res.end(responseBody);
      });
    });

    proxyReq.on("error", (err) => {
      sendJson(res, 502, {
        ok: false,
        error: `Falha ao encaminhar para o nó Hardhat: ${err.message}`,
        upstream: `http://${RPC_HOST}:${RPC_PORT}`
      });
    });

    proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PUBLIC_PORT, "0.0.0.0", () => {
  console.log(`RPC gateway ouvindo em http://0.0.0.0:${PUBLIC_PORT} -> http://${RPC_HOST}:${RPC_PORT}`);
});
