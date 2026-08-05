/**
 * Parse e normalização dos CSVs de carga máquina (Acabado / Componente).
 */

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function parseBrNumber(value) {
  if (value == null) return 0;
  const s = String(value).trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function parseBrDate(value) {
  const s = String(value ?? "").trim();
  const m = s.match(DATE_RE);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (year < 2000 || year > 2100) {
    return { date: null, invalid: true, raw: s };
  }
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return { date: null, invalid: true, raw: s };
  }
  return { date: d, invalid: false, raw: s };
}

function splitOs(osRaw) {
  const os = String(osRaw ?? "").trim();
  const m = os.match(/^(.+?)\s*-(\d+)$/);
  if (m) {
    return { osBase: m[1].trim(), seq: Number(m[2]), osFull: os };
  }
  return { osBase: os, seq: 0, osFull: os };
}

function parseCsvText(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.startsWith("Emissão OS") || l.startsWith("Emiss"));
  if (headerIdx < 0) throw new Error("Cabeçalho do CSV não encontrado");

  const headerLine = lines[headerIdx];
  const headers = parseCsvLine(headerLine);
  const rows = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim() || /^;+$/.test(line.trim())) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 4) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? "";
    });
    rows.push(obj);
  }
  return rows;
}

/** Parser CSV simples com suporte a aspas e delimitador ; */
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ";" && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normalizeRow(raw, tipo) {
  const emissao = parseBrDate(raw["Emissão OS"]);
  const diaOp = parseBrDate(raw["Dia Operação"]);
  const { osBase, seq, osFull } = splitOs(raw["Nº Ord.Serviço"]);

  const tempoMin = parseBrNumber(raw["Tempo Oper"]);
  const posto = String(raw["Posto de Trabalho"] ?? "").trim();
  const setor = String(raw["Setor da Fábrica"] ?? "").trim();
  let operador = String(raw["Nome do Operador"] ?? "").trim();
  if (!operador || operador === "S/ APONTAMENTO DO ITEM") {
    operador = "";
  }

  const hasValidDia = diaOp && diaOp.date && !diaOp.invalid;
  const dataInvalida = Boolean(diaOp && diaOp.invalid);
  const status = hasValidDia ? "fechada" : "aberto";

  return {
    tipo,
    emissao: emissao?.date ?? null,
    emissaoRaw: String(raw["Emissão OS"] ?? "").trim(),
    osBase,
    seq,
    osFull,
    codigo: String(raw["Código Item"] ?? "").trim(),
    descricao: String(raw["Descrição do Item"] ?? "").trim(),
    qtdLote: parseBrNumber(raw["Qtd.Lote"]),
    operacao: String(raw["Operação da Fábrica"] ?? "").trim(),
    tempoMin,
    tempoHoras: tempoMin / 60,
    posto: posto || "(sem posto)",
    setor: setor || "(sem setor)",
    operador,
    diaOperacao: hasValidDia ? diaOp.date : null,
    diaOperacaoRaw: diaOp?.raw ?? "",
    iniciou: String(raw["Iniciou"] ?? "").trim(),
    terminou: String(raw["Terminou"] ?? "").trim(),
    qtdeFinal: parseBrNumber(raw["Qtde.Final"]),
    status,
    dataInvalida,
  };
}

async function loadCsv(path, tipo) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Falha ao carregar ${path}: ${res.status}`);
  const text = await res.text();
  const rawRows = parseCsvText(text);
  return rawRows
    .map((r) => normalizeRow(r, tipo))
    .filter((r) => r.emissaoRaw && DATE_RE.test(r.emissaoRaw));
}

async function loadAllData() {
  const [acabado, componente] = await Promise.all([
    loadCsv("Acabado.csv", "acabado"),
    loadCsv("Componente.csv", "componente"),
  ]);
  return [...acabado, ...componente];
}

function buildHierarchy(rows) {
  const setores = new Map();

  for (const row of rows) {
    if (!setores.has(row.setor)) {
      setores.set(row.setor, {
        nome: row.setor,
        total: 0,
        aberto: 0,
        fechada: 0,
        horasAbertas: 0,
        postos: new Map(),
      });
    }
    const setor = setores.get(row.setor);
    setor.total += 1;
    if (row.status === "aberto") {
      setor.aberto += 1;
      setor.horasAbertas += row.tempoHoras;
    } else {
      setor.fechada += 1;
    }

    if (!setor.postos.has(row.posto)) {
      setor.postos.set(row.posto, {
        nome: row.posto,
        total: 0,
        aberto: 0,
        fechada: 0,
        horasAbertas: 0,
        operadores: new Map(),
      });
    }
    const posto = setor.postos.get(row.posto);
    posto.total += 1;
    if (row.status === "aberto") {
      posto.aberto += 1;
      posto.horasAbertas += row.tempoHoras;
    } else {
      posto.fechada += 1;
    }

    const opKey = row.operador || "(sem operador)";
    if (!posto.operadores.has(opKey)) {
      posto.operadores.set(opKey, {
        nome: opKey,
        total: 0,
        aberto: 0,
        fechada: 0,
        horasAbertas: 0,
        operacoes: [],
      });
    }
    const op = posto.operadores.get(opKey);
    op.total += 1;
    if (row.status === "aberto") {
      op.aberto += 1;
      op.horasAbertas += row.tempoHoras;
    } else {
      op.fechada += 1;
    }
    const tempoUnit = row.tempoMin;
    const tempoTotal = row.qtdLote * tempoUnit;
    op.operacoes.push({
      osFull: row.osFull,
      codigo: row.codigo,
      descricao: row.descricao,
      qtdLote: row.qtdLote,
      tempoUnit,
      tempoTotal,
      status: row.status,
      tempoHoras: row.tempoHoras,
    });
  }

  return [...setores.values()]
    .map((s) => ({
      ...s,
      pctFechado: s.total ? (100 * s.fechada) / s.total : 0,
      postos: [...s.postos.values()]
        .map((p) => ({
          ...p,
          pctFechado: p.total ? (100 * p.fechada) / p.total : 0,
          operadores: [...p.operadores.values()]
            .map((op) => ({
              ...op,
              operacoes: [...op.operacoes].sort(
                (a, b) =>
                  b.tempoTotal - a.tempoTotal ||
                  String(a.osFull).localeCompare(String(b.osFull), "pt-BR")
              ),
            }))
            .sort(
              (a, b) => b.horasAbertas - a.horasAbertas || b.total - a.total
            ),
        }))
        .sort((a, b) => b.horasAbertas - a.horasAbertas || b.total - a.total),
    }))
    .sort((a, b) => b.horasAbertas - a.horasAbertas || b.total - a.total);
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), "pt-BR")
  );
}

window.CargaParse = {
  loadAllData,
  buildHierarchy,
  uniqueValues,
  parseBrDate,
};
