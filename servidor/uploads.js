/**
 * Fotos de produtos: recebidas em memória (multer), convertidas para WebP 1200px (sharp)
 * e gravadas no volume. Baseado em citmax-delivery/apps/api/src/lib/uploads.ts.
 */
import multer from "multer";
import sharp from "sharp";
import { mkdir, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";

export const MAX_FOTOS = 4;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: MAX_FOTOS, fields: 20 },
  fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
});

/** Campo `fotos` (até 4). Erro do multer vira 400 com mensagem clara. */
export function receberFotos(req, res, next) {
  upload.array("fotos", MAX_FOTOS)(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === "LIMIT_FILE_SIZE" ? "Foto grande demais (máximo 8 MB)."
      : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? `Envie no máximo ${MAX_FOTOS} fotos.`
      : "Não foi possível receber as fotos.";
    res.status(400).json({ erro: msg });
  });
}

export async function salvarFoto(buffer, dir) {
  await mkdir(dir, { recursive: true });
  const nome = `${randomUUID()}.webp`;
  try {
    // limitInputPixels: um PNG pequeno pode descomprimir para gigabytes.
    await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 }).toFile(join(dir, nome));
  } catch {
    throw Object.assign(new Error("Foto inválida ou formato não suportado. Use JPG, PNG ou WebP."), { status: 400 });
  }
  return `/uploads/${nome}`;
}

export async function apagarFoto(url, dir) {
  if (!String(url).startsWith("/uploads/")) return;
  await unlink(join(dir, basename(url))).catch(() => {});
}
