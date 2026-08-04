/**
 * Agendamento heurístico das operações abertas por posto.
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
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

/**
 * @param {Array} allRows - todas as operações (aberto + fechada)
 * @param {object} options
 * @param {Date} options.startDate
 * @param {number} options.weeks - horizonte em semanas
 * @param {number} options.hoursPerDay - capacidade diária por posto
 * @param {string|null} options.postoFilter
 */
function buildSchedule(allRows, options) {
  const {
    startDate = new Date(),
    weeks = 2,
    hoursPerDay = 8,
    postoFilter = null,
  } = options;

  const workDays = nextWeekdays(startDate, weeks * 5);
  const capacityMin = hoursPerDay * 60;

  // precedência: seq N-1 fechada ou já agendada
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

  let openOps = allRows.filter((r) => r.status === "aberto");
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

  // remaining capacity per posto per day (minutes)
  const remaining = new Map(); // posto -> number[]
  const postos = [...new Set(openOps.map((r) => r.posto))].sort();
  for (const p of postos) {
    remaining.set(
      p,
      workDays.map(() => capacityMin)
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
      const caps = remaining.get(op.posto);
      if (!caps) {
        i++;
        continue;
      }
      let placed = false;
      for (let d = 0; d < workDays.length; d++) {
        const fits = caps[d] >= op.tempoMin;
        const oversizedTakesFullDay =
          op.tempoMin > capacityMin && caps[d] === capacityMin;
        if (!fits && !oversizedTakesFullDay) continue;

        caps[d] -= Math.min(op.tempoMin, caps[d]);
        const key = `${op.osBase}#${op.seq}`;
        scheduled.push({
          ...op,
          dataAgenda: workDays[d],
          dataAgendaRaw: formatDate(workDays[d]),
          diaIndex: d,
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

  // group by posto -> day
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
    "Tempo (min)",
    "Tempo (h)",
    "Tipo",
    "Status",
  ];
  const lines = [header.join(";")];
  const sorted = [...schedule.scheduled].sort((a, b) => {
    const s = a.setor.localeCompare(b.setor, "pt-BR");
    if (s !== 0) return s;
    const p = a.posto.localeCompare(b.posto, "pt-BR");
    if (p !== 0) return p;
    const da = a.dataAgenda.getTime() - b.dataAgenda.getTime();
    if (da !== 0) return da;
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
        String(r.tempoMin).replace(".", ","),
        r.tempoHoras.toFixed(2).replace(".", ","),
        r.tipo,
        "aberto",
      ].join(";")
    );
  }
  return lines.join("\r\n");
}

function groupBySetor(schedule) {
  const map = new Map();
  for (const postoBlock of schedule.byPosto) {
    // Separar ops do posto por setor (um posto pode atender mais de um)
    const opsBySetor = new Map();
    for (const day of postoBlock.days) {
      for (const op of day.ops) {
        if (!opsBySetor.has(op.setor)) opsBySetor.set(op.setor, []);
        opsBySetor.get(op.setor).push(op);
      }
    }

    for (const [setor, ops] of opsBySetor) {
      if (!map.has(setor)) {
        map.set(setor, {
          setor,
          postos: [],
          totalOps: 0,
          totalHoras: 0,
        });
      }
      const days = schedule.workDays.map((d, idx) => {
        const dayOps = ops.filter((o) => o.diaIndex === idx);
        return {
          data: d,
          label: weekdayLabel(d),
          ops: dayOps,
          horas: dayOps.reduce((a, o) => a + o.tempoHoras, 0),
        };
      });
      const totalHoras = days.reduce((a, d) => a + d.horas, 0);
      const totalOps = days.reduce((a, d) => a + d.ops.length, 0);
      map.get(setor).postos.push({
        posto: postoBlock.posto,
        days,
        totalHoras,
        totalOps,
      });
      map.get(setor).totalHoras += totalHoras;
      map.get(setor).totalOps += totalOps;
    }
  }

  return [...map.values()]
    .map((s) => ({
      ...s,
      postos: s.postos.sort((a, b) => b.totalHoras - a.totalHoras),
    }))
    .sort((a, b) => b.totalHoras - a.totalHoras || a.setor.localeCompare(b.setor, "pt-BR"));
}

function scheduleToHtmlBySetor(schedule, meta = {}) {
  const bySetor = groupBySetor(schedule);
  const titulo = meta.titulo || "Cronograma de Produção por Setor";
  const geradoEm = new Date().toLocaleString("pt-BR");

  const setoresHtml = bySetor
    .map((setor) => {
      const postosHtml = setor.postos
        .map((p) => {
          const rows = [];
          for (const day of p.days) {
            for (const op of day.ops) {
              rows.push(`<tr>
                <td>${escapeHtml(day.label)}</td>
                <td>${escapeHtml(op.dataAgendaRaw)}</td>
                <td>${escapeHtml(op.osBase)}-${String(op.seq).padStart(2, "0")}</td>
                <td>${escapeHtml(op.codigo)}</td>
                <td>${escapeHtml(op.descricao)}</td>
                <td>${escapeHtml(op.operacao)}</td>
                <td class="num">${op.tempoHoras.toFixed(1).replace(".", ",")} h</td>
                <td>${escapeHtml(op.tipo)}</td>
              </tr>`);
            }
          }
          if (!rows.length) return "";
          return `
            <h3>Posto: ${escapeHtml(p.posto)}
              <span class="meta">${p.totalOps} ops · ${p.totalHoras.toFixed(1).replace(".", ",")} h</span>
            </h3>
            <table>
              <thead>
                <tr>
                  <th>Dia</th><th>Data</th><th>OS</th><th>Código</th>
                  <th>Descrição</th><th>Operação</th><th>Tempo</th><th>Tipo</th>
                </tr>
              </thead>
              <tbody>${rows.join("")}</tbody>
            </table>`;
        })
        .join("");

      return `
        <section class="setor">
          <h2>${escapeHtml(setor.setor)}
            <span class="meta">${setor.totalOps} ops · ${setor.totalHoras.toFixed(1).replace(".", ",")} h</span>
          </h2>
          ${postosHtml || "<p class='empty'>Sem operações neste setor.</p>"}
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
  h2 .meta,h3 .meta{font-weight:500;opacity:.85;font-size:.85rem;margin-left:.5rem}
  h3{margin:1rem 0 .4rem;font-size:.95rem;color:#2f4a63;border-bottom:1px solid #c8ced6;padding-bottom:.3rem}
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
  <div class="sub">Gerado em ${escapeHtml(geradoEm)} · ${schedule.scheduled.length} operações · horizonte ${schedule.weeks} semana(s) · ${schedule.hoursPerDay} h/dia por posto</div>
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
