// Gera o executável único do Windows (Node SEA). Rodar NO WINDOWS, com Node 22:
//   npm run build:win   →   dist/citshop-print.exe
// Passos: junta src/ num arquivo só (esbuild via npx), cria o blob SEA e injeta no node.exe (postject via npx).
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
const run = (c) => execSync(c, { stdio: "inherit" });
mkdirSync("dist", { recursive: true });
run("npx --yes esbuild@0.24.0 src/app.js --bundle --platform=node --format=cjs --outfile=dist/app.cjs");
writeFileSync("dist/sea-config.json", JSON.stringify({ main: "dist/app.cjs", output: "dist/sea.blob", disableExperimentalSEAWarning: true }));
run("node --experimental-sea-config dist/sea-config.json");
copyFileSync(process.execPath, "dist/citshop-print.exe");
run("npx --yes postject@1.0.0-alpha.6 dist/citshop-print.exe NODE_SEA_BLOB dist/sea.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2");
console.log("Pronto: dist/citshop-print.exe (assine com o certificado da CITmax antes de distribuir).");
