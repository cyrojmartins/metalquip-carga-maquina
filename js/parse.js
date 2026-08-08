/**
 * Parse e normalização de carga máquina a partir de um único CSV ou Excel.
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

function parseTimeToMinutes(value) {
  const s = String(value ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3] || 0);
  if (h > 23 || min > 59 || sec > 59) return null;
  return h * 60 + min + sec / 60;
}

/** Duração em minutos (Terminou − Iniciou). Aceita virada de dia. */
function durationMinutes(iniciou, terminou) {
  const start = parseTimeToMinutes(iniciou);
  const end = parseTimeToMinutes(terminou);
  if (start == null || end == null) return null;
  let d = end - start;
  if (d < 0) d += 24 * 60;
  return d;
}

/**
 * Tempo unitário apontado em segundos:
 * ((Terminou − Iniciou) / Qtde.Final) × 60.
 * Só para operações fechadas com quantidade e horários válidos.
 */
function tempoUnitarioApontado(row) {
  if (row.status !== "fechada") return null;
  if (!(row.qtdeFinal > 0)) return null;
  const dur = durationMinutes(row.iniciou, row.terminou);
  if (dur == null) return null;
  return (dur / row.qtdeFinal) * 60;
}

function normalizeRow(raw, tipo) {
  const emissao = parseBrDate(raw["Emissão OS"]);
  const diaOp = parseBrDate(raw["Dia Operação"]);
  const { osBase, seq, osFull } = splitOs(raw["Nº Ord.Serviço"]);

  // Tempo Oper do CSV = tempo unitário em segundos.
  // Tempo total (s) das OS abertas = Qtd.Lote × Tempo Oper.
  const tempoOper = parseBrNumber(raw["Tempo Oper"]);
  const qtdLote = parseBrNumber(raw["Qtd.Lote"]);
  const tempoSeg = qtdLote * tempoOper;
  const tempoMin = tempoSeg / 60;
  const tempoHoras = tempoSeg / 3600;

  const posto = String(raw["Posto de Trabalho"] ?? "").trim();
  const setor = String(raw["Setor da Fábrica"] ?? "").trim();
  let operador = String(raw["Nome do Operador"] ?? "").trim();
  if (!operador || operador === "S/ APONTAMENTO DO ITEM") {
    operador = "";
  }

  const hasValidDia = diaOp && diaOp.date && !diaOp.invalid;
  const dataInvalida = Boolean(diaOp && diaOp.invalid);
  const status = hasValidDia ? "fechada" : "aberto";

  const iniciou = String(raw["Iniciou"] ?? "").trim();
  const terminou = String(raw["Terminou"] ?? "").trim();
  const qtdeFinal = parseBrNumber(raw["Qtde.Final"]);
  const duracaoMin = status === "fechada" ? durationMinutes(iniciou, terminou) : null;
  const tempoUnitApontado = tempoUnitarioApontado({
    status,
    qtdeFinal,
    iniciou,
    terminou,
  });

  return {
    tipo,
    emissao: emissao?.date ?? null,
    emissaoRaw: String(raw["Emissão OS"] ?? "").trim(),
    osBase,
    seq,
    osFull,
    codigo: String(raw["Código Item"] ?? "").trim(),
    descricao: String(raw["Descrição do Item"] ?? "").trim(),
    qtdLote,
    operacao: String(raw["Operação da Fábrica"] ?? "").trim(),
    tempoOper,
    tempoSeg,
    tempoMin,
    tempoHoras,
    posto: posto || "(sem posto)",
    setor: setor || "(sem setor)",
    operador,
    diaOperacao: hasValidDia ? diaOp.date : null,
    diaOperacaoRaw: diaOp?.raw ?? "",
    iniciou,
    terminou,
    qtdeFinal,
    duracaoMin,
    tempoUnitApontado,
    status,
    dataInvalida,
  };
}

/** Infere tipo a partir da coluna Tipo (acabado / componente), se existir. */
function inferTipo(raw) {
  const rawTipo = String(raw["Tipo"] ?? raw["tipo"] ?? "").trim().toLowerCase();
  if (!rawTipo) return "";
  if (rawTipo.includes("acabado")) return "acabado";
  if (rawTipo.includes("componente")) return "componente";
  return rawTipo;
}

function fileExtension(name) {
  const m = String(name ?? "")
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

function formatBrDateFromJs(d) {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function excelToCsvText(buffer) {
  if (typeof XLSX === "undefined") {
    throw new Error("Biblioteca SheetJS (XLSX) não carregada");
  }
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Planilha Excel vazia");
  const sheet = workbook.Sheets[sheetName];

  // Garante datas no formato BR dd/mm/yyyy (esperado por parseBrDate).
  for (const key of Object.keys(sheet)) {
    if (key[0] === "!") continue;
    const cell = sheet[key];
    if (!cell) continue;
    if (cell.t === "d" && cell.v instanceof Date) {
      const formatted = formatBrDateFromJs(cell.v);
      cell.t = "s";
      cell.v = formatted;
      cell.w = formatted;
    }
  }

  return XLSX.utils.sheet_to_csv(sheet, { FS: ";", blankrows: false });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo"));
    reader.readAsText(file);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo"));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Lê um único arquivo .csv / .xlsx / .xls e devolve linhas normalizadas.
 * @param {File} file
 * @returns {Promise<object[]>}
 */
async function parseFile(file) {
  if (!file) throw new Error("Nenhum arquivo selecionado");
  const ext = fileExtension(file.name);
  let text;
  if (ext === "csv" || file.type === "text/csv") {
    text = await readFileAsText(file);
  } else if (ext === "xlsx" || ext === "xls") {
    const buffer = await readFileAsArrayBuffer(file);
    text = excelToCsvText(buffer);
  } else {
    throw new Error("Formato não suportado. Use CSV ou Excel (.xlsx / .xls).");
  }

  const rawRows = parseCsvText(text);
  return rawRows
    .map((r) => normalizeRow(r, inferTipo(r)))
    .filter((r) => r.emissaoRaw && DATE_RE.test(r.emissaoRaw));
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
    op.operacoes.push({
      osFull: row.osFull,
      codigo: row.codigo,
      descricao: row.descricao,
      qtdLote: row.qtdLote,
      qtdeFinal: row.qtdeFinal,
      tempoUnit: row.tempoOper,
      tempoTotal: row.tempoSeg,
      iniciou: row.iniciou,
      terminou: row.terminou,
      duracaoMin: row.duracaoMin,
      tempoUnitApontado: row.tempoUnitApontado,
      status: row.status,
      tempoHoras: row.tempoHoras,
      dataInvalida: row.dataInvalida,
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
  parseFile,
  buildHierarchy,
  uniqueValues,
  parseBrDate,
  durationMinutes,
  tempoUnitarioApontado,
};
