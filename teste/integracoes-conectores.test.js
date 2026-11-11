import test from "node:test";
import assert from "node:assert/strict";
import { ConectorAmazon, comTag, deAmazon } from "../servidor/integracoes/amazon/conector.js";
import { ConectorShopee, ProvedorLinkShopee, deShopee } from "../servidor/integracoes/shopee/conector.js";

test("ConectorAmazon: normaliza produto sem inventar preço antigo e garante tag", () => {
  const itemBruto = {
    asin: "B0EXAMPLE1",
    itemInfo: { title: { displayValue: "Fone Sem Fio Bluetooth" }, features: { displayValues: ["Bateria 30h"] } },
    images: { primary: { large: { url: "https://m.media-amazon.com/fone.jpg" } } },
    offersV2: {
      listings: [
        { price: { money: { amount: 159.9 } }, availability: { type: "NOW" }, savingBasis: { money: { amount: 199.9 } } },
      ],
    },
    detailPageURL: "https://www.amazon.com.br/dp/B0EXAMPLE1",
  };

  const norm = deAmazon(itemBruto, "tec", "citshop-20");
  assert.equal(norm.id, "amazon-B0EXAMPLE1");
  assert.equal(norm.loja, "amazon");
  assert.equal(norm.preco, 159.9);
  assert.equal(norm.precoAntigo, 199.9);
  assert.ok(norm.link.includes("tag=citshop-20"));
});

test("ConectorAmazon: busca com mock de token e catalog API", async () => {
  let tokenChamado = false;
  let catalogChamado = false;

  const mockFetch = async (url, opts) => {
    if (url.includes("/auth/o2/token")) {
      tokenChamado = true;
      return { ok: true, json: async () => ({ access_token: "token_abc", expires_in: 3600 }) };
    }
    if (url.includes("/catalog/v1/searchItems")) {
      catalogChamado = true;
      return {
        ok: true,
        json: async () => ({
          searchResult: {
            items: [
              {
                asin: "B0TESTE1",
                itemInfo: { title: { displayValue: "Air Fryer Inox 4L" } },
                images: { primary: { large: { url: "https://m.media-amazon.com/airfryer.jpg" } } },
                offersV2: { listings: [{ price: { money: { amount: 289.0 } } }] },
                detailPageURL: "https://www.amazon.com.br/dp/B0TESTE1",
              },
            ],
          },
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  const conector = new ConectorAmazon({
    credencialId: "id123",
    credencialSegredo: "sec123",
    parceiro: "citshop-20",
    fetchImpl: mockFetch,
  });

  const ofertas = await conector.buscarOfertas({ termos: ["air fryer"], categorias: ["cozinha"] });
  assert.equal(tokenChamado, true);
  assert.equal(catalogChamado, true);
  assert.equal(ofertas.length, 1);
  assert.equal(ofertas[0].id, "amazon-B0TESTE1");
  assert.equal(ofertas[0].preco, 289.0);
  assert.equal(conector.obterStatus().disponivel, true);
});

test("ConectorShopee: normaliza produto e não inventa preço antigo", () => {
  const itemBruto = {
    itemId: 12345678,
    productName: "Smartwatch Esportivo Pro",
    priceMin: "129.90",
    priceDiscountRate: "40%",
    ratingStar: "4.8",
    sales: "5000",
    imageUrl: "https://down-bs-br.img.susercontent.com/watch.webp",
    commissionRate: 15,
    commission: 19.48,
  };

  const norm = deShopee(itemBruto, "tec", "https://s.shopee.com.br/abc123xyz");
  assert.equal(norm.id, "shopee-12345678");
  assert.equal(norm.preco, 129.9);
  assert.equal(norm.precoAntigo, null);
  assert.equal(norm.comissaoPct, 15);
  assert.equal(norm.link, "https://s.shopee.com.br/abc123xyz");
});

test("ProvedorLinkShopee: valida links de afiliados existentes", () => {
  const provedor = new ProvedorLinkShopee();
  assert.equal(provedor.validarLinkAfiliado("https://s.shopee.com.br/7Uyt6R"), true);
  assert.equal(provedor.validarLinkAfiliado("https://shope.ee/8IuhG"), true);
  assert.equal(provedor.validarLinkAfiliado("https://shopee.com.br/product/123/456?utm_source=an_123456"), true);
  assert.equal(provedor.validarLinkAfiliado("https://shopee.com.br/product/123/456"), false);
});

test("ConectorShopee: busca ofertas via GraphQL e gera link de afiliado", async () => {
  const mockFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.query.includes("productOfferV2")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            productOfferV2: {
              nodes: [
                {
                  itemId: 88888,
                  productName: "Cabo USB-C Rápido",
                  priceMin: "19.90",
                  imageUrl: "https://shopee.img/cabo.jpg",
                  productLink: "https://shopee.com.br/product/1/88888",
                },
              ],
            },
          },
        }),
      };
    }
    if (body.query.includes("generateBatchShortLink")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            generateBatchShortLink: {
              links: [{ originUrl: "https://shopee.com.br/product/1/88888", shortLink: "https://s.shopee.com.br/shortLink888", success: true }],
            },
          },
        }),
      };
    }
    if (body.query.includes("generateShortLink")) {
      return {
        ok: true,
        json: async () => ({
          data: { generateShortLink: { shortLink: "https://s.shopee.com.br/shortLink888" } },
        }),
      };
    }
    return { ok: false, status: 400 };
  };

  const conector = new ConectorShopee({
    appId: "app123",
    segredo: "sec456",
    fetchImpl: mockFetch,
  });

  const ofertas = await conector.buscarOfertas({ termos: ["cabo usb"], categorias: ["cel"] });
  assert.equal(ofertas.length, 1);
  assert.equal(ofertas[0].id, "shopee-88888");
  assert.equal(ofertas[0].link, "https://s.shopee.com.br/shortLink888");
});
