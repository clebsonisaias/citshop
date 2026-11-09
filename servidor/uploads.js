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

/** Recebe o campo de imagens. Erro do multer vira 400 com mensagem clara. */
function receber(campo, max) {
  return (req, res, next) => upload.array(campo, max)(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === "LIMIT_FILE_SIZE" ? "Imagem grande demais (máximo 8 MB)."
      : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? `Envie no máximo ${max} ${max > 1 ? "fotos" : "imagem"}.`
      : "Não foi possível receber a imagem.";
    res.status(400).json({ erro: msg });
  });
}
export const receberFotos = receber("fotos", MAX_FOTOS);
export const receberLogo = receber("logo", 1);

/** Foto de produto: até 1200px sem cortar. Logo: quadrado de 400px, recortado no centro. */
export async function salvarFoto(buffer, dir, { logo = false } = {}) {
  await mkdir(dir, { recursive: true });
  const nome = `${randomUUID()}.webp`;
  const tamanho = logo
    ? { width: 400, height: 400, fit: "cover" }
    : { width: 1200, height: 1200, fit: "inside", withoutEnlargement: true };
  try {
    // limitInputPixels: um PNG pequeno pode descomprimir para gigabytes.
    await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate()
      .resize(tamanho)
      .webp({ quality: 82 }).toFile(join(dir, nome));
  } catch {
    throw Object.assign(new Error("Foto inválida ou formato não suportado. Use JPG, PNG ou WebP."), { status: 400 });
  }
  return `/uploads/${nome}`;
}

export async function apagarFoto(url, dir) {
  if (!String(url).startsWith("/uploads/")) return;
  await unlink(join(dir, basename(url))).catch(() => {});
  await unlink(join(dir, `og-${basename(url, ".webp")}.jpg`)).catch(() => {}); // prévia do WhatsApp, se já gerada
}
