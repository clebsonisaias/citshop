/**
 * Conector oficial da Shopee Brasil via Affiliate Open API (GraphQL).
 * Suporta autenticação SHA256, consulta de ofertas (productOfferV2) e geração de shortlinks com comissão.
 */
import { createHash } from "node:crypto";
import { ConectorMarketplace, ErroConector, ProvedorLinkAfiliado, executarComRetry } from "../base.js";

const SHOPEE_API = "https://open-api.affiliate.shopee.com.br/graphql";

export const BUSCAS_PADRAO_SHOPEE = [
  // 1. Celulares & Acessórios
  { termo: "fone bluetooth", categoria: "cel" },
  { termo: "carregador celular rapido", categoria: "cel" },
  { termo: "suporte celular", categoria: "cel" },

  // 2. Eletrônicos & Tecnologia
  { termo: "smartwatch", categoria: "tec" },
  { termo: "caixa de som bluetooth", categoria: "tec" },
  { termo: "ring light tripe", categoria: "tec" },

  // 3. Informática
  { termo: "mouse gamer", categoria: "info" },
  { termo: "teclado mecanico", categoria: "info" },
  { termo: "suporte articulado notebook", categoria: "info" },

  // 4. Games & Consoles
  { termo: "video game portatil retro", categoria: "games" },
  { termo: "controle para pc sem fio", categoria: "games" },
  { termo: "headset gamer", categoria: "games" },

  // 5. Cozinha
  { termo: "air fryer fritadeira", categoria: "cozinha" },
  { termo: "garrafa termica inox", categoria: "cozinha" },
  { termo: "mini processador triturador eletrico", categoria: "cozinha" },

  // 6. Casa & Decoração
  { termo: "luminaria led sensor", categoria: "casa" },
  { termo: "mop giratorio limpeza", categoria: "casa" },
  { termo: "organizador gaveta", categoria: "casa" },

  // 7. Cama, Mesa e Banho
  { termo: "jogo lencol casal 400 fios", categoria: "cama" },
  { termo: "travesseiro ortopedico", categoria: "cama" },

  // 8. Eletrodomésticos
  { termo: "ventilador portatil", categoria: "eletro" },
  { termo: "mini ferro passar vapor", categoria: "eletro" },

  // 9. Moda
  { termo: "mochila impermeavel notebook", categoria: "moda" },
  { termo: "bolsa feminina transversal", categoria: "moda" },
  { termo: "relogio masculino esportivo", categoria: "moda" },

  // 10. Calçados
  { termo: "tenis esportivo corrida", categoria: "calc" },
  { termo: "chinelo slide nuvem", categoria: "calc" },

  // 11. Beleza e Perfumaria
  { termo: "escova secadora modeladora", categoria: "beleza" },
  { termo: "maquina cortar cabelo dragao", categoria: "beleza" },
  { termo: "kit pinceis maquiagem profissional", categoria: "beleza" },

  // 12. Brinquedos
  { termo: "brinquedo educativo montessori", categoria: "brinq" },
  { termo: "pop it eletronico game", categoria: "brinq" },

  // 13. Bebês
  { termo: "bolsa maternidade impermeavel", categoria: "bebe" },
  { termo: "mordedor bebe silicone", categoria: "bebe" },

  // 14. Saúde e Cuidados
  { termo: "creatina monohidratada pura", categoria: "saude" },
  { termo: "massageador eletrico corporal", categoria: "saude" },

  // 15. Esporte e Lazer
  { termo: "corda pular com rolamento", categoria: "esporte" },
  { termo: "faixa elastica kit treino funcional", categoria: "esporte" },

  // 16. Ferramentas
  { termo: "parafusadeira furadeira bateria", categoria: "ferr" },
  { termo: "kit chave catraca maleta", categoria: "ferr" },

  // 17. Automotivo
  { termo: "suporte celular veicular trava", categoria: "auto" },
  { termo: "aspirador de po automotivo", categoria: "auto" },

  // 18. Pet Shop
  { termo: "fonte bebedouro pet gato", categoria: "pets" },
  { termo: "cama pet almofada cachorro gato", categoria: "pets" },

  // 19. Papelaria & Escritório
  { termo: "caderno inteligente", categoria: "papel" },
  { termo: "estojo escolar organizador", categoria: "papel" },

  // 20. Livros & Leitura
  { termo: "leitura", categoria: "livros" },
  { termo: "quadrinhos", categoria: "livros" },

  // 21. Mercado & Alimentos
  { termo: "capsula cafe nespresso compativel", categoria: "mercado" },
  { termo: "chocolate importado", categoria: "mercado" },

  // 22. Camping & Sobrevivência (Facas Táticas, Canivetes, Fogareiros, Sacos de Dormir & Estações)
  { termo: "faca tatica", categoria: "camping" },
  { termo: "canivete tatica", categoria: "camping" },
  { termo: "saco de dormir", categoria: "camping" },
  { termo: "fogareiro camping", categoria: "camping" },
  { termo: "kit camping", categoria: "camping" },
  { termo: "colchonete camping", categoria: "camping" },
  { termo: "gerador solar", categoria: "camping" },
  { termo: "bainha", categoria: "camping" },

  // 23. Móveis
  { termo: "sapateira organizadora multiuso", categoria: "moveis" },
  { termo: "mesa dobravel para notebook cama", categoria: "moveis" },

  // 24. Jardim & Piscina (Refletores e Iluminação Solar)
  { termo: "refletor solar", categoria: "jardim" },
  { termo: "luminaria solar", categoria: "jardim" },
  { termo: "mangueira magica expansivel", categoria: "jardim" },

  // 25. Instrumentos Musicais
  { termo: "ukulele", categoria: "musica" },
  { termo: "palheta", categoria: "musica" },

  // 26. Especial de Natal (Casa & Decoração Natalina)
  { termo: "arvore natal", categoria: "casa" },
  { termo: "pisca pisca natal", categoria: "casa" },
  { termo: "enfeite natal", categoria: "casa" },
  { termo: "cascata led", categoria: "casa" },

  // 27. Energia Solar, Inversores, Placas & Baterias Portáteis
  { termo: "placa solar", categoria: "ferr" },
  { termo: "inversor solar", categoria: "ferr" },
  { termo: "power bank", categoria: "tec" },

  // 28. Destaques 11.11 / Super Ofertas
  { termo: "smartwatch prova dagua", categoria: "tec" },
  { termo: "fone sem fio tws", categoria: "cel" },
  { termo: "kit ferramentas maleta", categoria: "ferr" },
  { termo: "aspirador portatil sem fio", categoria: "casa" },
];

export function inferirCategoriaShopee(nome = "") {
  const n = String(nome).toLowerCase();
  // 0. Automotivo e Moda prioritários (evita que peças de carro ou roupas com 'bainha' caiam em camping)
  if (/traseira|dianteira|chicote|scania|reparo lanterna|farol|veicular|lampada automotiva|carro|caminhao|retrovisor|pneu|oleo motor/i.test(n)) return "auto";
  if (/top|calca|calça|vestido|blusa|saia|shorts|camisa|camiseta|jaqueta|casaco|cropped/i.test(n)) return "moda";
  // 1. Bebês e Crianças pequenas
  if (/mordedor|chupeta|maternidade|berco|fralda|biberon|carrinho de bebe|mamadeira|body bebe|infantil bebe/i.test(n)) return "bebe";
  // 2. Instrumentos Musicais
  if (/ukulele|violao|guitarra|afinador|palheta|teclado musical|cordas violao|cavaquinho|flauta|instrumento musical/i.test(n)) return "musica";
  // 3. Papelaria
  if (/caderno|estojo|caneta|papelaria|marca texto|post it|agenda|fichario|lapis de cor|bloco de notas/i.test(n)) return "papel";
  // 4. Livros
  if (/livro|e-book|leitura|biblia|literatura|biografia|quadrinhos|gibi/i.test(n)) return "livros";
  // 5. Games & Consoles
  if (/video game|game retro|ps4|ps5|xbox|nintendo|manete|gamepad|console retro/i.test(n)) return "games";
  // 6. Camping, Sobrevivência & Estações de Energia Portáteis
  if (/faca tatica|canivete|sobrevivencia|camping|saco de dormir|colchonete camping|fogareiro|gerador solar|gerador portatil|estacao de energia|invictus|tatico|tatica|militar|acampamento|faca esportiva|cantil|bussola|barraca|pesca/i.test(n)) return "camping";
  if (/(faca|canivete|adaga).*bainha|bainha.*(couro|faca|canivete|tatica)/i.test(n)) return "camping";
  if (/lanterna/i.test(n) && !/traseira|dianteira|carro|caminhao|veiculo|reparo/i.test(n)) return "camping";
  // 7. Móveis
  if (/sapateira|mesa dobravel|cadeira gamer|estante|prateleira|armario|rack|mesa de cabeceira|movel/i.test(n)) return "moveis";
  // 8. Jardim & Piscina (Refletores e Iluminação Solar)
  if (/refletor solar|luminaria solar|mangueira|jardim|piscina|tesoura de poda|regador|grama|adubo/i.test(n)) return "jardim";
  // 9. Mercado & Alimentos
  if (/capsula de cafe|capsula nespresso|chocolate|snack|biscoito|bala|tempero|alimento|bombom/i.test(n)) return "mercado";
  // 10. Natal & Iluminação Festiva
  if (/natal|arvore natal|pisca pisca|guirlanda|enfeite natal|cascata led/i.test(n)) return "casa";
  // 10. Celulares & Acessórios
  if (/fone|headset|auricular|tws|carregador|cabo tipo c|lightning|iphone|samsung|redmi|xiaomi|celular|smartphone|pelicula|capinha/i.test(n)) return "cel";
  // 11. Eletrônicos & Tecnologia (Power Banks e Baterias)
  if (/power bank|bateria portatil|smartwatch|relogio inteligente|bluetooth|caixa de som|ring light|tripé|dvr|camera|alexa|smart/i.test(n)) return "tec";
  // 12. Informática
  if (/mouse|teclado|notebook|computador|pc|gamer|monitor|gabinete|ssd|memoria ram|hdmi|usb/i.test(n)) return "info";
  // 13. Cozinha
  if (/air fryer|fritadeira|liquidificador|batedeira|cafeteira|panela|garrafa termica|cozinha|pote|faca|forma|omeleteira/i.test(n)) return "cozinha";
  // 14. Eletrodomésticos
  if (/aspirador|ventilador|ferro de passar|umidificador|eletrodomestico/i.test(n)) return "eletro";
  // 15. Cama, Mesa e Banho
  if (/lencol|travesseiro|edredom|cobertor|colchao|toalha banho|cama/i.test(n)) return "cama";
  // 16. Calçados
  if (/tenis|sapato|sandalia|chinelo|bota|calcado/i.test(n)) return "calc";
  // 17. Moda
  if (/vestido|blusa|camisa|camiseta|shorts|calca|mochila|bolsa|carteira|relogio|oculos/i.test(n)) return "moda";
  // 18. Beleza e Perfumaria
  if (/maquiagem|pincel|escova|secador|batom|perfume|serum|creme|shampoo|cabelo|barbeador|depilador/i.test(n)) return "beleza";
  // 19. Saúde e Cuidados
  if (/creatina|whey|suplemento|vitamina|termogenico|saude|massageador/i.test(n)) return "saude";
  // 20. Ferramentas & Energia Solar / Inversores / Placas
  if (/painel solar|placa solar|inversor solar|inversor|controlador solar|energia solar|bateria lifepo4|furadeira|parafusadeira|chave|ferramenta|alicate|trena|disco|broca/i.test(n)) return "ferr";
  // 21. Automotivo
  if (/automotivo|carro|moto|veicular|pneu|capacete/i.test(n)) return "auto";
  // 22. Pet Shop
  if (/pet|cachorro|gato|racao|coleira|arranhador|bebedouro/i.test(n)) return "pets";
  // 23. Esporte e Lazer
  if (/treino|academia|corda|elastico|esporte|bicicleta|bola/i.test(n)) return "esporte";
  // 24. Brinquedos
  if (/brinquedo|boneca|carrinho|jogos|pop it/i.test(n)) return "brinq";
  // 25. Casa e Decoração (fallback padrão)
  if (/luminaria|led|cortina|tapete|organizador|almofada|decoracao|quadro|prateleira|sala|espelho/i.test(n)) return "casa";
  return "casa";
}

export class ProvedorLinkShopee extends ProvedorLinkAfiliado {
  constructor({ appId, segredo, fetchImpl = fetch } = {}) {
    super();
    this.appId = appId;
    this.segredo = segredo;
    this.fetchImpl = fetchImpl;
  }

  validarLinkAfiliado(url) {
    if (!url || typeof url !== "string") return false;
    try {
      const u = new URL(url);
      // Links encurtados de afiliados oficiais da Shopee ou contendo utm_source de afiliado
      const dominiosValidos = ["s.shopee.com.br", "shope.ee", "affiliate.shopee.com.br"];
      if (dominiosValidos.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))) return true;
      if (u.hostname.endsWith("shopee.com.br") && u.searchParams.get("utm_source")?.startsWith("an_")) return true;
      return false;
    } catch {
      return false;
    }
  }

  async gerarLinkAfiliado({ urlOriginal }) {
    if (!urlOriginal) return null;
    if (this.validarLinkAfiliado(urlOriginal)) return urlOriginal;
    if (!this.appId || !this.segredo) return null;

    const mutation = `mutation { generateShortLink(input: { originUrl: ${JSON.stringify(urlOriginal)} }) { shortLink } }`;
    const body = JSON.stringify({ query: mutation });
    const ts = Math.floor(Date.now() / 1000);
    const assinatura = createHash("sha256").update(`${this.appId}${ts}${body}${this.segredo}`).digest("hex");

    const res = await this.fetchImpl(SHOPEE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `SHA256 Credential=${this.appId}, Timestamp=${ts}, Signature=${assinatura}`,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    const j = await res.json().catch(() => ({}));
    if (j.errors?.length) {
      throw new ErroConector("shopee", `Falha ao gerar link: ${j.errors[0].message}`);
    }
    return j.data?.generateShortLink?.shortLink || null;
  }

  async gerarLinksLote(urlsOriginal = []) {
    if (!urlsOriginal.length) return new Map();
    const mapa = new Map();
    const pendentes = [];

    for (const url of urlsOriginal) {
      if (!url) continue;
      if (this.validarLinkAfiliado(url)) {
        mapa.set(url, url);
      } else if (this.appId && this.segredo) {
        pendentes.push(url);
      }
    }

    if (!pendentes.length) return mapa;

    const TAM_LOTE = 40;
    for (let i = 0; i < pendentes.length; i += TAM_LOTE) {
      const pedaco = pendentes.slice(i, i + TAM_LOTE);
      const linksInput = pedaco.map((u) => ({ originUrl: u }));
      const mutation = `mutation { generateBatchShortLink(input: { links: ${JSON.stringify(linksInput).replace(/"originUrl"/g, "originUrl")} }) { links { originUrl shortLink success } } }`;
      const body = JSON.stringify({ query: mutation });
      const ts = Math.floor(Date.now() / 1000);
      const assinatura = createHash("sha256").update(`${this.appId}${ts}${body}${this.segredo}`).digest("hex");

      try {
        const res = await this.fetchImpl(SHOPEE_API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `SHA256 Credential=${this.appId}, Timestamp=${ts}, Signature=${assinatura}`,
          },
          body,
          signal: AbortSignal.timeout(20_000),
        });
        const j = await res.json().catch(() => ({}));
        const linksRetornados = j.data?.generateBatchShortLink?.links || [];
        for (const item of linksRetornados) {
          if (item.success && item.shortLink) {
            mapa.set(item.originUrl, item.shortLink);
          }
        }
      } catch {
        // Fallback individual se o lote falhar
        for (const u of pedaco) {
          try {
            const short = await this.gerarLinkAfiliado({ urlOriginal: u });
            if (short) mapa.set(u, short);
          } catch {}
        }
      }
    }

    return mapa;
  }
}

export function deShopee(item, categoria, linkAfiliado = null) {
  // Sempre prioriza priceMin (menor preço de entrada com variações), alinhado ao padrão da vitrine e da Shopee
  const precoCandidato = [item.priceMin, item.price, item.priceMax]
    .map(Number)
    .find((p) => Number.isFinite(p) && p > 0);
  const preco = precoCandidato || 0;
  if (!(preco > 0) || !item.productName) return null;

  const comissaoEstimada = Number(item.commission) || null;
  const comissaoPct = item.shopeeCommissionRate
    ? Number(item.shopeeCommissionRate) * 100
    : item.sellerCommissionRate
      ? Number(item.sellerCommissionRate) * 100
      : (preco > 0 && comissaoEstimada ? (comissaoEstimada / preco) * 100 : null);

  const desconto = Number(item.priceDiscountRate);
  const precoAntigo = desconto > 0 && desconto < 90
    ? Math.round((preco / (1 - desconto / 100)) * 100) / 100
    : null;

  const ehSuperOferta = Boolean(desconto >= 35);
  const selo = ehSuperOferta ? "11.11" : null;

  return {
    id: `shopee-${item.itemId}`,
    externalId: String(item.itemId),
    marketplace: "shopee",
    loja: "shopee",
    nome: item.productName,
    categoria: categoria || inferirCategoriaShopee(item.productName),
    preco,
    precoAntigo,
    descontoPct: desconto > 0 ? Math.round(desconto) : null,
    superOferta: ehSuperOferta,
    selo,
    nota: Number(item.ratingStar) || 0,
    vendidos: Number(item.sales) || 0,
    imagem: item.imageUrl,
    link: item.offerLink || linkAfiliado || item.productLink || null,
    linkOriginal: item.productLink || null, // base para gerar link com a origem do clique (subIds)
    comissaoPct: comissaoPct ? Math.round(comissaoPct * 10) / 10 : null,
    comissaoEstimada,
    atualizadoEm: new Date().toISOString(),
  };
}

export class ConectorShopee extends ConectorMarketplace {
  constructor({
    appId = process.env.SHOPEE_APP_ID,
    segredo = process.env.SHOPEE_SECRET,
    fetchImpl = fetch,
    provedorLink = null,
  } = {}) {
    super("shopee");
    this.appId = appId;
    this.segredo = segredo;
    this.fetchImpl = fetchImpl;
    this.provedorLink = provedorLink || new ProvedorLinkShopee({ appId, segredo, fetchImpl });
  }

  estaConfigurado() {
    return Boolean(this.appId && this.segredo);
  }

  async chamarGraphQL(query) {
    const body = JSON.stringify({ query });

    return executarComRetry(async () => {
      const ts = Math.floor(Date.now() / 1000);
      const assinatura = createHash("sha256").update(`${this.appId}${ts}${body}${this.segredo}`).digest("hex");
      const res = await this.fetchImpl(SHOPEE_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `SHA256 Credential=${this.appId}, Timestamp=${ts}, Signature=${assinatura}`,
        },
        body,
        signal: AbortSignal.timeout(20_000),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ErroConector("shopee", `Erro HTTP ${res.status}`, res.status);
      }
      if (json.errors?.length) {
        const msg = json.errors[0].message || "Erro GraphQL Shopee";
        const ehRateLimit = /10030|rate limit/i.test(msg);
        throw new ErroConector("shopee", msg, ehRateLimit ? 429 : 400);
      }
      return json.data;
    }, { maxTentativas: 3, esperaInicialMs: 1000 });
  }

  async buscarPorTermo(termo, limite = 12) {
    try {
      const query = `{ productOfferV2(keyword: ${JSON.stringify(termo)}, listType: 0, page: 1, limit: ${limite}) {
        nodes { itemId productName priceMin priceMax priceDiscountRate ratingStar sales imageUrl productLink offerLink commission sellerCommissionRate shopeeCommissionRate } } }`;
      const data = await this.chamarGraphQL(query);
      return data?.productOfferV2?.nodes ?? [];
    } catch (e) {
      if (e.message?.includes("10000") || e.message?.includes("System Error")) {
        return [];
      }
      throw e;
    }
  }

  async buscarOfertas({ termos = [], categorias = [], limite = 12, paginasGerais = 10 } = {}) {
    if (!this.estaConfigurado()) {
      throw new ErroConector("shopee", "Credenciais da Shopee Open API não configuradas.", 400);
    }

    const candidatos = [];

    // 1. Puxar páginas de ofertas da Shopee Brasil, da maior comissão para a menor (sortType 5 = COMMISSION_DESC).
    // Se a API recusar a ordenação, segue sem ela.
    let ordem = "sortType: 5, ";
    for (let p = 1; p <= paginasGerais; p++) {
      try {
        if (p > 1) await new Promise((r) => setTimeout(r, 250));
        const query = (o) => `{ productOfferV2(${o}page: ${p}, limit: 50) {
          nodes { itemId productName priceMin priceMax priceDiscountRate ratingStar sales imageUrl productLink offerLink commission sellerCommissionRate shopeeCommissionRate } } }`;
        let data;
        try { data = await this.chamarGraphQL(query(ordem)); }
        catch (e) { if (!ordem || e.codigoStatus === 429) throw e; ordem = ""; data = await this.chamarGraphQL(query(ordem)); }
        const nodes = data?.productOfferV2?.nodes ?? [];
        for (const item of nodes) {
          if (item.productLink || item.offerLink) {
            candidatos.push({ item, categoria: inferirCategoriaShopee(item.productName) });
          }
        }
      } catch (e) {
        this.registrarErro(e);
      }
    }

    // 2. Buscas específicas por categoria/termo para garantir variedade
    const buscas = termos.length ? termos.map((t, i) => ({ termo: t, categoria: categorias[i] || "casa" })) : BUSCAS_PADRAO_SHOPEE;
    for (const { termo, categoria } of buscas) {
      try {
        await new Promise((r) => setTimeout(r, 200));
        const itens = await this.buscarPorTermo(termo, limite);
        for (const item of itens) {
          if (item.productLink || item.offerLink) {
            candidatos.push({ item, categoria: categoria || inferirCategoriaShopee(item.productName) });
          }
        }
      } catch (e) {
        this.registrarErro(e);
      }
    }

    // 3. Gerar links para itens que ainda não tenham link curto de afiliado
    const semLinkCurto = candidatos.filter((c) => !c.item.offerLink && c.item.productLink).map((c) => c.item.productLink);
    const urlsParaGerar = [...new Set(semLinkCurto)];
    const mapaLinks = urlsParaGerar.length ? await this.provedorLink.gerarLinksLote(urlsParaGerar) : new Map();

    const resultados = [];
    const vistos = new Set();

    for (const { item, categoria } of candidatos) {
      if (vistos.has(item.itemId)) continue;
      vistos.add(item.itemId);

      const linkAfiliado = item.offerLink || mapaLinks.get(item.productLink) || item.productLink;
      if (linkAfiliado && this.provedorLink.validarLinkAfiliado(linkAfiliado)) {
        const norm = deShopee(item, categoria, linkAfiliado);
        if (norm) resultados.push(norm);
      }
    }

    this.registrarSucesso(resultados.length);
    return resultados;
  }

  normalizarItem(item, categoria = "casa") {
    return deShopee(item, categoria);
  }

  /**
   * Campanhas e coleções da própria Shopee (shopeeOfferV2): nome, imagem, link, comissão e período.
   * Os campos vêm de documentação não oficial: se a API recusar algum, tenta de novo só com o essencial.
   */
  async buscarCampanhas({ limite = 50 } = {}) {
    if (!this.estaConfigurado()) return [];
    const consulta = (campos) => `{ shopeeOfferV2(sortType: 2, page: 1, limit: ${Math.min(50, limite)}) { nodes { ${campos} } } }`; // máximo da API real: 50 por página
    let dados;
    try { dados = await this.chamarGraphQL(consulta("offerName imageUrl offerLink originalLink commissionRate periodStartTime periodEndTime offerType collectionId categoryId")); }
    catch { dados = await this.chamarGraphQL(consulta("offerName imageUrl offerLink periodStartTime periodEndTime")); }
    return (dados?.shopeeOfferV2?.nodes ?? []).map((n) => ({
      id: `campanha-${String(n.collectionId ?? n.categoryId ?? n.offerName ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40) || Math.random().toString(36).slice(2, 10)}`,
      nome: String(n.offerName ?? "").trim().slice(0, 120), imagem: n.imageUrl ?? null, link: n.offerLink ?? null, linkOriginal: n.originalLink ?? null,
      comissaoPct: n.commissionRate ? Math.round(Number(n.commissionRate) * 1000) / 10 : null,
      inicio: n.periodStartTime ? new Date(n.periodStartTime * 1000).toISOString() : null, fim: n.periodEndTime ? new Date(n.periodEndTime * 1000).toISOString() : null,
      tipo: Number(n.offerType) === 2 ? "categoria" : "colecao",
    }));
  }

  /**
   * Link curto com subIds (até 5), que voltam no conversionReport como utmContent: é assim que se sabe de qual canal
   * do CITshop veio cada venda. subIds: só letras, números e _ (o resto é tirado).
   */
  async gerarLinkComSubIds(urlOriginal, subIds = []) {
    if (!urlOriginal || !this.estaConfigurado()) return null;
    const ids = subIds.map((s) => String(s).replace(/[^A-Za-z0-9_]/g, "").slice(0, 50)).filter(Boolean).slice(0, 5);
    const dados = await this.chamarGraphQL(`mutation { generateShortLink(input: { originUrl: ${JSON.stringify(urlOriginal)}, subIds: ${JSON.stringify(ids)} }) { shortLink } }`);
    return dados?.generateShortLink?.shortLink || null;
  }

  /**
   * Conversões do período com o canal (utmContent) e a situação de cada pedido, lendo todas as páginas (scrollId vale 30 s).
   * Devolve { conversoes: [{ conversionId, utm, purchaseTime, pedidos: [{ orderId, orderStatus, comissao, itens }] }] }.
   */
  async relatorioConversoes({ dias = 60, paginas = 20 } = {}) {
    if (!this.estaConfigurado()) return { configurado: false, conversoes: [] };
    const fim = Math.floor(Date.now() / 1000), inicio = fim - Math.max(1, Number(dias) || 60) * 86400;
    const conversoes = [];
    let scroll = null;
    for (let n = 0; n < paginas; n++) {
      const dados = await this.chamarGraphQL(`{ conversionReport(purchaseTimeStart: ${inicio}, purchaseTimeEnd: ${fim}, limit: 500${scroll ? `, scrollId: ${JSON.stringify(scroll)}` : ""}) {
        nodes { conversionId purchaseTime utmContent totalCommission orders { orderId orderStatus items { itemId itemName qty itemPrice itemTotalCommission } } }
        pageInfo { hasNextPage scrollId } } }`);
      const r = dados?.conversionReport;
      for (const c of r?.nodes ?? []) conversoes.push({
        conversionId: String(c.conversionId), utm: c.utmContent ?? "", purchaseTime: c.purchaseTime,
        pedidos: (c.orders ?? []).map((o) => ({ orderId: String(o.orderId), orderStatus: o.orderStatus, itens: o.items ?? [],
          comissao: Math.round((o.items ?? []).reduce((s, i) => s + Number(i.itemTotalCommission || 0), 0) * 100) / 100 })),
      });
      if (!r?.pageInfo?.hasNextPage || !r.pageInfo.scrollId) break;
      scroll = r.pageInfo.scrollId;
    }
    return { configurado: true, conversoes };
  }

  /**
   * Consulta os relatórios de conversões e pedidos de vendas gerados pelo afiliado na Shopee Brasil.
   * Utiliza a query oficial conversionReport do GraphQL.
   * @param {object} opcoes - { dias: 30, limite: 50 }
   * @returns {Promise<{ configurado: boolean, totalPedidos: number, totalVendas: number, totalComissao: number, conversoes: object[] }>}
   */
  async obterRelatorioVendas({ dias = 30, limite = 50 } = {}) {
    if (!this.estaConfigurado()) {
      return { configurado: false, totalPedidos: 0, totalVendas: 0, totalComissao: 0, conversoes: [], motivo: "Shopee Open API não configurada." };
    }

    const agora = Math.floor(Date.now() / 1000);
    const inicio = agora - (Math.max(1, Number(dias) || 30) * 24 * 3600);

    const query = `{
      conversionReport(purchaseTimeStart: ${inicio}, purchaseTimeEnd: ${agora}, limit: ${limite}) {
        nodes {
          purchaseTime
          clickTime
          conversionId
          conversionStatus
          totalCommission
          estimatedTotalCommission
          orders {
            orderId
            orderStatus
            items {
              itemId
              itemName
              itemPrice
              actualAmount
              qty
              itemTotalCommission
              imageUrl
              shopName
            }
          }
        }
      }
    }`;

    try {
      const data = await this.chamarGraphQL(query);
      const nodes = data?.conversionReport?.nodes || [];

      let totalComissao = 0;
      let totalVendas = 0;
      let totalPedidos = 0;
      const conversoes = [];

      for (const conv of nodes) {
        const comissaoConv = Number(conv.totalCommission || conv.estimatedTotalCommission || 0);
        totalComissao += comissaoConv;

        for (const ord of (conv.orders || [])) {
          totalPedidos++;
          for (const item of (ord.items || [])) {
            const valorVenda = Number(item.actualAmount || item.itemPrice || 0);
            totalVendas += valorVenda;
            conversoes.push({
              pedidoId: ord.orderId,
              statusPedido: ord.orderStatus || conv.conversionStatus,
              dataCompra: conv.purchaseTime ? new Date(conv.purchaseTime * 1000).toISOString() : null,
              itemId: item.itemId,
              nome: item.itemName,
              preco: Number(item.itemPrice || 0),
              valorPago: valorVenda,
              quantidade: item.qty || 1,
              comissao: Number(item.itemTotalCommission || 0),
              imagem: item.imageUrl,
              loja: item.shopName,
            });
          }
        }
      }

      return {
        configurado: true,
        appId: this.appId,
        dias: Number(dias) || 30,
        totalPedidos,
        totalVendas: Math.round(totalVendas * 100) / 100,
        totalComissao: Math.round(totalComissao * 100) / 100,
        conversoes,
      };
    } catch (e) {
      return {
        configurado: true,
        appId: this.appId,
        erro: e.message,
        dias: Number(dias) || 30,
        totalPedidos: 0,
        totalVendas: 0,
        totalComissao: 0,
        conversoes: [],
      };
    }
  }
}
