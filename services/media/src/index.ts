import http from "node:http";

const PORT = parseInt(process.env.PORT || "3003", 10);

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/health/ready") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "media",
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, () => {
  console.log(`Media service listening on port ${PORT}`);
});

export { server };
