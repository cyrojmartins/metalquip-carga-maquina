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
  const base = state.allRows.filter((r) => {
    if (tipo && r.tipo !== tipo) return false;
    if (setor && r.setor !== setor) return false;
    return true;
  });

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
  const hierarchy = window.CargaParse.buildHierarchy(state.filtered);
  $("resumoMeta").textContent = `${hierarchy.length} setores`;

  const header = `
    <div class="tree-row header">
      <div>Nome</div>
      <div class="num">Total</div>
      <div class="num">Aberto</div>
      <div class="num">Fechada</div>
      <div class="num hide-sm">% Fech.</div>
      <div class="num">Horas abertas</div>
    </div>`;

  const parts = [header];

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
            <div class="num hide-sm">${fmtNum(op.total ? (100 * op.fechada) / op.total : 0, 0)}%</div>
            <div class="num">${fmtHours(op.horasAbertas)}</div>
          </div>`);

        if (!oOpen) continue;

        const showApontado = $("fStatus").value !== "aberto";
        const opsHeader = showApontado
          ? `
            <div class="tree-ops-row header with-apontado">
              <div>Nº OS</div>
              <div>Código</div>
              <div>Descrição</div>
              <div class="num">Qtde Lote</div>
              <div class="num">Tempo unit.</div>
              <div class="num">Tempo total</div>
              <div class="num">Qtde Final</div>
              <div class="num" title="((Terminou − Início) ÷ Qtde.Final) × 60 — segundos">Tempo/un. real (s)</div>
            </div>`
          : `
            <div class="tree-ops-row header">
              <div>Nº OS</div>
              <div>Código</div>
              <div>Descrição</div>
              <div class="num">Qtde Lote</div>
              <div class="num">Tempo unit.</div>
              <div class="num">Tempo total</div>
            </div>`;

        parts.push(`
          <div class="tree-ops-wrap">
            ${opsHeader}
            ${op.operacoes
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

function getOperadoresSetor(setor) {
  const n = Number(state.operadoresPorSetor[setor]);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function renderCarga() {
  const weeks = Number($("fWeeks").value) || 2;
  const hoursPerDay = Number($("fHours").value) || 8;
  const capacityPerOperador = weeks * 5 * hoursPerDay;
  const osSearch = ($("fCargaOs")?.value || "").trim().toLowerCase();

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
      tempoUnit: r.tempoMin,
      tempoTotal: r.qtdLote * r.tempoMin,
    });
  }

  let list = [...bySetor.values()]
    .map((item) => {
      const operadores = getOperadoresSetor(item.setor);
      let operacoes = [...item.operacoes].sort(
        (a, b) =>
          b.tempoTotal - a.tempoTotal ||
          String(a.osFull).localeCompare(String(b.osFull), "pt-BR")
      );
      if (osSearch) {
        operacoes = operacoes.filter((op) => {
          const hay = `${op.osFull} ${op.codigo} ${op.descricao}`.toLowerCase();
          return hay.includes(osSearch);
        });
      }
      return {
        ...item,
        nPostos: item.postos.size,
        operadores,
        capacity: capacityPerOperador * operadores,
        operacoes,
      };
    })
    .sort((a, b) => b.horas - a.horas);

  if (osSearch) {
    list = list.filter((item) => item.operacoes.length > 0);
    for (const item of list) state.expandedCargaSetores.add(item.setor);
  }

  $("cargaMeta").textContent = `Capacidade: ${fmtHours(capacityPerOperador)} por operador × qtde operadores (${weeks} sem. × 5 dias × ${hoursPerDay} h)`;

  if (!list.length) {
    $("cargaList").innerHTML = `<div class="empty">${
      osSearch
        ? "Nenhuma OS encontrada com o filtro atual."
        : "Sem operações abertas no filtro."
    }</div>`;
    return;
  }

  $("cargaList").innerHTML = `<div class="load-list">${list
    .map((item) => {
      const pct = item.capacity > 0 ? Math.min(100, (100 * item.horas) / item.capacity) : 0;
      const over = item.horas > item.capacity;
      const open = state.expandedCargaSetores.has(item.setor);
      const opsTable = open
        ? `
        <div class="tree-ops-wrap carga-ops">
          <div class="tree-ops-row header">
            <div>Nº OS</div>
            <div>Código</div>
            <div>Descrição</div>
            <div class="num">Qtde Lote</div>
            <div class="num">Tempo unit.</div>
            <div class="num">Tempo total</div>
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
        <div class="load-block">
          <div class="load-item" data-setor="${escapeAttr(item.setor)}" data-horas="${item.horas}" data-ops="${item.ops}" data-cap-base="${capacityPerOperador}">
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
              </label>
            </div>
            <div class="bar ${over ? "over" : ""}"><span style="width:${pct}%"></span></div>
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
  const pct = capacity > 0 ? Math.min(100, (100 * horas) / capacity) : 0;
  const over = horas > capacity;

  const bar = item.querySelector(".bar");
  const span = bar?.querySelector("span");
  if (bar) bar.classList.toggle("over", over);
  if (span) span.style.width = `${pct}%`;

  const meta = item.querySelector(".load-meta");
  if (meta) {
    meta.textContent = `${fmtHours(horas)} / ${fmtHours(capacity)} · ${fmtNum(ops)} ops${over ? " · sobrecarga" : ""}`;
  }
}

function renderOps() {
  const rows = state.filtered.slice(0, 2000);
  const showApontado = $("fStatus").value !== "aberto";
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
      <td>${badge(r.status)}</td>
      <td>${escapeHtml(r.tipo)}</td>
      <td>${escapeHtml(r.emissaoRaw)}</td>
      <td>${escapeHtml(r.osFull)}</td>
      <td>${escapeHtml(r.codigo)}</td>
      <td class="wrap">${escapeHtml(r.descricao)}</td>
      <td>${escapeHtml(r.operacao)}</td>
      <td class="num">${fmtNum(r.tempoMin, 0)}</td>
      <td>${escapeHtml(r.posto)}</td>
      <td>${escapeHtml(r.setor)}</td>
      <td>${escapeHtml(r.operador || "—")}</td>
      <td>${escapeHtml(r.diaOperacaoRaw || "—")}</td>
      ${apontadoCells}
    </tr>`;
    })
    .join("");

  const apontadoHeaders = showApontado
    ? `<th>Início</th><th>Término</th><th>Qtde Final</th><th title="((Terminou − Início) ÷ Qtde.Final) × 60 — segundos">Tempo/un. real (s)</th>`
    : "";

  $("opsTable").innerHTML = `
    <table class="data">
      <thead>
        <tr>
          <th>Status</th><th>Tipo</th><th>Emissão</th><th>OS</th><th>Código</th>
          <th>Descrição</th><th>Operação</th><th>Tempo</th><th>Posto</th>
          <th>Setor</th><th>Operador</th><th>Dia Operação</th>
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
  const baseRows = state.allRows.filter((r) => {
    if (tipo && r.tipo !== tipo) return false;
    if (setor && r.setor !== setor) return false;
    return true;
  });

  state.schedule = window.CargaSchedule.buildSchedule(baseRows, {
    startDate: parseStartDate(),
    weeks,
    hoursPerDay,
    postoFilter,
  });
  return state.schedule;
}

function renderDayChips(days) {
  return days
    .map((d) => {
      const chips = d.ops
        .slice(0, 12)
        .map(
          (op) => `
        <div class="op-chip" title="${escapeAttr(op.descricao)}">
          <div class="os">${escapeHtml(op.osBase)}-${String(op.seq).padStart(2, "0")}</div>
          <div>${escapeHtml(op.operacao)}</div>
          <div class="muted">${fmtHours(op.tempoHoras)} · ${escapeHtml(op.codigo)}</div>
        </div>`
        )
        .join("");
      const more =
        d.ops.length > 12
          ? `<div class="muted" style="padding:0.2rem 0.35rem">+${d.ops.length - 12} ops</div>`
          : "";
      return `
        <div class="day-col">
          <div class="day-head"><span>${escapeHtml(d.label)}</span><span>${fmtHours(d.horas)}</span></div>
          <div class="day-ops">${chips || `<div class="muted" style="padding:0.35rem">livre</div>`}${more}</div>
        </div>`;
    })
    .join("");
}

function renderCronograma() {
  const hoursPerDay = Number($("fHours").value) || 8;
  const sch = ensureSchedule();
  const bySetor = window.CargaSchedule.groupBySetor(sch);

  $("btnExport").disabled = !sch.scheduled.length;
  $("cronMeta").textContent = `${fmtNum(sch.scheduled.length)} agendadas · ${fmtNum(sch.blocked.length)} fora do horizonte · ${bySetor.length} setores · ${fmtHours(hoursPerDay)}/dia`;

  if (!bySetor.length) {
    $("cronGrid").innerHTML = `<div class="empty">Nada a agendar no filtro/horizonte atual.</div>`;
    return;
  }

  $("cronGrid").innerHTML = bySetor
    .map((setor) => {
      const postosHtml = setor.postos
        .map(
          (p) => `
        <div class="schedule-posto">
          <h3>${escapeHtml(p.posto)} <span class="muted">· ${fmtNum(p.totalOps)} ops · ${fmtHours(p.totalHoras)}</span></h3>
          <div class="schedule-days">${renderDayChips(p.days)}</div>
        </div>`
        )
        .join("");
      return `
        <section class="schedule-setor">
          <div class="schedule-setor-head">
            <h2>${escapeHtml(setor.setor)}</h2>
            <span>${fmtNum(setor.totalOps)} ops · ${fmtHours(setor.totalHoras)}</span>
          </div>
          ${postosHtml}
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

  $("btnReload").addEventListener("click", () => loadData());

  $("btnExport").addEventListener("click", () => montarCronogramaPorSetor());
}

document.addEventListener("DOMContentLoaded", () => {
  $("fStart").value = todayInputValue();
  bindEvents();
  loadData();
});
