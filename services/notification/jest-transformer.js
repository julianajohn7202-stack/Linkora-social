const path = require("path");

let esbuild;
try {
  esbuild = require("esbuild");
} catch {
  // Fallback to pnpm hoist path
  const esbuildPath = path.resolve(
    __dirname,
    "../../node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild"
  );
  esbuild = require(esbuildPath);
}

module.exports = {
  process(sourceText, sourcePath) {
    const isTsx = sourcePath.endsWith(".tsx") || sourcePath.endsWith(".jsx");
    const result = esbuild.transformSync(sourceText, {
      loader: isTsx ? "tsx" : "ts",
      format: "cjs",
      target: "node18",
      sourcemap: "inline",
      sourcefile: sourcePath,
    });
    return { code: result.code };
  },
};
