// Comanda do CITshop Food em ESC/POS (impressoras térmicas de 58 mm = 32 colunas e 80 mm = 48 colunas).
// Texto em CP860 (português: ã, õ, ç, acentos); o que não existe na tabela vira a letra sem acento.
const ESC = 0x1b, GS = 0x1d;
const CMD = {
  iniciar: [ESC, 0x40], tabela860: [ESC, 0x74, 3], centro: [ESC, 0x61, 1], esquerda: [ESC, 0x61, 0],
  negritoOn: [ESC, 0x45, 1], negritoOff: [ESC, 0x45, 0], grande: [GS, 0x21, 0x11], normal: [GS, 0x21, 0x00], alto: [GS, 0x21, 0x01],
  inverteOn: [GS, 0x42, 1], inverteOff: [GS, 0x42, 0], avanco: [ESC, 0x64, 4], corte: [GS, 0x56, 0x42, 0],
};
// CP860 (Portugal/Brasil): só os caracteres que aparecem em comandas.
const CP860 = { "Ç": 0x80, "ü": 0x81, "é": 0x82, "â": 0x83, "ã": 0x84, "à": 0x85, "Á": 0x86, "ç": 0x87, "ê": 0x88, "Ê": 0x89, "è": 0x8a, "Í": 0x8b, "Ô": 0x8c, "ì": 0x8d, "Ã": 0x8e, "Â": 0x8f, "É": 0x90, "À": 0x91, "È": 0x92, "ô": 0x93, "õ": 0x94, "ò": 0x95, "Ú": 0x96, "ù": 0x97, "Ì": 0x98, "Õ": 0x99, "Ü": 0x9a, "á": 0xa0, "í": 0xa1, "ó": 0xa2, "ú": 0xa3, "ñ": 0xa4, "Ñ": 0xa5, "º": 0xa7, "ª": 0xa6, "Ó": 0x9f };

export function codificar(texto) {
  const out = [];
  for (const c of String(texto)) {
    if (CP860[c] != null) out.push(CP860[c]);
    else if (c.charCodeAt(0) < 128) out.push(c.charCodeAt(0));
    else { const base = c.normalize("NFD").replace(/[̀-ͯ]/g, ""); out.push(base.charCodeAt(0) < 128 ? base.charCodeAt(0) : 0x3f); }
  }
  return out;
}
/** Quebra o texto em linhas de até `col` colunas, sem cortar palavras quando dá. */
export function quebrar(texto, col) {
  const linhas = [];
  for (const par of String(texto ?? "").split("\n")) {
    let atual = "";
    for (const p of par.split(/\s+/).filter(Boolean)) {
      if (!atual) atual = p;
      else if ((atual + " " + p).length <= col) atual += " " + p;
      else { linhas.push(atual); atual = p; }
      while (atual.length > col) { linhas.push(atual.slice(0, col)); atual = atual.slice(col); }
    }
    linhas.push(atual);
  }
  return linhas;
}
const reais = (n) => `R$ ${Number(n ?? 0).toFixed(2).replace(".", ",")}`;
const ROTULO = { completa: "COMANDA", cozinha: "VIA DA COZINHA", expedicao: "EXPEDIÇÃO", cliente: "VIA DO CLIENTE" };

/** Comanda (dados do servidor) → Buffer ESC/POS pronto para a impressora. largura: 58 ou 80 (mm). */
export function comandaEscPos(c, { largura = 80, reimpressao = false } = {}) {
  const col = largura === 58 ? 32 : 48, bytes = [...CMD.iniciar, ...CMD.tabela860];
  const add = (...partes) => { for (const p of partes) bytes.push(...(typeof p === "string" ? codificar(p) : p)); };
  const linha = (t = "") => add(t, [0x0a]);
  const dupla = (esq, dir) => { const e = String(esq), d = String(dir); linha(e.length + d.length + 1 <= col ? e + " ".repeat(col - e.length - d.length) + d : `${e}\n${" ".repeat(Math.max(0, col - d.length))}${d}`); };
  const traco = () => linha("-".repeat(col));

  add(CMD.centro, CMD.negritoOn); linha(c.restaurante); add(CMD.negritoOff);
  linha(ROTULO[c.tipo] ?? "COMANDA");
  if (reimpressao) { add(CMD.inverteOn); linha(" REIMPRESSÃO "); add(CMD.inverteOff); }
  add(CMD.grande); linha(`#${c.numero}`); add(CMD.normal);
  linha(new Date(c.em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }));
  add(CMD.negritoOn, CMD.alto); linha(c.modalidade); add(CMD.normal, CMD.negritoOff, CMD.esquerda);
  traco();
  if (c.cliente) linha(`Cliente: ${c.cliente}`);
  if (c.telefone) linha(`Tel: ${c.telefone}`);
  if (c.endereco) for (const l of quebrar(`Entregar em: ${c.endereco}`, col)) linha(l);
  traco();
  for (const i of c.itens) {
    add(CMD.negritoOn);
    if (i.total != null) dupla(`${i.quantidade}x ${i.nome}`.slice(0, col - 12), reais(i.total)); else for (const l of quebrar(`${i.quantidade}x ${i.nome}`, col)) linha(l);
    add(CMD.negritoOff);
    for (const o of i.opcoes ?? []) for (const l of quebrar(`  ${o}`, col)) linha(l);
    if (i.observacao) { add(CMD.inverteOn); for (const l of quebrar(` OBS: ${i.observacao} `, col)) linha(l); add(CMD.inverteOff); }
  }
  if (c.observacao) { traco(); add(CMD.negritoOn); for (const l of quebrar(`ATENÇÃO: ${c.observacao}`, col)) linha(l); add(CMD.negritoOff); }
  if (c.total != null) {
    traco();
    dupla("Itens", reais(c.subtotal));
    if (c.taxaEntrega) dupla("Entrega", reais(c.taxaEntrega));
    if (c.desconto) dupla("Desconto", `-${reais(c.desconto)}`);
    add(CMD.negritoOn); dupla("TOTAL", reais(c.total)); add(CMD.negritoOff);
    const PAG = { dinheiro: "Dinheiro na entrega", cartao_entrega: "Cartão na entrega", pix_entrega: "Pix na entrega", online: "Pago online" };
    linha(PAG[c.pagamento] ?? c.pagamento ?? "");
    add(CMD.negritoOn); linha(c.situacaoPagamento ?? ""); add(CMD.negritoOff);
  }
  add(CMD.centro); traco(); linha("CITshop Food"); add(CMD.avanco, CMD.corte);
  return Buffer.from(bytes);
}

/** Página de teste: confirma tabela de caracteres, largura e corte. */
export function paginaTeste({ largura = 80, impressora = "" } = {}) {
  return comandaEscPos({ tipo: "completa", restaurante: "CITshop Print", numero: "TESTE", em: new Date().toISOString(), modalidade: "IMPRESSÃO DE TESTE",
    cliente: impressora, itens: [{ quantidade: 1, nome: "Acentuação: ã õ ç é ê á ó ú", opcoes: [`Largura: ${largura} mm`], observacao: "Se este texto está legível, a impressora está pronta" }] }, { largura });
}
