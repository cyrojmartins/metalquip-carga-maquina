/**
 * Agendamento heurístico das operações abertas por setor.
 * Capacidade diária do setor = (horas/dia por recurso) × qtde de recursos
 * (override manual de operadores, ou nº de postos com ops abertas).
 */

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isWeekday(d) {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

function nextWeekdays(fromDate, count) {
  const days = [];
  let cur = startOfDay(fromDate);
  // if weekend, jump to Monday
  while (!isWeekday(cur)) cur = addDays(cur, 1);
  while (days.length < count) {
    if (isWeekday(cur)) days.push(new Date(cur));
    cur = addDays(cur, 1);
  }
  return days;
}

function formatDate(d) {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function weekdayLabel(d) {
  const weekday = d.toLocaleDateString("pt-BR", { weekday: "long" });
  const name = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${name}, ${dd}/${mm}`;
}

/**
 * @param {Array} allRows - todas as operações (aberto + fechada) — precedência usa fechadas
 * @param {object} options
 * @param {Date} options.startDate
 * @param {number} options.weeks - horizonte em semanas
 * @param {number} options.hoursPerDay - capacidade diária por posto/recurso
 * @param {string|null} options.postoFilter
 * @param {object} [options.recursosPorSetor] - override de qtde de recursos (operadores) por setor
 * @param {Array} [options.openRows] - subset de ops abertas a agendar (filtros da UI)
 */
function buildSchedule(allRows, options) {
  const {
    startDate = new Date(),
    weeks = 2,
    hoursPerDay = 8,
    postoFilter = null,
    recursosPorSetor = {},
    openRows = null,
  } = options;

  const workDays = nextWeekdays(startDate, weeks * 5);
  const capacityPerRecursoMin = hoursPerDay * 60;

  // precedência: seq N-1 fechada ou já agendada (sempre com o universo completo)
  const byOs = new Map();
  for (const r of allRows) {
    if (!byOs.has(r.osBase)) byOs.set(r.osBase, []);
    byOs.get(r.osBase).push(r);
  }
  for (const list of byOs.values()) {
    list.sort((a, b) => a.seq - b.seq);
  }

  const closedKeys = new Set(
    allRows.filter((r) => r.status === "fechada").map((r) => `${r.osBase}#${r.seq}`)
  );

  let openOps = (openRows || allRows).filter((r) => r.status === "aberto");
  if (postoFilter) {
    openOps = openOps.filter((r) => r.posto === postoFilter);
  }

  openOps.sort((a, b) => {
    const ea = a.emissao ? a.emissao.getTime() : 0;
    const eb = b.emissao ? b.emissao.getTime() : 0;
    if (ea !== eb) return ea - eb;
    if (a.osBase !== b.osBase) return a.osBase.localeCompare(b.osBase);
    return a.seq - b.seq;
  });

  // postos por setor → capacidade diária (override por recursos/operadores quando informado)
  const postosPorSetor = new Map();
  for (const op of openOps) {
    if (!postosPorSetor.has(op.setor)) postosPorSetor.set(op.setor, new Set());
    postosPorSetor.get(op.setor).add(op.posto);
  }

  const capacityMinBySetor = new Map();
  const recursosBySetor = new Map();
  const remaining = new Map(); // setor -> minutos restantes por dia
  const setores = [...postosPorSetor.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"));
  for (const s of setores) {
    const nPostos = postosPorSetor.get(s).size || 1;
    const override = Number(recursosPorSetor[s]);
    const nRecursos =
      Number.isFinite(override) && override >= 1 ? Math.floor(override) : nPostos;
    const dayCap = capacityPerRecursoMin * nRecursos;
    recursosBySetor.set(s, nRecursos);
    capacityMinBySetor.set(s, dayCap);
    remaining.set(
      s,
      workDays.map(() => dayCap)
    );
  }

  const scheduled = [];
  const scheduledKeys = new Set();
  const blocked = [];

  function predecessorOk(op) {
    if (op.seq <= 1) return true;
    const prevKey = `${op.osBase}#${op.seq - 1}`;
    return closedKeys.has(prevKey) || scheduledKeys.has(prevKey);
  }

  // multi-pass: keep trying until no progress (for OS sequences)
  let progress = true;
  const pending = [...openOps];
  while (progress && pending.length) {
    progress = false;
    for (let i = 0; i < pending.length; ) {
      const op = pending[i];
      if (!predecessorOk(op)) {
        i++;
        continue;
      }
      const caps = remaining.get(op.setor);
      const dayCap = capacityMinBySetor.get(op.setor) || capacityPerRecursoMin;
      if (!caps) {
        i++;
        continue;
      }
      let placed = false;
      for (let d = 0; d < workDays.length; d++) {
        const fits = caps[d] >= op.tempoMin;
        const oversizedTakesFullDay =
          op.tempoMin > dayCap && caps[d] === dayCap;
        if (!fits && !oversizedTakesFullDay) continue;

        const used = Math.min(op.tempoMin, caps[d]);
        caps[d] -= used;
        const key = `${op.osBase}#${op.seq}`;
        scheduled.push({
          ...op,
          dataAgenda: workDays[d],
          dataAgendaRaw: formatDate(workDays[d]),
          diaIndex: d,
          oversized: op.tempoMin > dayCap,
          minutosAlocados: used,
        });
        scheduledKeys.add(key);
        pending.splice(i, 1);
        placed = true;
        progress = true;
        break;
      }
      if (!placed) i++;
    }
  }

  for (const op of pending) {
    blocked.push({
      ...op,
      motivo: predecessorOk(op) ? "sem capacidade no horizonte" : "aguardando operação anterior da OS",
    });
  }

  // group by setor -> day
  const bySetorMap = new Map();
  for (const s of scheduled) {
    if (!bySetorMap.has(s.setor)) {
      bySetorMap.set(
        s.setor,
        workDays.map((d) => ({ data: d, label: weekdayLabel(d), ops: [], horas: 0 }))
      );
    }
    const days = bySetorMap.get(s.setor);
    days[s.diaIndex].ops.push(s);
    days[s.diaIndex].horas += s.tempoHoras;
  }

  const bySetor = [...bySetorMap.entries()]
    .map(([setor, days]) => {
      const dayCapMin = capacityMinBySetor.get(setor) || capacityPerRecursoMin;
      const daysWithLoad = days.map((d) => ({
        ...d,
        capacityHoras: dayCapMin / 60,
        pct: dayCapMin > 0 ? Math.min(999, (100 * d.horas * 60) / dayCapMin) : 0,
      }));
      return {
        setor,
        days: daysWithLoad,
        nPostos: postosPorSetor.get(setor)?.size || 0,
        nRecursos: recursosBySetor.get(setor) || 0,
        capacityHorasDia: dayCapMin / 60,
        totalHoras: daysWithLoad.reduce((a, d) => a + d.horas, 0),
        totalOps: daysWithLoad.reduce((a, d) => a + d.ops.length, 0),
      };
    })
    .sort((a, b) => b.totalHoras - a.totalHoras || a.setor.localeCompare(b.setor, "pt-BR"));

  // compat: byPosto derivado para quem ainda agrupa por posto na visualização auxiliar
  const byPosto = new Map();
  for (const s of scheduled) {
    if (!byPosto.has(s.posto)) {
      byPosto.set(
        s.posto,
        workDays.map((d) => ({ data: d, label: weekdayLabel(d), ops: [], horas: 0 }))
      );
    }
    const days = byPosto.get(s.posto);
    days[s.diaIndex].ops.push(s);
    days[s.diaIndex].horas += s.tempoHoras;
  }

  return {
    workDays,
    hoursPerDay,
    weeks,
    bySetor,
    byPosto: [...byPosto.entries()]
      .map(([posto, days]) => ({
        posto,
        days,
        totalHoras: days.reduce((a, d) => a + d.horas, 0),
        totalOps: days.reduce((a, d) => a + d.ops.length, 0),
      }))
      .sort((a, b) => b.totalHoras - a.totalHoras),
    scheduled,
    blocked,
  };
}

function scheduleToCsv(schedule) {
  const header = [
    "Setor da Fábrica",
    "Posto de Trabalho",
    "Data Agenda",
    "OS",
    "Seq",
    "Código Item",
    "Descrição",
    "Operação",
    "Tempo Oper (s)",
    "T. Produção (s)",
    "Tempo (h)",
    "Tipo",
    "Status",
  ];
  const lines = [header.join(";")];
  const sorted = [...schedule.scheduled].sort((a, b) => {
    const s = a.setor.localeCompare(b.setor, "pt-BR");
    if (s !== 0) return s;
    const da = a.dataAgenda.getTime() - b.dataAgenda.getTime();
    if (da !== 0) return da;
    const p = a.posto.localeCompare(b.posto, "pt-BR");
    if (p !== 0) return p;
    return a.seq - b.seq;
  });
  for (const r of sorted) {
    lines.push(
      [
        r.setor,
        r.posto,
        r.dataAgendaRaw,
        r.osBase,
        r.seq,
        r.codigo,
        `"${r.descricao.replace(/"/g, '""')}"`,
        r.operacao,
        String(r.tempoOper ?? r.tempoMin).replace(".", ","),
        String(r.tempoSeg ?? r.tempoMin * 60).replace(".", ","),
        r.tempoHoras.toFixed(2).replace(".", ","),
        r.tipo,
        "aberto",
      ].join(";")
    );
  }
  return lines.join("\r\n");
}

/** Retorna blocos por setor com grade diária (capacidade compartilhada do setor). */
function groupBySetor(schedule) {
  if (schedule.bySetor?.length) {
    return schedule.bySetor.map((s) => ({
      ...s,
      postos: [],
    }));
  }

  // fallback a partir de scheduled
  const map = new Map();
  for (const op of schedule.scheduled || []) {
    if (!map.has(op.setor)) {
      map.set(op.setor, {
        setor: op.setor,
        days: schedule.workDays.map((d) => ({
          data: d,
          label: weekdayLabel(d),
          ops: [],
          horas: 0,
        })),
        totalOps: 0,
        totalHoras: 0,
        postos: [],
      });
    }
    const block = map.get(op.setor);
    block.days[op.diaIndex].ops.push(op);
    block.days[op.diaIndex].horas += op.tempoHoras;
    block.totalOps += 1;
    block.totalHoras += op.tempoHoras;
  }
  return [...map.values()].sort(
    (a, b) => b.totalHoras - a.totalHoras || a.setor.localeCompare(b.setor, "pt-BR")
  );
}

function scheduleToHtmlBySetor(schedule, meta = {}) {
  const bySetor = groupBySetor(schedule);
  const titulo = meta.titulo || "Cronograma de Produção por Setor";
  const geradoEm = new Date().toLocaleString("pt-BR");

  const setoresHtml = bySetor
    .map((setor) => {
      const rows = [];
      for (const day of setor.days) {
        for (const op of day.ops) {
          rows.push(`<tr>
            <td>${escapeHtml(day.label)}</td>
            <td>${escapeHtml(op.dataAgendaRaw)}</td>
            <td>${escapeHtml(op.osFull || `${op.osBase}-${String(op.seq).padStart(2, "0")}`)}</td>
            <td>${escapeHtml(op.codigo)}</td>
            <td>${escapeHtml(op.descricao)}</td>
            <td class="num">${String(op.qtdLote ?? 0).replace(".", ",")}</td>
            <td class="num">${String(op.tempoOper ?? 0).replace(".", ",")}</td>
            <td class="num">${String(op.tempoSeg ?? (op.qtdLote || 0) * (op.tempoOper || 0)).replace(".", ",")}</td>
            <td>${escapeHtml(op.posto)}</td>
            <td class="num">${op.tempoHoras.toFixed(1).replace(".", ",")} h</td>
          </tr>`);
        }
      }
      const cap =
        setor.capacityHorasDia != null
          ? ` · capac. ${setor.capacityHorasDia.toFixed(1).replace(".", ",")} h/dia`
          : "";
      return `
        <section class="setor">
          <h2>${escapeHtml(setor.setor)}
            <span class="meta">${setor.totalOps} ops · ${setor.totalHoras.toFixed(1).replace(".", ",")} h${cap}</span>
          </h2>
          ${
            rows.length
              ? `<table>
              <thead>
                <tr>
                  <th>Dia</th>
                  <th>Data</th>
                  <th>Nº Ord.Serviço</th>
                  <th>Código Item</th>
                  <th>Descrição do Item</th>
                  <th>Qtd.Lote</th>
                  <th>Tempo Oper (s)</th>
                  <th>Tempo total (s)</th>
                  <th>Posto</th>
                  <th>Horas</th>
                </tr>
              </thead>
              <tbody>${rows.join("")}</tbody>
            </table>`
              : "<p class='empty'>Sem operações neste setor.</p>"
          }
        </section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(titulo)}</title>
<style>
  body{font-family:Segoe UI,system-ui,sans-serif;color:#1a1d21;margin:24px;font-size:13px}
  h1{font-size:1.4rem;margin:0 0 .25rem;color:#2f4a63}
  .sub{color:#5c6570;margin-bottom:1.5rem}
  h2{background:#2f4a63;color:#fff;padding:.55rem .75rem;margin:1.5rem 0 .75rem;font-size:1.05rem;border-radius:4px}
  h2 .meta{font-weight:500;opacity:.85;font-size:.85rem;margin-left:.5rem}
  table{width:100%;border-collapse:collapse;margin-bottom:1rem}
  th,td{border:1px solid #c8ced6;padding:.35rem .45rem;text-align:left;vertical-align:top}
  th{background:#eef0f3;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:#5c6570}
  .num{text-align:right;white-space:nowrap}
  .empty{color:#5c6570}
  @media print{body{margin:12px} h2{break-after:avoid} table{break-inside:avoid}}
</style>
</head>
<body>
  <h1>${escapeHtml(titulo)}</h1>
  <div class="sub">Gerado em ${escapeHtml(geradoEm)} · ${schedule.scheduled.length} operações · horizonte ${schedule.weeks} semana(s) · ${schedule.hoursPerDay} h/dia por recurso (capacidade acumulada por setor)</div>
  ${setoresHtml || "<p class='empty'>Nenhuma operação agendada.</p>"}
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

window.CargaSchedule = {
  buildSchedule,
  scheduleToCsv,
  scheduleToHtmlBySetor,
  groupBySetor,
  formatDate,
  nextWeekdays,
  weekdayLabel,
};
