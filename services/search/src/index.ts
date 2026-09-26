import http from "node:http";
import { checkDbConnection, closeDbPool } from "./db";

export * from "./ranking";
export * from "./db";

const PORT = parseInt(process.env.PORT || "3004", 10);

const server = http.createServer(async (req, res) => {
  if (req.url === "/health" || req.url === "/health/ready") {
    const dbHealthy = await checkDbConnection();
    const statusCode = dbHealthy ? 200 : 503;
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: dbHealthy ? "ok" : "degraded",
        service: "search",
        database: dbHealthy ? "connected" : "disconnected",
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, () => {
  console.log(`Search service listening on port ${PORT}`);
});

process.on("SIGTERM", async () => {
  server.close(async () => {
    await closeDbPool();
    process.exit(0);
  });
});

export { server };
