import test from "node:test";
import assert from "node:assert/strict";
import { ConectorMercadoLivre, ProvedorLinkMercadoLivre, deMercadoLivre } from "../servidor/integracoes/mercado-livre/conector.js";

test("deMercadoLivre: mapeia produto e calcula preço antigo somente se for maior que o preço atual", () => {
  const itemBruto = {
    id: "MLB123456789",
    title: "Parafusadeira de Impacto 20V",
    price: 350.0,
    original_price: 420.0,
    thumbnail: "http://ml.com/thumb-I.jpg",
    available_quantity: 15,
    sold_quantity: 250,
    condition: "new",
  };

  const norm = deMercadoLivre(itemBruto, "ferr", "https://produto.mercadolivre.com.br/MLB123456789?matt_tool=citshop");
  assert.equal(norm.id, "ml-MLB123456789");
  assert.equal(norm.loja, "mercado-livre");
  assert.equal(norm.preco, 350.0);
  assert.equal(norm.precoAntigo, 420.0);
  assert.equal(norm.disponibilidade, "em_estoque");
  assert.equal(norm.temAtribuicaoAfiliado, true);
  assert.ok(norm.link.includes("matt_tool=citshop"));
});

test("ProvedorLinkMercadoLivre: recusa links sem parâmetros de afiliado e aceita quando tag está configurada", async () => {
  const provedorSemTag = new ProvedorLinkMercadoLivre();
  const linkSemTag = await provedorSemTag.gerarLinkAfiliado({
    urlOriginal: "https://produto.mercadolivre.com.br/MLB-123",
  });
  // Sem tag e sem gerador autorizado, deve devolver null
  assert.equal(linkSemTag, null);

  const provedorComTag = new ProvedorLinkMercadoLivre({ tagAfiliado: "citshop_affiliate" });
  const linkComTag = await provedorComTag.gerarLinkAfiliado({
    urlOriginal: "https://produto.mercadolivre.com.br/MLB-123",
  });
  assert.ok(linkComTag.includes("matt_word=citshop_affiliate"));
  assert.equal(provedorComTag.validarLinkAfiliado(linkComTag), true);
});

test("ConectorMercadoLivre: ignora itens sem estoque e registra sucesso", async () => {
  const mockFetch = async (url) => {
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            id: "MLB111",
            title: "Item Com Estoque",
            price: 99.9,
            available_quantity: 5,
            permalink: "https://produto.mercadolivre.com.br/MLB-111",
          },
          {
            id: "MLB222",
            title: "Item Esgotado",
            price: 50.0,
            available_quantity: 0,
            permalink: "https://produto.mercadolivre.com.br/MLB-222",
          },
        ],
      }),
    };
  };

  const conector = new ConectorMercadoLivre({
    fetchImpl: mockFetch,
    provedorLink: new ProvedorLinkMercadoLivre({ tagAfiliado: "test_tag" }),
  });

  const ofertas = await conector.buscarOfertas({ termos: ["teste"], categorias: ["casa"] });
  assert.equal(ofertas.length, 1);
  assert.equal(ofertas[0].id, "ml-MLB111");
  assert.equal(conector.obterStatus().disponivel, true);
});
