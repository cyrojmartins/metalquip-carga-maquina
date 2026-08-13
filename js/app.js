/**
 * UI — filtros, resumo hierárquico, carga, operações e cronograma.
 */

/** Valores fixos padrão do sistema (Parâmetros por setor). */
const DEFAULT_FADIGA = 20;
const DEFAULT_HORAS_DIA = 8.8;

/** Persistência local dos parâmetros cadastrados (sobrevive a reload/deploy na mesma origem). */
const PARAMETROS_STORAGE_KEY = "metalquip.cargaMaquina.parametrosSetor";

const state = {
  allRows: [],
  filtered: [],
  schedule: null,
  expandedSetores: new Set(),
  expandedPostos: new Set(),
  expandedOperadores: new Set(),
  operadoresPorSetor: {},
  parametrosSetor: {},
  expandedCargaSetores: new Set(),
  expandedCronDias: new Set(),
  activeTab: "resumo",
  sort: {
    resumo: { key: "horasAbertas", dir: "desc" },
    resumoOps: { key: "tempoTotal", dir: "desc" },
    carga: { key: "horas", dir: "desc" },
    cargaOps: { key: "tempoTotal", dir: "desc" },
    ops: { key: "emissao", dir: "asc" },
    cronograma: { key: "key", dir: "asc" },
  },
};

function normalizeParametrosSetorEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  let operadores = Number(raw.operadores);
  if (!Number.isFinite(operadores) || operadores < 0) operadores = 1;
  operadores = Math.floor(operadores);
  // % Fadiga e Horas/Dia são valores fixos do sistema
  return {
    fadiga: DEFAULT_FADIGA,
    operadores,
    horasDia: DEFAULT_HORAS_DIA,
  };
}

function loadParametrosSetorFromStorage() {
  try {
    const raw = localStorage.getItem(PARAMETROS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

    const restored = {};
    for (const [nome, entry] of Object.entries(parsed)) {
      if (!nome) continue;
      const p = normalizeParametrosSetorEntry(entry);
      if (p) restored[nome] = p;
    }
    state.parametrosSetor = restored;
    syncOperadoresFromParametros();
  } catch (err) {
    console.warn("Não foi possível carregar parâmetros por setor do armazenamento local:", err);
  }
}

function saveParametrosSetorToStorage(setorNome) {
  try {
    let stored = {};
    try {
      const raw = localStorage.getItem(PARAMETROS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          stored = parsed;
        }
      }
    } catch (_) {
      stored = {};
    }

    if (setorNome && state.parametrosSetor[setorNome]) {
      stored[setorNome] = { ...state.parametrosSetor[setorNome] };
    } else {
      for (const [nome, p] of Object.entries(state.parametrosSetor)) {
        stored[nome] = { ...p };
      }
    }

    localStorage.setItem(PARAMETROS_STORAGE_KEY, JSON.stringify(stored));
  } catch (err) {
    console.warn("Não foi possível salvar parâmetros por setor no armazenamento local:", err);
  }
}

const $ = (id) => document.getElementById(id);

function fmtNum(n, digits = 0) {
  return Number(n || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtHours(h) {
  return `${fmtNum(h, 1)} h`;
}

function badge(status) {
  return `<span class="badge ${status}">${status}</span>`;
}

function todayInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseStartDate() {
  const v = $("fStart").value;
  if (!v) return new Date();
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fillSelect(el, values, keepEmpty = true) {
  const current = el.value;
  el.innerHTML = keepEmpty ? `<option value="">Todos</option>` : "";
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  }
  if ([...el.options].some((o) => o.value === current)) el.value = current;
}

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function rowMonthKey(r) {
  if (!r.emissao) return null;
  return r.emissao.getFullYear() * 100 + (r.emissao.getMonth() + 1);
}

function formatMonthKey(key) {
  const year = Math.floor(key / 100);
  const month = key % 100;
  if (month < 1 || month > 12) return String(key);
  return `${MONTH_NAMES[month - 1]}/${year}`;
}

function getMesMode() {
  return $("fMesMode")?.value || "todos";
}

function getSelectedMonthKeys() {
  const mode = getMesMode();
  if (mode === "todos") return null;
  if (mode === "um") {
    const v = Number($("fMesOne")?.value);
    return Number.isFinite(v) && v > 0 ? new Set([v]) : new Set();
  }
  if (mode === "alguns") {
    const keys = [...document.querySelectorAll("#fMesSome input[type=checkbox]:checked")]
      .map((el) => Number(el.value))
      .filter((k) => Number.isFinite(k) && k > 0);
    return new Set(keys);
  }
  return null;
}

function rowMatchesMonthFilter(r) {
  const keys = getSelectedMonthKeys();
  if (keys === null) return true;
  if (!keys.size) return false;
  const mk = rowMonthKey(r);
  if (mk == null) return false;
  return keys.has(mk);
}

function monthFilterSummary() {
  const mode = getMesMode();
  if (mode === "todos") return "";
  if (mode === "um") {
    const v = Number($("fMesOne")?.value);
    return v ? `Mês: ${formatMonthKey(v)}` : "";
  }
  if (mode === "alguns") {
    const keys = getSelectedMonthKeys();
    if (!keys?.size) return "Meses: nenhum selecionado";
    return `Meses: ${[...keys]
      .sort((a, b) => a - b)
      .map(formatMonthKey)
      .join(", ")}`;
  }
  return "";
}

function updateMesFilterVisibility() {
  const mode = getMesMode();
  $("fMesOneWrap")?.classList.toggle("hidden", mode !== "um");
  $("fMesSomeWrap")?.classList.toggle("hidden", mode !== "alguns");
}

function rebuildMonthFilterOptions() {
  const keys = new Set();
  for (const r of state.allRows) {
    const mk = rowMonthKey(r);
    if (mk) keys.add(mk);
  }
  const sorted = [...keys].sort((a, b) => a - b);
  const prevOne = $("fMesOne")?.value;
  const prevSome = new Set(
    [...document.querySelectorAll("#fMesSome input[type=checkbox]:checked")].map((el) => el.value)
  );

  const oneEl = $("fMesOne");
  if (oneEl) {
    oneEl.innerHTML = sorted
      .map((k) => `<option value="${k}">${escapeHtml(formatMonthKey(k))}</option>`)
      .join("");
    if (prevOne && sorted.includes(Number(prevOne))) oneEl.value = prevOne;
    else if (sorted.length) oneEl.value = String(sorted[sorted.length - 1]);
  }

  const someEl = $("fMesSome");
  if (someEl) {
    someEl.innerHTML = sorted
      .map((k) => {
        const checked = prevSome.has(String(k)) ? " checked" : "";
        return `<label class="mes-check-item"><input type="checkbox" value="${k}"${checked} /><span>${escapeHtml(formatMonthKey(k))}</span></label>`;
      })
      .join("");
  }

  updateMesFilterVisibility();
}

function matchesRowFilters(r, { skipStatus = false } = {}) {
  const tipo = $("fTipo").value;
  const setor = $("fSetor").value;
  const posto = $("fPosto").value;
  const operador = $("fOperador").value;
  const status = $("fStatus").value;
  const search = ($("fSearch").value || "").trim().toLowerCase();

  if (tipo && r.tipo !== tipo) return false;
  if (setor && r.setor !== setor) return false;
  if (posto && r.posto !== posto) return false;
  if (operador) {
    const op = r.operador || "(sem operador)";
    if (op !== operador) return false;
  }
  if (!skipStatus && status && r.status !== status) return false;
  if (!rowMatchesMonthFilter(r)) return false;
  if (search) {
    const hay = `${r.osFull} ${r.osBase} ${r.codigo} ${r.descricao} ${r.operacao}`.toLowerCase();
    if (!hay.includes(search)) return false;
  }
  return true;
}

function applyFilters() {
  state.filtered = state.allRows.filter((r) => matchesRowFilters(r));
}

function rebuildDependentFilters() {
  const tipo = $("fTipo").value;
  const setor = $("fSetor").value;

  fillSelect($("fSetor"), window.CargaParse.uniqueValues(
    tipo ? state.allRows.filter((r) => r.tipo === tipo) : state.allRows,
    "setor"
  ));
  if (setor) $("fSetor").value = setor;

  const forPosto = state.allRows.filter((r) => {
    if (tipo && r.tipo !== tipo) return false;
    if ($("fSetor").value && r.setor !== $("fSetor").value) return false;
    return true;
  });
  fillSelect($("fPosto"), window.CargaParse.uniqueValues(forPosto, "posto"));

  const forOp = forPosto.filter((r) => {
    if ($("fPosto").value && r.posto !== $("fPosto").value) return false;
    return true;
  });
  const ops = [
    ...new Set(forOp.map((r) => r.operador || "(sem operador)")),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  fillSelect($("fOperador"), ops);
}

function renderKpis() {
  const rows = state.filtered;
  const total = rows.length;
  const aberto = rows.filter((r) => r.status === "aberto").length;
  const fechada = total - aberto;
  const horasAbertas = rows
    .filter((r) => r.status === "aberto")
    .reduce((a, r) => a + r.tempoHoras, 0);
  const setores = new Set(rows.map((r) => r.setor)).size;
  const postos = new Set(rows.map((r) => r.posto)).size;
  const pct = total ? (100 * fechada) / total : 0;

  $("kpis").innerHTML = `
    <div class="kpi"><div class="label">Operações</div><div class="value">${fmtNum(total)}</div><div class="hint">${setores} setores · ${postos} postos</div></div>
    <div class="kpi"><div class="label">Aberto</div><div class="value">${fmtNum(aberto)}</div><div class="hint">${fmtHours(horasAbertas)}</div></div>
    <div class="kpi"><div class="label">Fechada</div><div class="value">${fmtNum(fechada)}</div><div class="hint">${fmtNum(pct, 1)}% concluído</div></div>
    <div class="kpi"><div class="label">Acabado / Comp.</div><div class="value">${fmtNum(rows.filter((r) => r.tipo === "acabado").length)} / ${fmtNum(rows.filter((r) => r.tipo === "componente").length)}</div><div class="hint">no filtro atual</div></div>
  `;
}

function renderResumo() {
  let hierarchy = window.CargaParse.buildHierarchy(state.filtered);
  const resumoGetters = {
    nome: (x) => x.nome,
    total: (x) => x.total,
    aberto: (x) => x.aberto,
    fechada: (x) => x.fechada,
    pctFechado: (x) => x.pctFechado,
    horasAbertas: (x) => x.horasAbertas,
  };
  const { key: rKey, dir: rDir } = state.sort.resumo;
  hierarchy = sortItems(hierarchy, rKey, rDir, resumoGetters).map((setor) => ({
    ...setor,
    postos: sortItems(setor.postos, rKey, rDir, resumoGetters).map((posto) => ({
      ...posto,
      operadores: sortItems(
        posto.operadores.map((op) => ({
          ...op,
          pctFechado: op.total ? (100 * op.fechada) / op.total : 0,
        })),
        rKey,
        rDir,
        resumoGetters
      ),
    })),
  }));

  $("resumoMeta").textContent = `${hierarchy.length} setores`;

  const header = `
    <div class="tree-row header">
      ${sortableCell("Nome", "resumo", "nome")}
      ${sortableCell("Total", "resumo", "total", "num")}
      ${sortableCell("Aberto", "resumo", "aberto", "num")}
      ${sortableCell("Fechada", "resumo", "fechada", "num")}
      ${sortableCell("% Fech.", "resumo", "pctFechado", "num hide-sm")}
      ${sortableCell("Horas abertas", "resumo", "horasAbertas", "num")}
    </div>`;

  const parts = [header];
  const opsGetters = {
    osFull: (r) => r.osFull,
    codigo: (r) => r.codigo,
    descricao: (r) => r.descricao,
    qtdLote: (r) => r.qtdLote,
    tempoUnit: (r) => r.tempoUnit,
    tempoTotal: (r) => r.tempoTotal,
    qtdeFinal: (r) => r.qtdeFinal,
    tempoUnitApontado: (r) => r.tempoUnitApontado,
  };

  for (const setor of hierarchy) {
    const sKey = setor.nome;
    const sOpen = state.expandedSetores.has(sKey);
    parts.push(`
      <div class="tree-row setor" data-expand-setor="${escapeAttr(sKey)}">
        <div class="tree-name">
          <span class="toggle">${sOpen ? "−" : "+"}</span>
          <span class="label-text">${escapeHtml(setor.nome)}</span>
        </div>
        <div class="num">${fmtNum(setor.total)}</div>
        <div class="num">${fmtNum(setor.aberto)}</div>
        <div class="num">${fmtNum(setor.fechada)}</div>
        <div class="num hide-sm">${fmtNum(setor.pctFechado, 0)}%</div>
        <div class="num">${fmtHours(setor.horasAbertas)}</div>
      </div>`);

    if (!sOpen) continue;

    for (const posto of setor.postos) {
      const pKey = `${sKey}||${posto.nome}`;
      const pOpen = state.expandedPostos.has(pKey);
      parts.push(`
        <div class="tree-row posto" data-expand-posto="${escapeAttr(pKey)}">
          <div class="tree-name">
            <span class="toggle">${pOpen ? "−" : "+"}</span>
            <span class="label-text">${escapeHtml(posto.nome)}</span>
          </div>
          <div class="num">${fmtNum(posto.total)}</div>
          <div class="num">${fmtNum(posto.aberto)}</div>
          <div class="num">${fmtNum(posto.fechada)}</div>
          <div class="num hide-sm">${fmtNum(posto.pctFechado, 0)}%</div>
          <div class="num">${fmtHours(posto.horasAbertas)}</div>
        </div>`);

      if (!pOpen) continue;

      for (const op of posto.operadores) {
        const oKey = `${pKey}||${op.nome}`;
        const oOpen = state.expandedOperadores.has(oKey);
        parts.push(`
          <div class="tree-row operador" data-expand-operador="${escapeAttr(oKey)}">
            <div class="tree-name">
              <span class="toggle">${oOpen ? "−" : "+"}</span>
              <span class="label-text">${escapeHtml(op.nome)}</span>
            </div>
            <div class="num">${fmtNum(op.total)}</div>
            <div class="num">${fmtNum(op.aberto)}</div>
            <div class="num">${fmtNum(op.fechada)}</div>
            <div class="num hide-sm">${fmtNum(op.pctFechado, 0)}%</div>
            <div class="num">${fmtHours(op.horasAbertas)}</div>
          </div>`);

        if (!oOpen) continue;

        const showApontado = $("fStatus").value !== "aberto";
        const sortedOps = sortItems(
          op.operacoes,
          state.sort.resumoOps.key,
          state.sort.resumoOps.dir,
          opsGetters
        );
        const opsHeader = showApontado
          ? `
            <div class="tree-ops-row header with-apontado">
              ${sortableCell("Nº OS", "resumoOps", "osFull")}
              ${sortableCell("Código", "resumoOps", "codigo")}
              ${sortableCell("Descrição", "resumoOps", "descricao")}
              ${sortableCell("Qtde Lote", "resumoOps", "qtdLote", "num")}
              ${sortableCell("Tempo Oper (s)", "resumoOps", "tempoUnit", "num")}
              ${sortableCell("T. Produção (s)", "resumoOps", "tempoTotal", "num")}
              ${sortableCell("Qtde Final", "resumoOps", "qtdeFinal", "num")}
              ${sortableCell("Tempo/un. real (s)", "resumoOps", "tempoUnitApontado", "num", "div")}
            </div>`
          : `
            <div class="tree-ops-row header">
              ${sortableCell("Nº OS", "resumoOps", "osFull")}
              ${sortableCell("Código", "resumoOps", "codigo")}
              ${sortableCell("Descrição", "resumoOps", "descricao")}
              ${sortableCell("Qtde Lote", "resumoOps", "qtdLote", "num")}
              ${sortableCell("Tempo Oper (s)", "resumoOps", "tempoUnit", "num")}
              ${sortableCell("T. Produção (s)", "resumoOps", "tempoTotal", "num")}
            </div>`;

        parts.push(`
          <div class="tree-ops-wrap">
            ${opsHeader}
            ${sortedOps
              .map((row) => {
                const apontadoCols = showApontado
                  ? `
                <div class="num">${row.status === "fechada" ? fmtNum(row.qtdeFinal, 1) : "—"}</div>
                <div class="num">${
                  row.tempoUnitApontado != null
                    ? fmtNum(row.tempoUnitApontado, 2)
                    : "—"
                }</div>`
                  : "";
                return `
              <div class="tree-ops-row ${row.status}${showApontado ? " with-apontado" : ""}">
                <div class="mono" title="${escapeAttr(row.osFull)}">${escapeHtml(row.osFull)}</div>
                <div class="mono" title="${escapeAttr(row.codigo)}">${escapeHtml(row.codigo)}</div>
                <div class="wrap" title="${escapeAttr(row.descricao)}">${escapeHtml(row.descricao)}</div>
                <div class="num">${fmtNum(row.qtdLote, 1)}</div>
                <div class="num">${fmtNum(row.tempoUnit, 2)}</div>
                <div class="num">${fmtNum(row.tempoTotal, 2)}</div>
                ${apontadoCols}
              </div>`;
              })
              .join("")}
          </div>`);
      }
    }
  }

  if (hierarchy.length === 0) {
    $("resumoTree").innerHTML = `<div class="empty">Nenhuma operação no filtro atual.</div>`;
    return;
  }
  $("resumoTree").innerHTML = `<div class="tree">${parts.join("")}</div>`;
}

function getOperadoresSetor(setor, defaultN = 1) {
  const n = Number(state.operadoresPorSetor[setor]);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : Math.max(1, defaultN);
}

/** Horas disponíveis/dia do setor (Parâmetros: operadores × horas/dia × (1−fadiga)). */
function getCapacidadeDiaSetor(setor, nRecursos = 1) {
  const p = getParametrosSetor(setor);
  const calc = calcParametrosSetor(p);
  if (calc.horasDisponiveis != null) return calc.horasDisponiveis;
  return DEFAULT_HORAS_DIA * Math.max(1, nRecursos);
}

function buildCapacidadeDiaPorSetor(setores) {
  const map = {};
  for (const nome of setores) {
    map[nome] = getCapacidadeDiaSetor(nome);
  }
  return map;
}

function renderCarga() {
  const weeks = Number($("fWeeks").value) || 2;
  const workDays = weeks * 5;
  const osSearch = ($("fCargaOs")?.value || "").trim().toLowerCase();
  const opsGetters = {
    osFull: (r) => r.osFull,
    codigo: (r) => r.codigo,
    descricao: (r) => r.descricao,
    qtdLote: (r) => r.qtdLote,
    tempoUnit: (r) => r.tempoUnit,
    tempoTotal: (r) => r.tempoTotal,
  };

  syncOperadoresFromParametros();

  const bySetor = new Map();
  for (const r of state.filtered) {
    if (r.status !== "aberto") continue;
    if (!bySetor.has(r.setor)) {
      bySetor.set(r.setor, {
        setor: r.setor,
        horas: 0,
        ops: 0,
        postos: new Set(),
        operacoes: [],
      });
    }
    const x = bySetor.get(r.setor);
    x.horas += r.tempoHoras;
    x.ops += 1;
    x.postos.add(r.posto);
    x.operacoes.push({
      osFull: r.osFull,
      codigo: r.codigo,
      descricao: r.descricao,
      qtdLote: r.qtdLote,
      tempoUnit: r.tempoOper,
      tempoTotal: r.tempoSeg,
    });
  }

  let list = [...bySetor.values()]
    .map((item) => {
      const nPostos = item.postos.size || 1;
      const operadores = getOperadoresSetor(item.setor, nPostos);
      const capacidadeDia = getCapacidadeDiaSetor(item.setor, operadores);
      let operacoes = sortItems(
        item.operacoes,
        state.sort.cargaOps.key,
        state.sort.cargaOps.dir,
        opsGetters
      );
      if (osSearch) {
        operacoes = operacoes.filter((op) => {
          const hay = `${op.osFull} ${op.codigo} ${op.descricao}`.toLowerCase();
          return hay.includes(osSearch);
        });
      }
      return {
        ...item,
        nPostos,
        operadores,
        capacidadeDia,
        capacity: workDays * capacidadeDia,
        operacoes,
      };
    });

  list = sortItems(list, state.sort.carga.key, state.sort.carga.dir, {
    setor: (x) => x.setor,
    horas: (x) => x.horas,
    ops: (x) => x.ops,
    capacity: (x) => x.capacity,
    operadores: (x) => x.operadores,
    nPostos: (x) => x.nPostos,
  });

  if (osSearch) {
    list = list.filter((item) => item.operacoes.length > 0);
    for (const item of list) state.expandedCargaSetores.add(item.setor);
  }

  $("cargaMeta").textContent = `Capacidade do horizonte = horas disponíveis/dia (Parâmetros) × ${weeks} sem. × 5 dias`;

  if (!list.length) {
    $("cargaList").innerHTML = `<div class="empty">${
      osSearch
        ? "Nenhuma OS encontrada com o filtro atual."
        : "Sem operações abertas no filtro."
    }</div>`;
    return;
  }

  $("cargaList").innerHTML = `
    <div class="carga-sort-bar">
      ${sortableCell("Horas", "carga", "horas", "num")}
    </div>
    <div class="load-list">${list
    .map((item) => {
      const pctRaw = item.capacity > 0 ? (100 * item.horas) / item.capacity : 0;
      const pct = Math.min(100, pctRaw);
      const over = item.horas > item.capacity;
      const open = state.expandedCargaSetores.has(item.setor);
      const opsTable = open
        ? `
        <div class="tree-ops-wrap carga-ops">
          <div class="tree-ops-row header">
            ${sortableCell("Nº OS", "cargaOps", "osFull")}
            ${sortableCell("Código", "cargaOps", "codigo")}
            ${sortableCell("Descrição", "cargaOps", "descricao")}
            ${sortableCell("Qtde Lote", "cargaOps", "qtdLote", "num")}
            ${sortableCell("Tempo Oper (s)", "cargaOps", "tempoUnit", "num")}
            ${sortableCell("T. Produção (s)", "cargaOps", "tempoTotal", "num")}
          </div>
          ${item.operacoes
            .map(
              (row) => `
            <div class="tree-ops-row">
              <div class="mono" title="${escapeAttr(row.osFull)}">${escapeHtml(row.osFull)}</div>
              <div class="mono" title="${escapeAttr(row.codigo)}">${escapeHtml(row.codigo)}</div>
              <div class="wrap" title="${escapeAttr(row.descricao)}">${escapeHtml(row.descricao)}</div>
              <div class="num">${fmtNum(row.qtdLote, 1)}</div>
              <div class="num">${fmtNum(row.tempoUnit, 2)}</div>
              <div class="num">${fmtNum(row.tempoTotal, 2)}</div>
            </div>`
            )
            .join("")}
        </div>`
        : "";

      return `
        <div class="load-block${over ? " is-over" : ""}">
          <div class="load-item">
            <div class="load-info">
              <button type="button" class="load-toggle" data-expand-carga-setor="${escapeAttr(item.setor)}" aria-expanded="${open}">
                <span class="toggle">${open ? "−" : "+"}</span>
                <span class="load-name" title="${escapeAttr(item.setor)}">${escapeHtml(item.setor)}</span>
              </button>
              <span class="ops-hint">${fmtNum(item.nPostos)} posto${item.nPostos === 1 ? "" : "s"}</span>
            </div>
            <div class="bar-wrap">
              <div class="bar ${over ? "over" : ""}"><span style="width:${pct}%"></span></div>
              <div class="load-pct ${over ? "over" : ""}">${fmtNum(pctRaw, 0)}%</div>
            </div>
            <div class="load-meta">${fmtHours(item.horas)} / ${fmtHours(item.capacity)} · ${fmtNum(item.ops)} ops${over ? " · sobrecarga" : ""}</div>
          </div>
          ${opsTable}
        </div>`;
    })
    .join("")}</div>`;
}

const CARGA_MAQUINA_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function cargaMaquinaMonthKey(date) {
  return date.getFullYear() * 100 + (date.getMonth() + 1);
}

function cargaMaquinaMonthLabel(date) {
  return CARGA_MAQUINA_MONTHS[date.getMonth()];
}

/** Relatório Carga Máquina — usa os mesmos filtros globais (incl. mês e status). */
function getCargaMaquinaRows() {
  return state.filtered.filter((r) => r.emissao);
}

function buildCargaMaquinaGroups(rows) {
  const bySetor = new Map();

  for (const r of rows) {
    if (!bySetor.has(r.setor)) bySetor.set(r.setor, new Map());
    const mk = cargaMaquinaMonthKey(r.emissao);
    const months = bySetor.get(r.setor);
    if (!months.has(mk)) {
      months.set(mk, {
        monthKey: mk,
        label: cargaMaquinaMonthLabel(r.emissao),
        osSet: new Set(),
        tempoSeg: 0,
      });
    }
    const bucket = months.get(mk);
    bucket.osSet.add(r.osFull);
    bucket.tempoSeg += r.tempoSeg;
  }

  return [...bySetor.keys()]
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((setor) => {
      const monthsMap = bySetor.get(setor);
      const monthRows = [...monthsMap.values()]
        .sort((a, b) => a.monthKey - b.monthKey)
        .map((m) => {
          const tempoHrs = m.tempoSeg / 3600;
          return {
            label: m.label,
            qtdeOs: m.osSet.size,
            tempoSeg: m.tempoSeg,
            tempoHrs,
          };
        });

      const calc = calcParametrosSetor(getParametrosSetor(setor));
      const hrDisp = calc.horasDisponiveis;
      const nMonthRows = monthRows.length;

      for (const row of monthRows) {
        row.hrDisp = hrDisp;
        row.qtdeDias = hrDisp != null && hrDisp > 0 ? row.tempoHrs / hrDisp : null;
      }

      const total = {
        qtdeOs: monthRows.reduce((acc, row) => acc + row.qtdeOs, 0),
        tempoSeg: monthRows.reduce((acc, row) => acc + row.tempoSeg, 0),
        tempoHrs: monthRows.reduce((acc, row) => acc + row.tempoHrs, 0),
        qtdeDias: monthRows.reduce((acc, row) => acc + (row.qtdeDias ?? 0), 0),
      };

      return { setor, hrDisp, monthRows, total, rowSpan: nMonthRows + 1 };
    });
}

function fmtCargaMaquinaCell(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "";
  return fmtNum(value, digits);
}

function renderCargaMaquina() {
  const el = $("cargaMaquinaList");
  const meta = $("cargaMaquinaMeta");
  if (!el) return;

  const rows = getCargaMaquinaRows();
  const groups = buildCargaMaquinaGroups(rows);

  const status = $("fStatus").value;
  const statusLabel = status ? (status === "aberto" ? "Aberto" : "Fechada") : "Todos";
  const mesLabel = monthFilterSummary();
  if (meta) {
    const parts = [];
    if (groups.length) {
      parts.push(`${fmtNum(groups.length)} setor${groups.length === 1 ? "" : "es"}`);
    }
    parts.push(`Status: ${statusLabel}`);
    if (mesLabel) parts.push(mesLabel);
    if (groups.length) parts.push(`${fmtNum(rows.length)} operações`);
    meta.textContent = parts.join(" · ");
  }

  if (!groups.length) {
    el.innerHTML = `<div class="empty">Nenhuma operação com emissão válida para o status selecionado.</div>`;
    return;
  }

  const body = groups
    .map((g, groupIdx) => {
      const gapRow =
        groupIdx > 0
          ? `<tr class="carga-maquina-gap" aria-hidden="true"><td colspan="7"></td></tr>`
          : "";

      const monthHtml = g.monthRows
        .map((row, idx) => {
          const setorCell =
            idx === 0
              ? `<td class="setor-cell" rowspan="${g.rowSpan}">${escapeHtml(g.setor)}</td>`
              : "";
          const hrDispCell =
            idx === 0 && g.hrDisp != null
              ? `<td class="num hr-disp-cell" rowspan="${g.monthRows.length}">${fmtCargaMaquinaCell(g.hrDisp)}</td>`
              : idx === 0
                ? `<td class="num hr-disp-cell" rowspan="${g.monthRows.length}"></td>`
                : "";

          return `
        <tr>
          ${setorCell}
          <td class="mes-cell">${escapeHtml(row.label)}</td>
          <td class="num">${fmtCargaMaquinaCell(row.qtdeOs)}</td>
          <td class="num">${fmtCargaMaquinaCell(row.tempoSeg)}</td>
          <td class="num">${fmtCargaMaquinaCell(row.tempoHrs)}</td>
          ${hrDispCell}
          <td class="num">${fmtCargaMaquinaCell(row.qtdeDias)}</td>
        </tr>`;
        })
        .join("");

      const totalRow = `
        <tr class="carga-maquina-total">
          <td class="mes-cell total-label">${escapeHtml(g.setor)} Total</td>
          <td class="num">${fmtCargaMaquinaCell(g.total.qtdeOs)}</td>
          <td class="num">${fmtCargaMaquinaCell(g.total.tempoSeg)}</td>
          <td class="num">${fmtCargaMaquinaCell(g.total.tempoHrs)}</td>
          <td class="num"></td>
          <td class="num carga-maquina-highlight">${fmtCargaMaquinaCell(g.total.qtdeDias)}</td>
        </tr>`;

      return gapRow + monthHtml + totalRow;
    })
    .join("");

  el.innerHTML = `
    <table class="data carga-maquina-report">
      <thead>
        <tr>
          <th>Setor da Fábrica</th>
          <th>Meses</th>
          <th class="num">Qtde de OS</th>
          <th class="num">T. Produção Seg.</th>
          <th class="num">T. Produção Hrs</th>
          <th class="num">Hr Disponível dia</th>
          <th class="num">Qtde dias Produção</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function buildCargaMaquinaPrintHtml(groups) {
  const tableHead = `
        <thead>
          <tr>
            <th>Meses</th>
            <th class="num">Qtde de OS</th>
            <th class="num">T. Produção Seg.</th>
            <th class="num">T. Produção Hrs</th>
            <th class="num">Hr Disponível dia</th>
            <th class="num">Qtde dias Produção</th>
          </tr>
        </thead>`;

  const sectorBlocks = groups
    .map((g, idx) => {
      const monthHtml = g.monthRows
        .map((row, rowIdx) => {
          const hrDispCell =
            rowIdx === 0 && g.hrDisp != null
              ? `<td class="num hr-disp-cell" rowspan="${g.monthRows.length}">${fmtCargaMaquinaCell(g.hrDisp)}</td>`
              : rowIdx === 0
                ? `<td class="num hr-disp-cell" rowspan="${g.monthRows.length}"></td>`
                : "";

          return `
          <tr>
            <td class="mes-cell">${escapeHtml(row.label)}</td>
            <td class="num">${fmtCargaMaquinaCell(row.qtdeOs)}</td>
            <td class="num">${fmtCargaMaquinaCell(row.tempoSeg)}</td>
            <td class="num">${fmtCargaMaquinaCell(row.tempoHrs)}</td>
            ${hrDispCell}
            <td class="num">${fmtCargaMaquinaCell(row.qtdeDias)}</td>
          </tr>`;
        })
        .join("");

      const totalRow = `
          <tr class="carga-maquina-total">
            <td class="mes-cell total-label">${escapeHtml(g.setor)} Total</td>
            <td class="num">${fmtCargaMaquinaCell(g.total.qtdeOs)}</td>
            <td class="num">${fmtCargaMaquinaCell(g.total.tempoSeg)}</td>
            <td class="num">${fmtCargaMaquinaCell(g.total.tempoHrs)}</td>
            <td class="num"></td>
            <td class="num carga-maquina-highlight">${fmtCargaMaquinaCell(g.total.qtdeDias)}</td>
          </tr>`;

      const gap =
        idx > 0 ? `<div class="carga-maquina-setor-gap" aria-hidden="true"></div>` : "";

      return `${gap}
      <section class="carga-maquina-setor-block">
        <h2 class="carga-maquina-setor-title">${escapeHtml(g.setor)}</h2>
        <table class="data carga-maquina-report">
          ${tableHead}
          <tbody>${monthHtml}${totalRow}</tbody>
        </table>
      </section>`;
    })
    .join("");

  return `
    <div class="carga-maquina-print">
      <h1 class="carga-maquina-print-title">Relatório de Carga Máquina.</h1>
      <div class="carga-maquina-print-body">${sectorBlocks}</div>
    </div>`;
}

function renderOps() {
  const showApontado = $("fStatus").value !== "aberto";
  const opsGetters = {
    status: (r) => r.status,
    tipo: (r) => r.tipo,
    emissao: (r) => r.emissao || r.emissaoRaw,
    osFull: (r) => r.osFull,
    codigo: (r) => r.codigo,
    descricao: (r) => r.descricao,
    operacao: (r) => r.operacao,
    tempoOper: (r) => r.tempoOper,
    tempoSeg: (r) => r.tempoSeg,
    tempoMin: (r) => r.tempoMin,
    posto: (r) => r.posto,
    setor: (r) => r.setor,
    operador: (r) => r.operador || "",
    diaOperacao: (r) => r.diaOperacao || r.diaOperacaoRaw || "",
    iniciou: (r) => r.iniciou || "",
    terminou: (r) => r.terminou || "",
    qtdeFinal: (r) => r.qtdeFinal,
    tempoUnitApontado: (r) => r.tempoUnitApontado,
  };
  const sorted = sortItems(
    state.filtered,
    state.sort.ops.key,
    state.sort.ops.dir,
    opsGetters
  );
  const rows = sorted.slice(0, 2000);
  $("opsMeta").textContent =
    state.filtered.length > 2000
      ? `Mostrando 2.000 de ${fmtNum(state.filtered.length)}`
      : `${fmtNum(state.filtered.length)} operações`;

  if (!rows.length) {
    $("opsTable").innerHTML = `<div class="empty">Nenhuma operação no filtro.</div>`;
    return;
  }

  const body = rows
    .map((r) => {
      const apontadoCells = showApontado
        ? `
      <td class="num">${r.status === "fechada" ? escapeHtml(r.iniciou || "—") : "—"}</td>
      <td class="num">${r.status === "fechada" ? escapeHtml(r.terminou || "—") : "—"}</td>
      <td class="num">${r.status === "fechada" ? fmtNum(r.qtdeFinal, 1) : "—"}</td>
      <td class="num">${
        r.tempoUnitApontado != null ? fmtNum(r.tempoUnitApontado, 2) : "—"
      }</td>`
        : "";
      return `
    <tr>
      <td>${badge(r.status)}${r.dataInvalida ? ` <span class="badge invalid" title="Dia Operação inválido">data?</span>` : ""}</td>
      <td>${escapeHtml(r.tipo)}</td>
      <td>${escapeHtml(r.emissaoRaw)}</td>
      <td>${escapeHtml(r.osFull)}</td>
      <td>${escapeHtml(r.codigo)}</td>
      <td class="wrap">${escapeHtml(r.descricao)}</td>
      <td>${escapeHtml(r.operacao)}</td>
      <td class="num">${fmtNum(r.tempoOper, 0)}</td>
      <td class="num">${fmtNum(r.tempoSeg, 0)}</td>
      <td>${escapeHtml(r.posto)}</td>
      <td>${escapeHtml(r.setor)}</td>
      <td>${escapeHtml(r.operador || "—")}</td>
      <td>${escapeHtml(r.diaOperacaoRaw || "—")}</td>
      ${apontadoCells}
    </tr>`;
    })
    .join("");

  const apontadoHeaders = showApontado
    ? `${sortableCell("Início", "ops", "iniciou", "", "th")}${sortableCell("Término", "ops", "terminou", "", "th")}${sortableCell("Qtde Final", "ops", "qtdeFinal", "num", "th")}${sortableCell("Tempo/un. real (s)", "ops", "tempoUnitApontado", "num", "th")}`
    : "";

  $("opsTable").innerHTML = `
    <table class="data">
      <thead>
        <tr>
          ${sortableCell("Status", "ops", "status", "", "th")}
          ${sortableCell("Tipo", "ops", "tipo", "", "th")}
          ${sortableCell("Emissão", "ops", "emissao", "", "th")}
          ${sortableCell("OS", "ops", "osFull", "", "th")}
          ${sortableCell("Código", "ops", "codigo", "", "th")}
          ${sortableCell("Descrição", "ops", "descricao", "", "th")}
          ${sortableCell("Operação", "ops", "operacao", "", "th")}
          ${sortableCell("Tempo Oper (s)", "ops", "tempoOper", "num", "th")}
          ${sortableCell("T. Produção (s)", "ops", "tempoSeg", "num", "th")}
          ${sortableCell("Posto", "ops", "posto", "", "th")}
          ${sortableCell("Setor", "ops", "setor", "", "th")}
          ${sortableCell("Operador", "ops", "operador", "", "th")}
          ${sortableCell("Dia Operação", "ops", "diaOperacao", "", "th")}
          ${apontadoHeaders}
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function ensureSchedule() {
  const weeks = Number($("fWeeks").value) || 2;

  // Cronograma sempre agenda abertas; respeita demais filtros da UI (incl. mês).
  // Precedência (OS seq) usa o universo completo em allRows.
  const openRows = state.allRows.filter((r) => {
    if (r.status !== "aberto") return false;
    return matchesRowFilters(r, { skipStatus: true });
  });

  syncOperadoresFromParametros();
  const recursosPorSetor = { ...state.operadoresPorSetor };
  const setoresAbertos = [...new Set(openRows.map((r) => r.setor))];
  for (const nome of setoresAbertos) getParametrosSetor(nome);
  syncOperadoresFromParametros();
  Object.assign(recursosPorSetor, state.operadoresPorSetor);
  const capacidadeDiaPorSetor = buildCapacidadeDiaPorSetor(setoresAbertos);

  state.schedule = window.CargaSchedule.buildSchedule(state.allRows, {
    startDate: parseStartDate(),
    weeks,
    hoursPerDay: DEFAULT_HORAS_DIA,
    postoFilter: null, // já aplicado em openRows
    openRows,
    recursosPorSetor,
    capacidadeDiaPorSetor,
  });
  return state.schedule;
}

function cronDiaKey(setorNome, day) {
  const dataRaw =
    day.data != null
      ? window.CargaSchedule.formatDate(day.data)
      : day.label || "";
  return `${setorNome}::${dataRaw}`;
}

function opMatchesCronFilter(op, search) {
  if (!search) return true;
  const os = op.osFull || `${op.osBase}-${String(op.seq).padStart(2, "0")}`;
  const hay = `${os} ${op.codigo || ""} ${op.descricao || ""} ${op.posto || ""} ${op.operacao || ""}`.toLowerCase();
  return hay.includes(search);
}

function opTempoTotalSeg(op) {
  return op.tempoSeg ?? (op.qtdLote || 0) * (op.tempoOper || 0);
}

function summarizeDayOps(ops) {
  let tempoSeg = 0;
  let horas = 0;
  let qtdLote = 0;
  for (const op of ops) {
    tempoSeg += opTempoTotalSeg(op);
    horas += Number(op.tempoHoras) || 0;
    qtdLote += Number(op.qtdLote) || 0;
  }
  return { ops: ops.length, tempoSeg, horas, qtdLote };
}

function renderDayOpsDetailRows(ops) {
  return ops
    .map((op) => {
      const os = op.osFull || `${op.osBase}-${String(op.seq).padStart(2, "0")}`;
      const tempoOper = op.tempoOper ?? 0;
      const tempoTotal = opTempoTotalSeg(op);
      const tipoLabel =
        op.tipo === "acabado"
          ? "Acabado"
          : op.tipo === "componente"
            ? "Componente"
            : op.tipo || "—";
      return `
        <tr${op.oversized ? ' class="oversized"' : ""}>
          <td>${escapeHtml(tipoLabel)}</td>
          <td class="mono">${escapeHtml(os)}</td>
          <td class="codigo-item">${escapeHtml(op.codigo || "—")}</td>
          <td class="desc">${escapeHtml(op.descricao || "—")}</td>
          <td class="num">${fmtNum(op.qtdLote, 0)}</td>
          <td class="num">${fmtNum(tempoOper, 0)}</td>
          <td class="num">${fmtNum(tempoTotal, 0)}</td>
          <td>${escapeHtml(op.posto || "—")}</td>
          <td class="num">${fmtHours(op.tempoHoras)}</td>
        </tr>`;
    })
    .join("");
}

function renderSetorOpsTable(setor) {
  const search = ($("fCronOs")?.value || "").trim().toLowerCase();
  const dayBlocks = [];

  for (const day of setor.days) {
    const ops = (day.ops || []).filter((op) => opMatchesCronFilter(op, search));
    if (!ops.length) continue;

    const dayLabel =
      day.label || (day.data ? window.CargaSchedule.weekdayLabel(day.data) : "Dia");
    const dataRaw =
      day.data != null
        ? window.CargaSchedule.formatDate(day.data)
        : ops[0]?.dataAgendaRaw || "—";
    const dataCurta = dataRaw.includes("/")
      ? dataRaw.slice(0, 5)
      : dataRaw;
    const key = cronDiaKey(setor.setor, day);
    const open = state.expandedCronDias.has(key);
    const sum = summarizeDayOps(ops);

    const detail = open
      ? `
      <div class="schedule-day-detail table-wrap">
        <table class="data schedule-ops">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Nº Ord.Serviço</th>
              <th>Código Item</th>
              <th>Descrição do Item</th>
              <th class="num">Qtd.Lote</th>
              <th class="num">Tempo Oper (s)</th>
              <th class="num">Tempo total (s)</th>
              <th>Posto</th>
              <th class="num">Horas</th>
            </tr>
          </thead>
          <tbody>${renderDayOpsDetailRows(ops)}</tbody>
          <tfoot>
            <tr class="schedule-day-total">
              <td colspan="4"><strong>Total do dia ${escapeHtml(dataCurta)}</strong></td>
              <td class="num"><strong>${fmtNum(sum.qtdLote, 0)}</strong></td>
              <td></td>
              <td class="num"><strong>${fmtNum(sum.tempoSeg, 0)}</strong></td>
              <td></td>
              <td class="num"><strong>${fmtHours(sum.horas)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>`
      : "";

    dayBlocks.push(`
      <div class="schedule-day${open ? " is-open" : ""}">
        <button type="button" class="schedule-day-toggle" data-expand-cron-dia="${escapeAttr(key)}" aria-expanded="${open}">
          <span class="toggle">${open ? "−" : "+"}</span>
          <span class="schedule-day-title">
            <strong>Dia ${escapeHtml(dataCurta)}</strong>
            <span class="muted">${escapeHtml(dayLabel)}</span>
          </span>
          <span class="schedule-day-sum">
            ${fmtNum(sum.ops)} ops · ${fmtNum(sum.tempoSeg, 0)} s · ${fmtHours(sum.horas)}
            <span class="muted">· total do dia</span>
          </span>
        </button>
        ${detail}
      </div>`);
  }

  if (!dayBlocks.length) {
    return `<div class="empty schedule-empty">${
      search
        ? "Nenhuma operação neste setor para o filtro atual."
        : "Sem operações neste setor."
    }</div>`;
  }

  const allOps = setor.days.flatMap((d) =>
    (d.ops || []).filter((op) => opMatchesCronFilter(op, search))
  );
  const setorSum = summarizeDayOps(allOps);

  return `
    <div class="schedule-days">
      ${dayBlocks.join("")}
      <div class="schedule-setor-total">
        <strong>Total do setor</strong>
        <span>${fmtNum(setorSum.ops)} ops · ${fmtNum(setorSum.tempoSeg, 0)} s · ${fmtHours(setorSum.horas)}</span>
      </div>
    </div>`;
}

/** Lista setores identificados (ops abertas no filtro atual do cronograma). */
function listSetoresIdentificados() {
  const set = new Set();
  for (const r of state.allRows) {
    if (r.status !== "aberto") continue;
    if (!matchesRowFilters(r, { skipStatus: true })) continue;
    set.add(r.setor);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function getParametrosSetor(nome) {
  if (!state.parametrosSetor[nome]) {
    const defaultOps = state.operadoresPorSetor[nome];
    const nPostos =
      new Set(
        state.allRows
          .filter((r) => r.status === "aberto" && r.setor === nome)
          .map((r) => r.posto)
      ).size || 1;
    state.parametrosSetor[nome] = {
      fadiga: DEFAULT_FADIGA,
      operadores:
        Number.isFinite(Number(defaultOps)) && Number(defaultOps) >= 1
          ? Math.floor(Number(defaultOps))
          : nPostos,
      horasDia: DEFAULT_HORAS_DIA,
    };
  }
  return state.parametrosSetor[nome];
}

/** Horas trabalho = operadores × horas/dia; disponíveis = trabalho × (1 − fadiga%). */
function calcParametrosSetor(p) {
  const operadores = Number(p.operadores);
  const horasDia = Number(p.horasDia);
  const fadiga = Number(p.fadiga);
  const opsOk = Number.isFinite(operadores) && operadores >= 0;
  const horasOk = Number.isFinite(horasDia) && horasDia >= 0;
  const fadigaOk = Number.isFinite(fadiga) && fadiga >= 0;
  const horasTrabalho = opsOk && horasOk ? operadores * horasDia : null;
  const fadigaPct = fadigaOk ? Math.min(100, Math.max(0, fadiga)) : 0;
  const horasDisponiveis =
    horasTrabalho != null ? horasTrabalho * (1 - fadigaPct / 100) : null;
  return { horasTrabalho, horasDisponiveis, fadigaPct };
}

function syncOperadoresFromParametros() {
  for (const [nome, p] of Object.entries(state.parametrosSetor)) {
    const n = Number(p.operadores);
    if (Number.isFinite(n) && n >= 1) {
      state.operadoresPorSetor[nome] = Math.floor(n);
    }
  }
}

function renderParametrosSetores() {
  const el = $("cronSetoresTable");
  const meta = $("cronSetoresMeta");
  if (!el) return;

  const setores = listSetoresIdentificados();
  if (meta) {
    meta.textContent = setores.length
      ? `${fmtNum(setores.length)} setor${setores.length === 1 ? "" : "es"}`
      : "";
  }

  if (!setores.length) {
    el.innerHTML = `<div class="empty">Nenhum setor com operações abertas no filtro atual.</div>`;
    return;
  }

  el.innerHTML = `
    <table class="data setor-params">
      <thead>
        <tr>
          <th>Descrição dos Setores</th>
          <th class="num">% Fadiga</th>
          <th class="num">Qtde Operadores</th>
          <th class="num">Horas/Dia</th>
          <th class="num">Horas trabalho dia</th>
          <th class="num">Horas disponíveis dia</th>
        </tr>
      </thead>
      <tbody>
        ${setores
          .map((nome) => {
            const p = getParametrosSetor(nome);
            const calc = calcParametrosSetor(p);
            return `
          <tr data-param-setor="${escapeAttr(nome)}">
            <td class="setor-nome" title="${escapeAttr(nome)}">${escapeHtml(nome)}</td>
            <td class="num">
              <input type="number" class="param-input" min="0" max="100" step="0.5"
                data-param="fadiga" data-setor="${escapeAttr(nome)}"
                value="${p.fadiga}" aria-label="% Fadiga — ${escapeAttr(nome)}" />
            </td>
            <td class="num">
              <input type="number" class="param-input" min="0" step="1"
                data-param="operadores" data-setor="${escapeAttr(nome)}"
                value="${p.operadores}" aria-label="Qtde operadores — ${escapeAttr(nome)}" />
            </td>
            <td class="num">
              <input type="number" class="param-input" min="0" max="24" step="0.01"
                data-param="horasDia" data-setor="${escapeAttr(nome)}"
                value="${Number(p.horasDia).toFixed(2)}" aria-label="Horas/dia — ${escapeAttr(nome)}" />
            </td>
            <td class="num param-calc" data-calc="horasTrabalho">${
              calc.horasTrabalho != null ? fmtNum(calc.horasTrabalho, 2) : "—"
            }</td>
            <td class="num param-calc" data-calc="horasDisponiveis">${
              calc.horasDisponiveis != null ? fmtNum(calc.horasDisponiveis, 2) : "—"
            }</td>
          </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;
}

function updateParametrosSetorFromInput(input, { rebuild = false } = {}) {
  const setor = input.getAttribute("data-setor");
  const param = input.getAttribute("data-param");
  if (!setor || !param) return;

  let n = Number(input.value);
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (param === "fadiga") n = Math.min(100, n);
  if (param === "operadores") n = Math.floor(n);

  const p = getParametrosSetor(setor);
  p[param] = n;
  if (param === "operadores" && String(input.value) !== String(n)) {
    input.value = String(n);
  }

  const calc = calcParametrosSetor(p);
  const row = input.closest("tr");
  if (row) {
    const trab = row.querySelector('[data-calc="horasTrabalho"]');
    const disp = row.querySelector('[data-calc="horasDisponiveis"]');
    if (trab) trab.textContent = calc.horasTrabalho != null ? fmtNum(calc.horasTrabalho, 2) : "—";
    if (disp) disp.textContent = calc.horasDisponiveis != null ? fmtNum(calc.horasDisponiveis, 2) : "—";
  }

  if (param === "operadores") {
    state.operadoresPorSetor[setor] = Math.max(1, Math.floor(n) || 1);
  }

  // Qualquer alteração de parâmetro invalida o cronograma cacheado
  state.schedule = null;
  saveParametrosSetorToStorage(setor);

  if (state.activeTab === "carga-maquina") {
    renderCargaMaquina();
  }

  if (rebuild) {
    renderCronogramaScheduleOnly();
  }
}

function renderCronogramaScheduleOnly() {
  const sch = ensureSchedule();
  let bySetor = window.CargaSchedule.groupBySetor(sch);
  const search = ($("fCronOs")?.value || "").trim().toLowerCase();

  if (state.sort.cronograma.key === "setor") {
    bySetor = sortItems(bySetor, "setor", state.sort.cronograma.dir, {
      setor: (s) => s.setor,
    });
  } else if (
    state.sort.cronograma.key === "qtdeOs" ||
    state.sort.cronograma.key === "tempoSeg"
  ) {
    bySetor = sortItems(bySetor, state.sort.cronograma.key, state.sort.cronograma.dir, {
      qtdeOs: (s) => s.totalOps,
      tempoSeg: (s) => s.totalHoras,
    });
  }

  if (search) {
    bySetor = bySetor
      .map((setor) => {
        const days = setor.days
          .map((day) => {
            const ops = (day.ops || []).filter((op) => opMatchesCronFilter(op, search));
            return {
              ...day,
              ops,
              horas: ops.reduce((a, op) => a + (Number(op.tempoHoras) || 0), 0),
            };
          })
          .filter((day) => day.ops.length);
        const totalOps = days.reduce((a, d) => a + d.ops.length, 0);
        const totalHoras = days.reduce((a, d) => a + d.horas, 0);
        const totalTempoSeg = days.reduce(
          (a, d) => a + d.ops.reduce((s, op) => s + opTempoTotalSeg(op), 0),
          0
        );
        return { ...setor, days, totalOps, totalHoras, totalTempoSeg };
      })
      .filter((setor) => setor.totalOps > 0);
  }

  $("btnExport").disabled = !sch.scheduled.length;
  $("cronMeta").textContent = `${fmtNum(sch.scheduled.length)} agendadas · ${fmtNum(sch.blocked.length)} fora do horizonte · ${bySetor.length} setores · capac. = horas disponíveis/dia (Parâmetros)`;

  const workDays = sch.workDays || [];
  const dataInicial =
    workDays.length > 0 ? window.CargaSchedule.formatDate(workDays[0]) : "—";
  const dataFinal =
    workDays.length > 0
      ? window.CargaSchedule.formatDate(workDays[workDays.length - 1])
      : "—";

  if (!bySetor.length) {
    $("cronGrid").innerHTML = `<div class="empty">${
      search
        ? "Nada encontrado no filtro atual do cronograma."
        : "Nada a agendar no filtro/horizonte atual."
    }</div>`;
    return;
  }

  let html = bySetor
    .map((setor) => {
      const totalSeg =
        setor.totalTempoSeg != null
          ? setor.totalTempoSeg
          : setor.days.reduce(
              (a, d) => a + d.ops.reduce((s, op) => s + opTempoTotalSeg(op), 0),
              0
            );
      const capacH = getCapacidadeDiaSetor(setor.setor);
      return `
        <section class="schedule-setor">
          <div class="schedule-setor-head">
            <h2>${escapeHtml(setor.setor)}</h2>
            <span>${fmtNum(setor.totalOps)} ops · ${fmtNum(totalSeg, 0)} s · ${fmtHours(setor.totalHoras)} · capac. ${fmtHours(capacH)}/dia (disponível)</span>
            <span class="schedule-setor-period">Data Inicial: ${escapeHtml(dataInicial)} · Data final: ${escapeHtml(dataFinal)}</span>
          </div>
          ${renderSetorOpsTable(setor)}
        </section>`;
    })
    .join("");

  if (sch.blocked.length && !search) {
    const sample = sch.blocked
      .slice(0, 8)
      .map((b) => `${b.osFull} (${b.motivo})`)
      .join(" · ");
    html += `
      <div class="padded" style="padding:1rem;border-top:1px solid var(--line)">
        <strong>${fmtNum(sch.blocked.length)} operações não agendadas</strong>
        <div class="muted" style="margin-top:0.35rem;font-size:0.82rem">${escapeHtml(sample)}${sch.blocked.length > 8 ? "…" : ""}</div>
      </div>`;
  }

  $("cronGrid").innerHTML = html;
}

function setCronDiasExpanded(expand) {
  const sch = ensureSchedule();
  const bySetor = window.CargaSchedule.groupBySetor(sch);
  const search = ($("fCronOs")?.value || "").trim().toLowerCase();
  for (const setor of bySetor) {
    for (const day of setor.days) {
      const ops = (day.ops || []).filter((op) => opMatchesCronFilter(op, search));
      if (!ops.length) continue;
      const key = cronDiaKey(setor.setor, day);
      if (expand) state.expandedCronDias.add(key);
      else state.expandedCronDias.delete(key);
    }
  }
  renderCronogramaScheduleOnly();
}

function renderCronograma() {
  renderCronogramaScheduleOnly();
}

function montarCronogramaPorSetor() {
  if (!state.allRows.length) return;

  const sch = ensureSchedule();
  setTab("cronograma");

  if (!sch.scheduled.length) {
    setBanner("Não há operações abertas para montar o cronograma no filtro/horizonte atual.", true);
    return;
  }

  const bySetor = window.CargaSchedule.groupBySetor(sch);
  const html = window.CargaSchedule.scheduleToHtmlBySetor(sch, {
    titulo: "Cronograma de Produção por Setor — Metalquip",
  });
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cronograma-por-setor-${todayInputValue()}.html`;
  a.click();
  URL.revokeObjectURL(url);

  setBanner(
    `Cronograma por setor montado: ${fmtNum(sch.scheduled.length)} operações em ${bySetor.length} setores.`
  );
}

const PRINT_TABS = {
  resumo: {
    title: "Resumo por setor",
    bodyId: "resumoTree",
    metaId: "resumoMeta",
  },
  carga: {
    title: "Carga por setor",
    bodyId: "cargaList",
    metaId: "cargaMeta",
  },
  ops: {
    title: "Operações",
    bodyId: "opsTable",
    metaId: "opsMeta",
  },
  cronograma: {
    title: "Cronograma semanal",
    bodyId: "cronGrid",
    metaId: "cronMeta",
  },
  parametros: {
    title: "Parâmetros por setor",
    bodyId: "cronSetoresTable",
    metaId: "cronSetoresMeta",
  },
  "carga-maquina": {
    title: "Carga Máquina",
    bodyId: "cargaMaquinaList",
    metaId: "cargaMaquinaMeta",
  },
};

function filterSummaryForPrint() {
  const parts = [];
  const tipo = $("fTipo").value;
  const setor = $("fSetor").value;
  const posto = $("fPosto").value;
  const operador = $("fOperador").value;
  const status = $("fStatus").value;
  const search = ($("fSearch").value || "").trim();
  const mes = monthFilterSummary();
  if (tipo) parts.push(`Tipo: ${tipo}`);
  if (setor) parts.push(`Setor: ${setor}`);
  if (posto) parts.push(`Posto: ${posto}`);
  if (operador) parts.push(`Operador: ${operador}`);
  if (status) parts.push(`Status: ${status}`);
  if (mes) parts.push(mes);
  if (search) parts.push(`Busca: ${search}`);
  if (state.activeTab === "carga" || state.activeTab === "cronograma") {
    parts.push(`Horizonte: ${$("fWeeks").value} sem.`);
  }
  if (state.activeTab === "cronograma" && $("fStart").value) {
    parts.push(`Início: ${$("fStart").value}`);
  }
  if (state.activeTab === "carga") {
    const os = ($("fCargaOs")?.value || "").trim();
    if (os) parts.push(`Filtro OS: ${os}`);
  }
  if (state.activeTab === "cronograma") {
    const os = ($("fCronOs")?.value || "").trim();
    if (os) parts.push(`Filtro cronograma: ${os}`);
  }
  return parts.length ? parts.join(" · ") : "Sem filtros aplicados";
}

function printTab(tabName) {
  const cfg = PRINT_TABS[tabName];
  if (!cfg) return;
  if (state.activeTab !== tabName) setTab(tabName);

  if (tabName === "cronograma") {
    setCronDiasExpanded(true);
  }

  const bodyEl = $(cfg.bodyId);
  const metaEl = $(cfg.metaId);
  if (!bodyEl) return;

  let content;
  let isCargaMaquinaPrint = tabName === "carga-maquina";

  if (isCargaMaquinaPrint) {
    const groups = buildCargaMaquinaGroups(getCargaMaquinaRows());
    if (!groups.length) {
      setBanner(`Nada para imprimir em “${cfg.title}”.`, true);
      return;
    }
    content = buildCargaMaquinaPrintHtml(groups);
  } else {
    content = bodyEl.innerHTML.trim();
    if (!content || content.includes('class="empty"')) {
      setBanner(`Nada para imprimir em “${cfg.title}”.`, true);
      return;
    }
  }

  const cssHref = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map((l) => l.href)
    .filter(Boolean);
  const meta = metaEl?.textContent?.trim() || "";
  const filters = filterSummaryForPrint();
  const printedAt = new Date().toLocaleString("pt-BR");

  const win = window.open("", "_blank");
  if (!win) {
    setBanner("Permita pop-ups para imprimir.", true);
    return;
  }

  win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${isCargaMaquinaPrint ? "Relatório de Carga Máquina." : `${escapeHtml(cfg.title)} — Metalquip`}</title>
  ${cssHref.map((h) => `<link rel="stylesheet" href="${h}" />`).join("\n  ")}
  <style>
    body { background: #fff; margin: 0; padding: 16px 20px 28px; }
    .print-head { margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 2px solid #2f4a63; }
    .print-head h1 { margin: 0 0 0.25rem; font-size: 1.25rem; color: #2f4a63; }
    .print-head .sub { margin: 0; color: #5c6570; font-size: 0.85rem; }
    .print-body { max-height: none !important; overflow: visible !important; }
    .table-wrap, .panel-body { max-height: none !important; overflow: visible !important; }
    .tree-row.header, table.data th { position: static !important; }
    .sortable { cursor: default !important; }
    .carga-sort-bar { break-inside: avoid; }
    .load-block, .schedule-setor, .tree-ops-wrap, table.data, table.schedule-ops { break-inside: avoid; }
    .load-toggle .toggle { display: none !important; }
    .load-toggle { pointer-events: none; border: none; background: transparent; padding: 0; color: inherit; }
    .schedule-day-toggle .toggle { display: none !important; }
    .schedule-day-toggle { pointer-events: none; cursor: default; }
    .schedule-day-detail { max-height: none !important; overflow: visible !important; }
    .cron-schedule-panel { max-height: none !important; overflow: visible !important; }
    .carga-maquina-print-title {
      margin: 0 0 2rem;
      font-size: 1.35rem;
      font-weight: 700;
      color: #2f4a63;
    }
    .carga-maquina-print-body { margin-top: 0; }
    .carga-maquina-setor-block {
      border: 1px solid #333;
      padding: 12px 14px 14px;
      break-inside: avoid;
    }
    .carga-maquina-setor-title {
      margin: 0 0 0.75rem;
      font-size: 1rem;
      font-weight: 700;
      color: #2f4a63;
    }
    .carga-maquina-setor-gap {
      height: 1.25rem;
    }
    .carga-maquina-setor-block table.carga-maquina-report {
      width: 100%;
      margin: 0;
    }
    .carga-maquina-setor-block .carga-maquina-total td {
      font-weight: 700;
    }
    .sub { margin: 0; color: #5c6570; font-size: 0.85rem; }
    .carga-maquina-print-meta {
      margin-top: 1.5rem;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  ${
    isCargaMaquinaPrint
      ? `<div class="print-body">${content}</div>
  <p class="sub carga-maquina-print-meta">${escapeHtml(filters)} · Impresso em ${escapeHtml(printedAt)}</p>`
      : `<header class="print-head">
    <h1>Metalquip — ${escapeHtml(cfg.title)}</h1>
    <p class="sub">${escapeHtml(meta)}</p>
    <p class="sub">${escapeHtml(filters)}</p>
    <p class="sub">Impresso em ${escapeHtml(printedAt)}</p>
  </header>
  <div class="print-body">${content}</div>`
  }
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () {
        window.focus();
        window.print();
      }, 150);
    });
  <\/script>
</body>
</html>`);
  win.document.close();
}

function refresh() {
  applyFilters();
  renderKpis();
  if (state.activeTab === "resumo") renderResumo();
  if (state.activeTab === "carga") renderCarga();
  if (state.activeTab === "ops") renderOps();
  if (state.activeTab === "cronograma") renderCronograma();
  if (state.activeTab === "parametros") renderParametrosSetores();
  if (state.activeTab === "carga-maquina") renderCargaMaquina();
}

function setTab(name) {
  state.activeTab = name;
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("hidden", p.id !== `tab-${name}`);
  });
  refresh();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function compareSortValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null || a === "") return 1;
  if (b == null || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    if (Number.isNaN(a)) return 1;
    if (Number.isNaN(b)) return -1;
    return a - b;
  }
  if (a instanceof Date && b instanceof Date) return a - b;
  return String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
}

function sortItems(items, key, dir, getters = {}) {
  if (!key) return items;
  const get = getters[key] || ((item) => item[key]);
  const mul = dir === "desc" ? -1 : 1;
  return [...items].sort((a, b) => mul * compareSortValues(get(a), get(b)));
}

function toggleSort(scope, key) {
  const s = state.sort[scope];
  if (!s) return;
  if (s.key === key) {
    s.dir = s.dir === "asc" ? "desc" : "asc";
  } else {
    s.key = key;
    s.dir = "asc";
  }
}

function sortMark(scope, key) {
  const s = state.sort[scope];
  if (!s || s.key !== key) return "";
  return s.dir === "asc" ? " ▲" : " ▼";
}

function sortableCell(label, scope, key, extraClass = "", tag = "div") {
  const s = state.sort[scope];
  const active = s && s.key === key ? ` sorted ${s.dir}` : "";
  const cls = `sortable${active}${extraClass ? ` ${extraClass}` : ""}`;
  return `<${tag} class="${cls}" data-sort-scope="${escapeAttr(scope)}" data-sort-key="${escapeAttr(key)}" role="button" tabindex="0" title="Ordenar por ${escapeAttr(label)}">${escapeHtml(label)}${sortMark(scope, key)}</${tag}>`;
}

function handleSortClick(e) {
  const el = e.target.closest("[data-sort-key]");
  if (!el) return false;
  const scope = el.getAttribute("data-sort-scope");
  const key = el.getAttribute("data-sort-key");
  if (!scope || !key) return false;
  e.preventDefault();
  e.stopPropagation();
  toggleSort(scope, key);
  refresh();
  return true;
}

function setBanner(msg, isError = false) {
  const el = $("statusBanner");
  el.textContent = msg;
  el.classList.toggle("error-banner", isError);
  el.classList.toggle("hidden", !msg);
}

async function loadData() {
  setBanner("Carregando Acabado.csv e Componente.csv…");
  $("btnReload").disabled = true;
  try {
    state.allRows = await window.CargaParse.loadAllData();
    const aberto = state.allRows.filter((r) => r.status === "aberto").length;
    const fechada = state.allRows.length - aberto;
    setBanner(
      `Carregado: ${fmtNum(state.allRows.length)} operações · ${fmtNum(aberto)} aberto · ${fmtNum(fechada)} fechada`
    );
    rebuildDependentFilters();
    rebuildMonthFilterOptions();
    refresh();
    const temAberto = state.allRows.some((r) => r.status === "aberto");
    $("btnExport").disabled = !temAberto;
  } catch (err) {
    console.error(err);
    setBanner(
      `${err.message}. Sirva a pasta com um servidor local (ex.: npx --yes serve .) — abrir o HTML direto (file://) bloqueia o carregamento dos CSVs.`,
      true
    );
  } finally {
    $("btnReload").disabled = false;
  }
}

function bindEvents() {
  ["fTipo", "fSetor", "fPosto", "fOperador", "fStatus", "fWeeks", "fStart"].forEach((id) => {
    $(id).addEventListener("change", () => {
      if (id === "fTipo" || id === "fSetor" || id === "fPosto") rebuildDependentFilters();
      refresh();
    });
  });
  $("fMesMode")?.addEventListener("change", () => {
    updateMesFilterVisibility();
    refresh();
  });
  $("fMesOne")?.addEventListener("change", () => refresh());
  $("fMesSome")?.addEventListener("change", (e) => {
    if (e.target.matches('input[type="checkbox"]')) refresh();
  });
  $("fSearch").addEventListener("input", () => refresh());

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setTab(tab.dataset.tab));
  });

  $("resumoTree").addEventListener("click", (e) => {
    if (handleSortClick(e)) return;
    const setorEl = e.target.closest("[data-expand-setor]");
    if (setorEl) {
      const key = setorEl.getAttribute("data-expand-setor");
      if (state.expandedSetores.has(key)) state.expandedSetores.delete(key);
      else state.expandedSetores.add(key);
      renderResumo();
      return;
    }
    const postoEl = e.target.closest("[data-expand-posto]");
    if (postoEl) {
      const key = postoEl.getAttribute("data-expand-posto");
      if (state.expandedPostos.has(key)) state.expandedPostos.delete(key);
      else state.expandedPostos.add(key);
      renderResumo();
      return;
    }
    const opEl = e.target.closest("[data-expand-operador]");
    if (opEl) {
      const key = opEl.getAttribute("data-expand-operador");
      if (state.expandedOperadores.has(key)) state.expandedOperadores.delete(key);
      else state.expandedOperadores.add(key);
      renderResumo();
    }
  });

  $("cargaList").addEventListener("click", (e) => {
    if (handleSortClick(e)) return;
    const btn = e.target.closest("[data-expand-carga-setor]");
    if (!btn) return;
    const key = btn.getAttribute("data-expand-carga-setor");
    if (state.expandedCargaSetores.has(key)) state.expandedCargaSetores.delete(key);
    else state.expandedCargaSetores.add(key);
    renderCarga();
  });
  $("fCargaOs").addEventListener("input", () => {
    if (state.activeTab === "carga") renderCarga();
  });

  $("opsTable").addEventListener("click", (e) => {
    handleSortClick(e);
  });

  $("cronGrid").addEventListener("click", (e) => {
    if (handleSortClick(e)) return;
    const btn = e.target.closest("[data-expand-cron-dia]");
    if (!btn) return;
    const key = btn.getAttribute("data-expand-cron-dia");
    if (state.expandedCronDias.has(key)) state.expandedCronDias.delete(key);
    else state.expandedCronDias.add(key);
    renderCronogramaScheduleOnly();
  });

  $("fCronOs")?.addEventListener("input", () => {
    if (state.activeTab === "cronograma") renderCronogramaScheduleOnly();
  });
  $("btnCronExpandAll")?.addEventListener("click", () => setCronDiasExpanded(true));
  $("btnCronCollapseAll")?.addEventListener("click", () => setCronDiasExpanded(false));

  const setoresEl = $("cronSetoresTable");
  if (setoresEl) {
    setoresEl.addEventListener("input", (e) => {
      const input = e.target.closest(".param-input");
      if (input) updateParametrosSetorFromInput(input, { rebuild: false });
    });
    setoresEl.addEventListener("change", (e) => {
      const input = e.target.closest(".param-input");
      if (input) updateParametrosSetorFromInput(input, { rebuild: true });
    });
  }

  $("btnReload").addEventListener("click", () => loadData());

  $("btnExport").addEventListener("click", () => montarCronogramaPorSetor());

  document.querySelectorAll("[data-print-tab]").forEach((btn) => {
    btn.addEventListener("click", () => printTab(btn.getAttribute("data-print-tab")));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  $("fStart").value = todayInputValue();
  loadParametrosSetorFromStorage();
  bindEvents();
  updateMesFilterVisibility();
  loadData();
});
