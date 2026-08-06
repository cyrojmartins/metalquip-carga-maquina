/**
 * UI — filtros, resumo hierárquico, carga, operações e cronograma.
 */

const state = {
  allRows: [],
  filtered: [],
  schedule: null,
  expandedSetores: new Set(),
  expandedPostos: new Set(),
  expandedOperadores: new Set(),
  operadoresPorSetor: {},
  expandedCargaSetores: new Set(),
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

function applyFilters() {
  const tipo = $("fTipo").value;
  const setor = $("fSetor").value;
  const posto = $("fPosto").value;
  const operador = $("fOperador").value;
  const status = $("fStatus").value;
  const search = ($("fSearch").value || "").trim().toLowerCase();

  state.filtered = state.allRows.filter((r) => {
    if (tipo && r.tipo !== tipo) return false;
    if (setor && r.setor !== setor) return false;
    if (posto && r.posto !== posto) return false;
    if (operador) {
      const op = r.operador || "(sem operador)";
      if (op !== operador) return false;
    }
    if (status && r.status !== status) return false;
    if (search) {
      const hay = `${r.osFull} ${r.osBase} ${r.codigo} ${r.descricao} ${r.operacao}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
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

function renderCarga() {
  const weeks = Number($("fWeeks").value) || 2;
  const hoursPerDay = Number($("fHours").value) || 8;
  const capacityPerRecurso = weeks * 5 * hoursPerDay;
  const osSearch = ($("fCargaOs")?.value || "").trim().toLowerCase();
  const opsGetters = {
    osFull: (r) => r.osFull,
    codigo: (r) => r.codigo,
    descricao: (r) => r.descricao,
    qtdLote: (r) => r.qtdLote,
    tempoUnit: (r) => r.tempoUnit,
    tempoTotal: (r) => r.tempoTotal,
  };

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
        capacity: capacityPerRecurso * operadores,
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

  $("cargaMeta").textContent = `Capacidade: ${fmtHours(capacityPerRecurso)} por recurso × qtde operadores (padrão = postos) · ${weeks} sem. × 5 dias × ${hoursPerDay} h`;

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
      ${sortableCell("Setor", "carga", "setor")}
      ${sortableCell("Horas", "carga", "horas", "num")}
      ${sortableCell("Operações", "carga", "ops", "num")}
      ${sortableCell("Capacidade", "carga", "capacity", "num")}
      ${sortableCell("Operadores", "carga", "operadores", "num")}
      ${sortableCell("Postos", "carga", "nPostos", "num")}
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
          <div class="load-item" data-setor="${escapeAttr(item.setor)}" data-horas="${item.horas}" data-ops="${item.ops}" data-cap-base="${capacityPerRecurso}">
            <div class="load-info">
              <button type="button" class="load-toggle" data-expand-carga-setor="${escapeAttr(item.setor)}" aria-expanded="${open}">
                <span class="toggle">${open ? "−" : "+"}</span>
                <span class="load-name" title="${escapeAttr(item.setor)}">${escapeHtml(item.setor)}</span>
              </button>
              <label class="ops-field">
                <span>Qtde operadores</span>
                <input
                  type="number"
                  class="ops-input"
                  min="1"
                  step="1"
                  value="${item.operadores}"
                  data-ops-setor="${escapeAttr(item.setor)}"
                  aria-label="Quantidade de operadores — ${escapeAttr(item.setor)}"
                />
                <span class="ops-hint">${fmtNum(item.nPostos)} posto${item.nPostos === 1 ? "" : "s"}</span>
              </label>
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

function updateCargaItemFromInput(input) {
  const setor = input.getAttribute("data-ops-setor");
  if (!setor) return;
  let n = Number(input.value);
  if (!Number.isFinite(n) || n < 1) n = 1;
  n = Math.floor(n);
  state.operadoresPorSetor[setor] = n;
  if (String(input.value) !== String(n)) input.value = String(n);

  const item = input.closest(".load-item");
  if (!item) return;
  const horas = Number(item.dataset.horas) || 0;
  const ops = Number(item.dataset.ops) || 0;
  const capBase = Number(item.dataset.capBase) || 0;
  const capacity = capBase * n;
  const pctRaw = capacity > 0 ? (100 * horas) / capacity : 0;
  const pct = Math.min(100, pctRaw);
  const over = horas > capacity;

  const bar = item.querySelector(".bar");
  const span = bar?.querySelector("span");
  if (bar) bar.classList.toggle("over", over);
  if (span) span.style.width = `${pct}%`;

  const pctEl = item.querySelector(".load-pct");
  if (pctEl) {
    pctEl.textContent = `${fmtNum(pctRaw, 0)}%`;
    pctEl.classList.toggle("over", over);
  }

  const block = item.closest(".load-block");
  if (block) block.classList.toggle("is-over", over);

  const meta = item.querySelector(".load-meta");
  if (meta) {
    meta.textContent = `${fmtHours(horas)} / ${fmtHours(capacity)} · ${fmtNum(ops)} ops${over ? " · sobrecarga" : ""}`;
  }
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
  const hoursPerDay = Number($("fHours").value) || 8;
  const postoFilter = $("fPosto").value || null;
  const tipo = $("fTipo").value;
  const setor = $("fSetor").value;
  const operador = $("fOperador").value;
  const search = ($("fSearch").value || "").trim().toLowerCase();

  // Cronograma sempre agenda abertas; respeita demais filtros da UI.
  // Precedência (OS seq) usa o universo completo em allRows.
  const openRows = state.allRows.filter((r) => {
    if (r.status !== "aberto") return false;
    if (tipo && r.tipo !== tipo) return false;
    if (setor && r.setor !== setor) return false;
    if (postoFilter && r.posto !== postoFilter) return false;
    if (operador) {
      const op = r.operador || "(sem operador)";
      if (op !== operador) return false;
    }
    if (search) {
      const hay = `${r.osFull} ${r.osBase} ${r.codigo} ${r.descricao} ${r.operacao}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const recursosPorSetor = { ...state.operadoresPorSetor };

  state.schedule = window.CargaSchedule.buildSchedule(state.allRows, {
    startDate: parseStartDate(),
    weeks,
    hoursPerDay,
    postoFilter: null, // já aplicado em openRows
    openRows,
    recursosPorSetor,
  });
  return state.schedule;
}

function renderSetorOpsTable(setor) {
  const rows = [];
  for (const day of setor.days) {
    for (const op of day.ops) {
      const os = op.osFull || `${op.osBase}-${String(op.seq).padStart(2, "0")}`;
      const tempoOper = op.tempoOper ?? 0;
      const tempoTotal = op.tempoSeg ?? (op.qtdLote || 0) * tempoOper;
      const dayLabel =
        day.label || (day.data ? window.CargaSchedule.weekdayLabel(day.data) : "");
      const dataRaw =
        op.dataAgendaRaw ||
        (day.data ? window.CargaSchedule.formatDate(day.data) : "");
      rows.push(`
        <tr${op.oversized ? ' class="oversized"' : ""}>
          <td>${escapeHtml(dayLabel)}</td>
          <td class="center">${escapeHtml(dataRaw)}</td>
          <td class="mono">${escapeHtml(os)}</td>
          <td class="codigo-item">${escapeHtml(op.codigo || "—")}</td>
          <td class="desc">${escapeHtml(op.descricao || "—")}</td>
          <td class="num">${fmtNum(op.qtdLote, 0)}</td>
          <td class="num">${fmtNum(tempoOper, 0)}</td>
          <td class="num">${fmtNum(tempoTotal, 0)}</td>
          <td>${escapeHtml(op.posto || "—")}</td>
          <td class="num">${fmtHours(op.tempoHoras)}</td>
        </tr>`);
    }
  }

  if (!rows.length) {
    return `<div class="empty schedule-empty">Sem operações neste setor.</div>`;
  }

  return `
    <div class="table-wrap schedule-table-wrap">
      <table class="data schedule-ops">
        <thead>
          <tr>
            <th>Dia</th>
            <th class="center">Data</th>
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
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>`;
}

function renderCronograma() {
  const hoursPerDay = Number($("fHours").value) || 8;
  const sch = ensureSchedule();
  let bySetor = window.CargaSchedule.groupBySetor(sch);

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

  $("btnExport").disabled = !sch.scheduled.length;
  $("cronMeta").textContent = `${fmtNum(sch.scheduled.length)} agendadas · ${fmtNum(sch.blocked.length)} fora do horizonte · ${bySetor.length} setores · ${fmtHours(hoursPerDay)}/recurso`;

  if (!bySetor.length) {
    $("cronGrid").innerHTML = `<div class="empty">Nada a agendar no filtro/horizonte atual.</div>`;
    return;
  }

  $("cronGrid").innerHTML = bySetor
    .map((setor) => {
      const cap =
        setor.capacityHorasDia != null
          ? ` · capac. ${fmtHours(setor.capacityHorasDia)}/dia`
          : "";
      return `
        <section class="schedule-setor">
          <div class="schedule-setor-head">
            <h2>${escapeHtml(setor.setor)}</h2>
            <span>${fmtNum(setor.totalOps)} ops · ${fmtHours(setor.totalHoras)}${cap}</span>
          </div>
          ${renderSetorOpsTable(setor)}
        </section>`;
    })
    .join("");

  if (sch.blocked.length) {
    const sample = sch.blocked
      .slice(0, 8)
      .map((b) => `${b.osFull} (${b.motivo})`)
      .join(" · ");
    $("cronGrid").innerHTML += `
      <div class="padded" style="padding:1rem;border-top:1px solid var(--line)">
        <strong>${fmtNum(sch.blocked.length)} operações não agendadas</strong>
        <div class="muted" style="margin-top:0.35rem;font-size:0.82rem">${escapeHtml(sample)}${sch.blocked.length > 8 ? "…" : ""}</div>
      </div>`;
  }
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
};

function filterSummaryForPrint() {
  const parts = [];
  const tipo = $("fTipo").value;
  const setor = $("fSetor").value;
  const posto = $("fPosto").value;
  const operador = $("fOperador").value;
  const status = $("fStatus").value;
  const search = ($("fSearch").value || "").trim();
  if (tipo) parts.push(`Tipo: ${tipo}`);
  if (setor) parts.push(`Setor: ${setor}`);
  if (posto) parts.push(`Posto: ${posto}`);
  if (operador) parts.push(`Operador: ${operador}`);
  if (status) parts.push(`Status: ${status}`);
  if (search) parts.push(`Busca: ${search}`);
  if (state.activeTab === "carga" || state.activeTab === "cronograma") {
    parts.push(`Horizonte: ${$("fWeeks").value} sem.`);
    parts.push(`Horas/dia: ${$("fHours").value}`);
  }
  if (state.activeTab === "cronograma" && $("fStart").value) {
    parts.push(`Início: ${$("fStart").value}`);
  }
  if (state.activeTab === "carga") {
    const os = ($("fCargaOs")?.value || "").trim();
    if (os) parts.push(`Filtro OS: ${os}`);
  }
  return parts.length ? parts.join(" · ") : "Sem filtros aplicados";
}

function printTab(tabName) {
  const cfg = PRINT_TABS[tabName];
  if (!cfg) return;
  if (state.activeTab !== tabName) setTab(tabName);

  const bodyEl = $(cfg.bodyId);
  const metaEl = $(cfg.metaId);
  if (!bodyEl) return;

  const content = bodyEl.innerHTML.trim();
  if (!content || content.includes('class="empty"')) {
    setBanner(`Nada para imprimir em “${cfg.title}”.`, true);
    return;
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
  <title>${escapeHtml(cfg.title)} — Metalquip</title>
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
    .ops-input, .load-toggle .toggle { display: none !important; }
    .load-toggle { pointer-events: none; border: none; background: transparent; padding: 0; color: inherit; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <header class="print-head">
    <h1>Metalquip — ${escapeHtml(cfg.title)}</h1>
    <p class="sub">${escapeHtml(meta)}</p>
    <p class="sub">${escapeHtml(filters)}</p>
    <p class="sub">Impresso em ${escapeHtml(printedAt)}</p>
  </header>
  <div class="print-body">${content}</div>
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
  ["fTipo", "fSetor", "fPosto", "fOperador", "fStatus", "fWeeks", "fHours", "fStart"].forEach((id) => {
    $(id).addEventListener("change", () => {
      if (id === "fTipo" || id === "fSetor" || id === "fPosto") rebuildDependentFilters();
      refresh();
    });
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

  $("cargaList").addEventListener("input", (e) => {
    const input = e.target.closest("[data-ops-setor]");
    if (input) updateCargaItemFromInput(input);
  });
  $("cargaList").addEventListener("change", (e) => {
    const input = e.target.closest("[data-ops-setor]");
    if (input) updateCargaItemFromInput(input);
  });
  $("cargaList").addEventListener("click", (e) => {
    if (handleSortClick(e)) return;
    if (e.target.closest("[data-ops-setor]")) return;
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
    handleSortClick(e);
  });

  $("btnReload").addEventListener("click", () => loadData());

  $("btnExport").addEventListener("click", () => montarCronogramaPorSetor());

  document.querySelectorAll("[data-print-tab]").forEach((btn) => {
    btn.addEventListener("click", () => printTab(btn.getAttribute("data-print-tab")));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  $("fStart").value = todayInputValue();
  bindEvents();
  loadData();
});
