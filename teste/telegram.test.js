import test from "node:test";
import assert from "node:assert/strict";
import { ConectorTelegram } from "../servidor/integracoes/telegram/conector.js";

test("ConectorTelegram formata texto HTML e botões corretamente", async () => {
  let payloadEnviado = null;
  const tg = new ConectorTelegram({
    botToken: "123456:FAKE_TOKEN",
    chatId: "@shopcitmax",
    fetchImpl: async (url, opts) => {
      payloadEnviado = { url, body: JSON.parse(opts.body) };
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 9988 } }),
      };
    },
  });

  assert.equal(tg.estaConfigurado(), true);

  const produto = {
    id: "shopee-999",
    nome: "Air Fryer 4L Inox Digital",
    preco: 199.9,
    precoAntigo: 399.9,
    vendidos: 1200,
    fotos: ["https://exemplo.com/foto.jpg"],
    link: "https://s.shopee.com.br/teste123",
  };

  const res = await tg.enviarOferta({ produto, urlPublica: "https://shop.citmax.com.br" });
  assert.equal(res.sucesso, true);
  assert.equal(res.messageId, 9988);

  assert.ok(payloadEnviado.url.includes("/sendPhoto"));
  assert.equal(payloadEnviado.body.chat_id, "@shopcitmax");
  assert.equal(payloadEnviado.body.parse_mode, "HTML");
  assert.ok(payloadEnviado.body.caption.includes("Air Fryer 4L Inox Digital"));
  assert.ok(payloadEnviado.body.caption.includes("50% OFF"));

  const botoes = payloadEnviado.body.reply_markup.inline_keyboard;
  assert.ok(botoes.length >= 1);
  assert.match(botoes[0][0].url, /\/ir\/shopee-999\?c=telegram$/, "link pelo /ir com o canal Telegram");
});
