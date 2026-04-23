const SYNC_TIP_DEVICE_ONLY =
  "Данные в резерве браузера. Откройте страницу по ссылке (http://, не из папки как файл), затем нажмите «Обновить» (F5) и при необходимости введите данные снова — тогда сработает полное сохранение в память устройства.";

const LS_KEY = "attestation_app_state_v1";
const PUBLIC_VIEW_KEY = "attestation_public_route_v1";
const VIEWS = ["zavuch", "teacher", "advisor"];

/**
 * Хвост класса после параллели: 10Б, 10БФ, 10БХБ -> 10Б. Цифры (11А1) не трогаем.
 * Список дополняйте буквенными/двубуквенными кодами подгрупп вашей школы.
 */
const CLASS_SUBGROUP_EXTRA = new Set(
  "Ф,Х,М,П,И,А,В,К,Н,Р,Т,Г,Д,Л,О,У,Ш,Щ,З,Ж,Ц,Э,Ю,Я,Ь,Ъ,ХБ,СЯ,СХ,СМ,СО,СД,СШ,СУ,ПМ,СИ,ПИ,БИ,ПС,МН,МГ,ФМ,ХМ,ХА,Ч,Ы".split(
    ",",
  ),
);

const state = {
  studentsByClass: {},
  subjectAssignments: [],
  classAdvisors: {},
  subjectStats: {},
  classGrades: {},
};

const els = {
  studentsFile: document.getElementById("studentsFile"),
  subjectsFile: document.getElementById("subjectsFile"),
  importStatus: document.getElementById("importStatus"),
  teacherSelect: document.getElementById("teacherSelect"),
  subjectTableBody: document.querySelector("#subjectTable tbody"),
  confirmedTotal: document.getElementById("confirmedTotal"),
  advisorsTableBody: document.querySelector("#advisorsTable tbody"),
  addAdvisorBtn: document.getElementById("addAdvisorBtn"),
  saveAdvisorsBtn: document.getElementById("saveAdvisorsBtn"),
  journalClassSelect: document.getElementById("journalClassSelect"),
  advisorInfo: document.getElementById("advisorInfo"),
  classTableHead: document.querySelector("#classTable thead"),
  classTableBody: document.querySelector("#classTable tbody"),
  exportBtn: document.getElementById("exportBtn"),
  importJsonFile: document.getElementById("importJsonFile"),
  zavuchStats: document.getElementById("zavuchStats"),
  syncStatus: document.getElementById("syncStatus"),
};

let saveTimer = null;

void bootstrap();

async function bootstrap() {
  bindEvents();
  try {
    await loadPersistedState();
  } catch (e) {
    console.error(e);
    readLocalCacheOnly();
  }
  initRouting();
  initPrintSelectSnapshot();
  initPrint();
  renderAll();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushSaveNow();
    }
  });
}

async function loadPersistedState() {
  if (typeof AtteDB === "undefined") {
    throw new Error("AtteDB не подключен");
  }
  setSyncStatus("pending", "…");
  await AtteDB.init();
  let fromDb = AtteDB.getJson();
  if (fromDb && typeof fromDb === "object") {
    applyStateFromPayload(fromDb);
  } else {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data && typeof data === "object") {
          applyStateFromPayload(data);
          setSyncStatus("pending", "…");
          await AtteDB.setJsonFromState(state);
        }
      } catch (e) {
        console.warn(e);
      }
    }
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn(e);
  }
  setSyncStatus("ok", "Сохранено");
  updateImportStatus();
}

function readLocalCacheOnly() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      updateImportStatus();
      setSyncStatus("muted", "—");
      return;
    }
    const data = JSON.parse(raw);
    if (data && typeof data === "object") {
      applyStateFromPayload(data);
    }
    updateImportStatus();
  } catch (e) {
    console.error(e);
    setStatus("Не удалось прочитать кэш браузера.", "warn");
  }
  setSyncStatus("local", "Сохранено только на вашем устройстве", SYNC_TIP_DEVICE_ONLY);
}

function applyStateFromPayload(data) {
  if (!data || typeof data !== "object") return;
  state.studentsByClass = data.studentsByClass || {};
  state.subjectAssignments = data.subjectAssignments || [];
  state.classAdvisors = data.classAdvisors || {};
  state.subjectStats = data.subjectStats || {};
  state.classGrades = data.classGrades || {};
  rekeyCanonicalState();
  for (const s of Object.values(state.subjectStats)) {
    migratePerformedField(s);
  }
}

function setSyncStatus(kind, text, titleText) {
  if (!els.syncStatus) return;
  els.syncStatus.textContent = text;
  els.syncStatus.className = "sync-status";
  els.syncStatus.removeAttribute("title");
  if (kind === "ok") {
    els.syncStatus.classList.add("sync-status--ok");
  } else if (kind === "pending") {
    els.syncStatus.classList.add("sync-status--pending");
  } else if (kind === "local") {
    els.syncStatus.classList.add("sync-status--local");
    els.syncStatus.setAttribute("title", titleText || SYNC_TIP_DEVICE_ONLY);
  } else {
    els.syncStatus.classList.add("sync-status--muted");
  }
}

function savePersisted() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    console.error(e);
  }
  scheduleDbSave();
}

function scheduleDbSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  setSyncStatus("pending", "…");
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistToDatabase();
  }, 300);
}

async function flushSaveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await persistToDatabase();
}

async function persistToDatabase() {
  if (typeof AtteDB === "undefined" || !AtteDB) {
    setSyncStatus("local", "Сохранено только на вашем устройстве", SYNC_TIP_DEVICE_ONLY);
    return;
  }
  try {
    await AtteDB.init();
    await AtteDB.setJsonFromState(state);
    setSyncStatus("ok", "Сохранено");
  } catch (e) {
    console.error(e);
    setSyncStatus("local", "Сохранено только на вашем устройстве", SYNC_TIP_DEVICE_ONLY);
  }
}

function parseHashRoute() {
  const h = (location.hash || "").replace(/^#/, "").replace(/^\//, "").split("/")[0];
  if (!h) return "teacher";
  if (h === "admin") return "admin";
  if (h === "journal" || h === "advisor") return "journal";
  return "teacher";
}

function applyRoute() {
  const route = parseHashRoute();
  const publicNav = document.getElementById("publicNav");
  const adminNav = document.getElementById("adminNav");

  if (route === "admin") {
    if (publicNav) publicNav.hidden = true;
    if (adminNav) adminNav.hidden = false;
    setActiveView("zavuch");
    renderAll();
  } else {
    if (publicNav) publicNav.hidden = false;
    if (adminNav) adminNav.hidden = true;
    const viewName = route === "journal" ? "advisor" : "teacher";
    setActiveView(viewName);
    try {
      localStorage.setItem(PUBLIC_VIEW_KEY, viewName);
    } catch {
      // ignore
    }
    const navT = document.getElementById("navTeacher");
    const navJ = document.getElementById("navJournal");
    if (navT) navT.classList.toggle("is-active", route === "teacher");
    if (navJ) navJ.classList.toggle("is-active", route === "journal");
  }
}

function bindPublicNav() {
  document.querySelectorAll("#publicNav [data-hash]").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = "#/" + btn.dataset.hash;
    });
  });
}

function initRouting() {
  if (!location.hash || location.hash === "#") {
    const last = localStorage.getItem(PUBLIC_VIEW_KEY);
    location.hash = last === "advisor" ? "#/journal" : "#/teacher";
  }
  window.addEventListener("hashchange", applyRoute);
  bindPublicNav();
  applyRoute();
}

function resolveCurrentViewPrintMode() {
  const r = parseHashRoute();
  if (r === "admin") return "zavuch-all";
  if (r === "journal") return "class";
  return "subject";
}

let printAfterFallbackTimer = null;
/** @type {{ sel: HTMLSelectElement; span: HTMLSpanElement; prevDisplay: string }[]} */
const printSelectSnapshots = [];

/**
 * В предпросмотре печати нативный <select> часто рисует стрелку, игнорируя CSS.
 * Заменяем на span с выбранным текстом, после печати возвращаем обратно.
 */
function restoreSelectsForPrint() {
  while (printSelectSnapshots.length) {
    const { sel, span, prevDisplay } = printSelectSnapshots.pop();
    if (span.isConnected) span.remove();
    if (sel.isConnected) {
      sel.removeAttribute("data-print-replaced");
      if (prevDisplay) sel.style.display = prevDisplay;
      else sel.style.removeProperty("display");
    }
  }
}

function flattenSelectsForPrint() {
  if (printSelectSnapshots.length) restoreSelectsForPrint();
  document.querySelectorAll("select").forEach((sel) => {
    if (sel.getAttribute("data-print-replaced") === "1") return;
    const opt = sel.options[sel.selectedIndex];
    const text = opt != null ? opt.text : "";
    const span = document.createElement("span");
    span.className = "print-select-snapshot";
    span.textContent = text;
    const prevDisplay = sel.style.display;
    sel.setAttribute("data-print-replaced", "1");
    sel.style.display = "none";
    sel.insertAdjacentElement("afterend", span);
    printSelectSnapshots.push({ sel, span, prevDisplay });
  });
}

function initPrintSelectSnapshot() {
  window.addEventListener("beforeprint", () => {
    restoreSelectsForPrint();
    flattenSelectsForPrint();
  });
  window.addEventListener("afterprint", () => {
    restoreSelectsForPrint();
  });
}

function applyPrintViewVisibility(mode) {
  const bundleRoot = document.getElementById("printFullReportRoot");
  const vz = document.getElementById("view-zavuch");
  const vt = document.getElementById("view-teacher");
  const va = document.getElementById("view-advisor");
  const setV = (el, show) => {
    if (!el) return;
    if (show) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
  };
  if (mode === "full") {
    if (bundleRoot) {
      bundleRoot.hidden = false;
      bundleRoot.removeAttribute("aria-hidden");
    }
    setV(vz, false);
    setV(vt, false);
    setV(va, false);
    return;
  }
  if (bundleRoot) {
    bundleRoot.hidden = true;
    bundleRoot.setAttribute("aria-hidden", "true");
  }
  if (
    mode === "zavuch-stats" ||
    mode === "zavuch-teacher" ||
    mode === "zavuch-class" ||
    mode === "zavuch-all" ||
    mode === "advisors"
  ) {
    setV(vz, true);
    setV(vt, false);
    setV(va, false);
  } else if (mode === "subject") {
    setV(vz, false);
    setV(vt, true);
    setV(va, false);
  } else if (mode === "class") {
    setV(vz, false);
    setV(vt, false);
    setV(va, true);
  }
}

function startPrint(requestedMode) {
  if (printAfterFallbackTimer) {
    clearTimeout(printAfterFallbackTimer);
    printAfterFallbackTimer = null;
  }
  const mode =
    requestedMode === "current-view" ? resolveCurrentViewPrintMode() : requestedMode;
  const dateEl = document.getElementById("printDateLine");
  if (dateEl) {
    dateEl.textContent = `Сформировано: ${new Date().toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" })}`;
    dateEl.setAttribute("aria-hidden", "false");
  }
  if (mode === "full") {
    buildFullReportBundle();
  } else {
    const br = document.getElementById("printFullReportRoot");
    if (br) {
      br.innerHTML = "";
    }
  }
  applyPrintViewVisibility(mode);
  document.body.setAttribute("data-print-mode", mode);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    restoreSelectsForPrint();
    document.body.removeAttribute("data-print-mode");
    if (dateEl) {
      dateEl.setAttribute("aria-hidden", "true");
      dateEl.textContent = "";
    }
    const br = document.getElementById("printFullReportRoot");
    if (br) {
      br.innerHTML = "";
      br.hidden = true;
      br.setAttribute("aria-hidden", "true");
    }
    applyRoute();
  };
  const onAfterPrint = () => {
    if (printAfterFallbackTimer) {
      clearTimeout(printAfterFallbackTimer);
      printAfterFallbackTimer = null;
    }
    finish();
  };
  window.addEventListener("afterprint", onAfterPrint, { once: true });
  printAfterFallbackTimer = setTimeout(finish, 2000);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        window.print();
      } catch {
        finish();
      }
    });
  });
}

function initPrint() {
  const mainBtn = document.getElementById("printCurrentViewBtn");
  if (mainBtn) {
    mainBtn.addEventListener("click", () => startPrint("current-view"));
  }
  document.querySelectorAll("[data-print]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const m = el.getAttribute("data-print");
      if (m) startPrint(m);
    });
  });
}

function setActiveView(name) {
  if (!VIEWS.includes(name)) return;
  document.querySelectorAll(".view").forEach((viewEl) => {
    const isMatch = viewEl.id === `view-${name}`;
    viewEl.classList.toggle("view--active", isMatch);
    viewEl.toggleAttribute("hidden", !isMatch);
  });
  if (name === "teacher") renderSubjectTable();
  if (name === "advisor") renderClassTable();
}

function subjectStatHasData(stat) {
  return [
    stat.performed,
    stat.confirmed,
    stat.grade5,
    stat.grade4,
    stat.grade3,
    stat.grade2,
    stat.absent,
  ].some((n) => Number(n) > 0);
}

function renderZavuchStats() {
  if (!els.zavuchStats) return;
  const hasStudents = Object.keys(state.studentsByClass).length > 0;
  const hasAssignments = state.subjectAssignments.length > 0;
  if (!hasStudents && !hasAssignments) {
    els.zavuchStats.innerHTML = '<p class="empty-hint">Пока нет данных для сводки.</p>';
    return;
  }

  const teachers = Array.from(new Set(state.subjectAssignments.map((x) => x.teacher))).sort(collatorCompare);
  const teacherStats = teachers.map((teacher) => {
    const rows = state.subjectAssignments.filter((x) => x.teacher === teacher);
    const total = rows.length;
    let filled = 0;
    for (const r of rows) {
      const s = readSubjectStat(r.teacher, r.className, r.subject);
      if (subjectStatHasData(s)) filled += 1;
    }
    const pct = total ? Math.round((filled / total) * 100) : 0;
    return { teacher, total, filled, pct };
  });

  let subjPairTotal = 0;
  let subjPairFilled = 0;
  for (const t of teacherStats) {
    subjPairTotal += t.total;
    subjPairFilled += t.filled;
  }
  const subjShare = subjPairTotal ? Math.round((subjPairFilled / subjPairTotal) * 100) : 0;

  const classNames = Object.keys(state.studentsByClass).sort(collatorCompare);
  const classStats = classNames.map((className) => {
    const advisor = state.classAdvisors[className] ? String(state.classAdvisors[className]) : "";
    const students = state.studentsByClass[className] || [];
    const subjects = Array.from(
      new Set(
        state.subjectAssignments.filter((x) => x.className === className).map((x) => x.subject),
      ),
    ).sort(collatorCompare);
    const totalCells = students.length * subjects.length;
    let filledCells = 0;
    for (const st of students) {
      for (const subj of subjects) {
        if (getClassGrade(className, st, subj)) filledCells += 1;
      }
    }
    const pct = totalCells ? Math.round((filledCells / totalCells) * 100) : null;
    return {
      className,
      advisorLabel: advisor || "—",
      totalCells,
      filledCells,
      pct,
    };
  });

  let gradeTotalCells = 0;
  let gradeFilledCells = 0;
  for (const c of classStats) {
    gradeTotalCells += c.totalCells;
    gradeFilledCells += c.filledCells;
  }
  const gradeShare = gradeTotalCells ? Math.round((gradeFilledCells / gradeTotalCells) * 100) : 0;

  const teacherTbody = teacherStats
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.teacher)}</td>
        <td class="num">${row.total}</td>
        <td class="num">${row.filled}</td>
        <td>
          <span class="progress-wrap" title="${row.filled} из ${row.total}">
            <span class="progress-bar" style="--p:${row.pct}%"></span>
            <span class="progress-text">${row.pct}%</span>
          </span>
        </td>
      </tr>`,
    )
    .join("");

  const classTbody = classStats
    .map((row) => {
      const pctText = row.pct === null || row.totalCells === 0 ? "—" : `${row.pct}%`;
      const p = row.pct === null || row.totalCells === 0 ? 0 : row.pct;
      return `
      <tr>
        <td><strong>${escapeHtml(row.className)}</strong></td>
        <td>${escapeHtml(row.advisorLabel)}</td>
        <td class="num">${row.totalCells}</td>
        <td class="num">${row.filledCells}</td>
        <td>
          <span class="progress-wrap" title="${row.filledCells} из ${row.totalCells}">
            <span class="progress-bar" style="--p:${p}%"></span>
            <span class="progress-text">${pctText}</span>
          </span>
        </td>
      </tr>`;
    })
    .join("");

  els.zavuchStats.innerHTML = `
    <div class="kpi-row zavuch-print-kpi">
      <div class="kpi-card">
        <div class="kpi-label">Строки нагрузки (заполнено / всего)</div>
        <div class="kpi-value">${subjPairFilled} <span class="kpi-denom">/ ${subjPairTotal}</span></div>
        <div class="kpi-foot">доля заполненных ${subjShare}%</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Ячейки оценок в журнале классного руководителя</div>
        <div class="kpi-value">${gradeFilledCells} <span class="kpi-denom">/ ${gradeTotalCells}</span></div>
        <div class="kpi-foot">доля заполненных ${gradeShare}%</div>
      </div>
    </div>
    <div class="stats-block zavuch-print-teacher" id="zavuchPrintByTeacher">
      <h3 class="stats-heading">Преподаватели: заполненность по строкам нагрузки</h3>
      <div class="table-wrap table-wrap--rounded">
        <table class="data-table data-table--compact data-table--full-headers">
          <thead>
            <tr>
              <th>ФИО преподавателя (предметника)</th>
              <th>Всего строк нагрузки</th>
              <th>Строк с введёнными данными</th>
              <th>Доля заполненных, %</th>
            </tr>
          </thead>
          <tbody>${teacherTbody || '<tr><td colspan="4" class="empty-cell">Нет нагрузки. Загрузите XML предметов.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="stats-block zavuch-print-class" id="zavuchPrintByClass">
      <h3 class="stats-heading">Классы: заполненность оценок у классного руководителя</h3>
      <div class="table-wrap table-wrap--rounded">
        <table class="data-table data-table--compact data-table--full-headers">
          <thead>
            <tr>
              <th>Класс</th>
              <th>ФИО классного руководителя</th>
              <th>Всего ячеек (ученик × предмет)</th>
              <th>Заполнено оценками</th>
              <th>Доля заполненных, %</th>
            </tr>
          </thead>
          <tbody>${
            classTbody || '<tr><td colspan="5" class="empty-cell">Нет списка классов. Загрузите XML учеников.</td></tr>'
          }</tbody>
        </table>
      </div>
    </div>
  `;
}

function bindEvents() {
  els.studentsFile.addEventListener("change", handleStudentsFile);
  els.subjectsFile.addEventListener("change", handleSubjectsFile);
  els.teacherSelect.addEventListener("change", renderSubjectTable);
  els.addAdvisorBtn.addEventListener("click", () => addAdvisorRow("", ""));
  els.saveAdvisorsBtn.addEventListener("click", saveAdvisorsFromTable);
  els.journalClassSelect.addEventListener("change", renderClassTable);
  els.exportBtn.addEventListener("click", exportJsonBackup);
  els.importJsonFile.addEventListener("change", importJsonBackup);
}

async function handleStudentsFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const xmlText = await file.text();
    const rows = parseExcelXmlRows(xmlText);
    state.studentsByClass = buildStudentsByClass(rows);
    updateImportStatus();
    savePersisted();
    renderAll();
  } catch (error) {
    setStatus(`Ошибка загрузки списка учеников: ${error.message}`, "warn");
  }
}

async function handleSubjectsFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const xmlText = await file.text();
    const rows = parseExcelXmlRows(xmlText);
    state.subjectAssignments = buildSubjectAssignments(rows);
    updateImportStatus();
    savePersisted();
    renderAll();
  } catch (error) {
    setStatus(`Ошибка загрузки нагрузки предметов: ${error.message}`, "warn");
  }
}

function parseExcelXmlRows(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "text/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) {
    throw new Error("файл не является корректным XML");
  }

  const rowNodes = Array.from(xml.getElementsByTagName("Row"));
  return rowNodes
    .map((rowNode) => rowToArray(rowNode))
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""));
}

function rowToArray(rowNode) {
  const cells = Array.from(rowNode.getElementsByTagName("Cell"));
  const result = [];
  let currentIndex = 0;

  for (const cell of cells) {
    const rawIndex = cell.getAttribute("ss:Index");
    if (rawIndex) {
      const excelIndex = Number(rawIndex);
      if (Number.isFinite(excelIndex) && excelIndex > 0) {
        currentIndex = excelIndex - 1;
      }
    }
    const data = cell.getElementsByTagName("Data")[0];
    result[currentIndex] = data ? data.textContent?.trim() || "" : "";
    currentIndex += 1;
  }
  return result;
}

function buildStudentsByClass(rows) {
  const header = normalizeHeaderRow(rows[0] || []);
  const classIndex = findColumnIndex(header, ["класс"]);
  const studentIndex = findColumnIndex(header, ["фио ребенка", "фио ученика", "ученик"]);
  if (classIndex < 0 || studentIndex < 0) {
    throw new Error("не найдено: столбцы 'Класс' и 'ФИО ребенка'");
  }

  const result = {};
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const className = normalizeClassName(row[classIndex]);
    const studentName = normalizePersonName(row[studentIndex]);
    if (!className || !studentName) continue;
    if (!result[className]) result[className] = [];
    result[className].push(studentName);
  }

  Object.keys(result).forEach((className) => {
    result[className] = Array.from(new Set(result[className])).sort(collatorCompare);
  });
  return result;
}

function buildSubjectAssignments(rows) {
  const header = normalizeHeaderRow(rows[0] || []);
  const classIndex = findColumnIndex(header, ["класс"]);
  const subjectIndex = findColumnIndex(header, ["предмет"]);
  const teacherIndex = findColumnIndex(header, ["учитель"]);
  if (classIndex < 0 || subjectIndex < 0 || teacherIndex < 0) {
    throw new Error("не найдено: столбцы 'Класс', 'Предмет', 'Учитель'");
  }

  const assignments = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const className = normalizeClassName(row[classIndex]);
    const subject = normalizeSubject(row[subjectIndex]);
    const teacher = normalizePersonName(row[teacherIndex]);
    if (!className || !subject || !teacher) continue;
    assignments.push({ className, subject, teacher });
  }

  const uniqueByKey = {};
  for (const item of assignments) {
    const key = `${item.teacher}__${item.className}__${item.subject}`;
    uniqueByKey[key] = item;
  }
  return Object.values(uniqueByKey).sort((a, b) => {
    if (a.teacher !== b.teacher) return collatorCompare(a.teacher, b.teacher);
    if (a.className !== b.className) return collatorCompare(a.className, b.className);
    return collatorCompare(a.subject, b.subject);
  });
}

function normalizeHeaderRow(row) {
  return row.map((x) =>
    String(x || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function findColumnIndex(header, possibleNames) {
  return header.findIndex((colName) =>
    possibleNames.some((name) => colName.includes(name.toLowerCase())),
  );
}

function collapseClassParallelSuffix(upper) {
  if (!upper) return upper;
  const m = upper.match(/^(\d{1,2}[A-ZА-ЯЁIІЇ])([A-ZА-ЯЁIІЇ0-9]+)?$/u);
  if (!m) return upper;
  if (!m[2]) return m[1];
  if (/^\d+$/.test(m[2])) return upper;
  if (CLASS_SUBGROUP_EXTRA.has(m[2])) return m[1];
  return upper;
}

function normalizeClassName(value) {
  const s = String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim();
  return collapseClassParallelSuffix(s);
}

function normalizePersonName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeSubject(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * В журнале: «язык» / «язык2» / «… 2» в одну колонку. «12» в конце (№12) не трогаем.
 * На экране преподавателя (нагрузка) полные названия.
 */
function normalizeSubjectForJournal(subject) {
  let s = normalizeSubject(subject);
  if (!s) return s;
  s = s.replace(/\s+(?:1|2)\s*$/u, "");
  s = s.trim();
  for (const num of [2, 1]) {
    if (s.length < 2) break;
    if (s.at(-1) !== String(num)) continue;
    if (/\d/.test(s.at(-2))) continue;
    s = s.slice(0, -1).trim();
  }
  return s;
}

function collatorCompare(a, b) {
  return String(a).localeCompare(String(b), "ru");
}

function updateImportStatus() {
  const classesCount = Object.keys(state.studentsByClass).length;
  const studentsCount = Object.values(state.studentsByClass).reduce((sum, arr) => sum + arr.length, 0);
  const linksCount = state.subjectAssignments.length;
  if (!classesCount && !linksCount) {
    setStatus("Файлы пока не загружены.", "muted");
    return;
  }

  const msg =
    `Загружено классов: ${classesCount}, учеников: ${studentsCount}, связей класс-предмет-учитель: ${linksCount}.`;
  setStatus(msg, "ok");
}

function setStatus(text, type) {
  els.importStatus.className = `status status-${type}`;
  els.importStatus.textContent = text;
}

function renderAll() {
  renderZavuchStats();
  renderTeachersSelect();
  renderAdvisorsEditor();
  renderJournalClassSelect();
  renderSubjectTable();
  renderClassTable();
}

function renderTeachersSelect() {
  const current = els.teacherSelect.value;
  const teachers = Array.from(new Set(state.subjectAssignments.map((x) => x.teacher))).sort(collatorCompare);
  els.teacherSelect.innerHTML = "";
  els.teacherSelect.appendChild(new Option("Выберите учителя", ""));
  for (const teacher of teachers) {
    els.teacherSelect.appendChild(new Option(teacher, teacher));
  }
  if (teachers.includes(current)) {
    els.teacherSelect.value = current;
  }
}

function getStatKey(teacher, className, subject) {
  return `${teacher}__${className}__${subject}`;
}

const EMPTY_SUBJECT_STAT = {
  performed: 0,
  confirmed: 0,
  grade5: 0,
  grade4: 0,
  grade3: 0,
  grade2: 0,
  absent: 0,
};

function legacySumGrades(s) {
  return (s.grade5 || 0) + (s.grade4 || 0) + (s.grade3 || 0) + (s.grade2 || 0);
}

function migratePerformedField(s) {
  if (typeof s.performed === "number" && !Number.isNaN(s.performed)) {
    return;
  }
  s.performed = legacySumGrades(s);
}

function parseStatsKey(k) {
  const parts = k.split("__");
  if (parts.length < 3) return null;
  const subject = parts.pop();
  const className = parts.pop();
  const teacher = parts.join("__");
  return { teacher, className, subject };
}

function parseClassGradeKey(k) {
  const parts = k.split("__");
  if (parts.length < 3) return null;
  const subject = parts.pop();
  const student = parts.pop();
  const className = parts.join("__");
  return { className, student, subject };
}

function mergeStatRecord(into, add) {
  for (const k of Object.keys(EMPTY_SUBJECT_STAT)) {
    into[k] = (Number(into[k]) || 0) + (Number(add[k]) || 0);
  }
  migratePerformedField(into);
}

/**
 * Схлопывание устаревших имён классов/подгрупп и ключей оценок журнала после правил normalize* .
 */
function rekeyCanonicalState() {
  const ns = {};
  for (const [cl, list] of Object.entries(state.studentsByClass)) {
    const c = normalizeClassName(cl);
    if (!ns[c]) ns[c] = [];
    for (const st of list || []) {
      if (st) ns[c].push(st);
    }
  }
  for (const c of Object.keys(ns)) {
    ns[c] = Array.from(new Set(ns[c])).sort(collatorCompare);
  }
  state.studentsByClass = ns;

  const saSeen = new Set();
  const sa = [];
  for (const a of state.subjectAssignments) {
    const row = { ...a, className: normalizeClassName(a.className) };
    const u = `${row.teacher}__${row.className}__${row.subject}`;
    if (saSeen.has(u)) continue;
    saSeen.add(u);
    sa.push(row);
  }
  sa.sort((a, b) => {
    if (a.teacher !== b.teacher) return collatorCompare(a.teacher, b.teacher);
    if (a.className !== b.className) return collatorCompare(a.className, b.className);
    return collatorCompare(a.subject, b.subject);
  });
  state.subjectAssignments = sa;

  const adv = {};
  for (const [c, n] of Object.entries(state.classAdvisors)) {
    adv[normalizeClassName(c)] = n;
  }
  state.classAdvisors = adv;

  const nstats = {};
  for (const [k, v] of Object.entries(state.subjectStats)) {
    if (!v || typeof v !== "object") {
      nstats[k] = v;
      continue;
    }
    const p = parseStatsKey(k);
    if (!p) {
      nstats[k] = { ...v };
      migratePerformedField(nstats[k]);
      continue;
    }
    const nk = getStatKey(p.teacher, normalizeClassName(p.className), p.subject);
    if (nstats[nk]) {
      mergeStatRecord(nstats[nk], v);
    } else {
      nstats[nk] = { ...EMPTY_SUBJECT_STAT, ...v };
      migratePerformedField(nstats[nk]);
    }
  }
  state.subjectStats = nstats;

  const ng = {};
  for (const k of Object.keys(state.classGrades)) {
    const v = state.classGrades[k];
    const p = parseClassGradeKey(k);
    if (!p) {
      if (v) ng[k] = v;
      continue;
    }
    const nk = classGradeKey(p.className, p.student, p.subject);
    if (v) {
      ng[nk] = v;
    } else if (!(nk in ng)) {
      ng[nk] = "";
    }
  }
  for (const k of Object.keys(ng)) {
    if (ng[k] === "" || ng[k] == null) {
      delete ng[k];
    }
  }
  state.classGrades = ng;
}

function readSubjectStat(teacher, className, subject) {
  const key = getStatKey(teacher, className, subject);
  const raw = state.subjectStats[key];
  if (!raw) {
    return { ...EMPTY_SUBJECT_STAT };
  }
  const out = { ...EMPTY_SUBJECT_STAT, ...raw };
  if (typeof out.performed !== "number" || Number.isNaN(out.performed)) {
    out.performed = legacySumGrades(out);
  }
  return out;
}

function getSubjectStat(teacher, className, subject) {
  const key = getStatKey(teacher, className, subject);
  if (!state.subjectStats[key]) {
    state.subjectStats[key] = { ...EMPTY_SUBJECT_STAT };
  }
  const s = state.subjectStats[key];
  migratePerformedField(s);
  return s;
}

function renderSubjectTable() {
  const teacher = els.teacherSelect.value;
  els.subjectTableBody.innerHTML = "";
  els.confirmedTotal.textContent = "0";
  if (!teacher) return;

  const rows = state.subjectAssignments.filter((x) => x.teacher === teacher);
  let confirmedTotal = 0;

  for (const row of rows) {
    const stat = getSubjectStat(row.teacher, row.className, row.subject);
    const classSize = (state.studentsByClass[row.className] || []).length;
    const performed = stat.performed;
    const confirmedShare = performed > 0 ? ((stat.confirmed / performed) * 100).toFixed(1) : "0.0";
    const quality = performed > 0 ? (((stat.grade5 + stat.grade4) / performed) * 100).toFixed(1) : "0.0";
    confirmedTotal += stat.confirmed;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.className)}</td>
      <td>${escapeHtml(row.subject)}</td>
      <td class="cell-readonly">${classSize}</td>
      <td>${numberInputCell(stat.performed, "performed")}</td>
      <td>${numberInputCell(stat.confirmed, "confirmed")}</td>
      <td class="cell-readonly">${confirmedShare}</td>
      <td>${numberInputCell(stat.grade5, "grade5")}</td>
      <td>${numberInputCell(stat.grade4, "grade4")}</td>
      <td>${numberInputCell(stat.grade3, "grade3")}</td>
      <td>${numberInputCell(stat.grade2, "grade2")}</td>
      <td>${numberInputCell(stat.absent, "absent")}</td>
      <td class="cell-readonly">${quality}</td>
    `;
    bindSubjectRowEvents(tr, row.teacher, row.className, row.subject, classSize);
    els.subjectTableBody.appendChild(tr);
  }

  els.confirmedTotal.textContent = String(confirmedTotal);
}

function numberInputCell(value, fieldName) {
  return `<input class="cell-number" type="number" min="0" step="1" value="${value}" data-field="${fieldName}" />`;
}

function bindSubjectRowEvents(tr, teacher, className, subject, classSize) {
  const key = getStatKey(teacher, className, subject);
  const inputs = tr.querySelectorAll("input[type='number']");
  const highlight = () => {
    const s = state.subjectStats[key];
    const sumG = (s.grade5 || 0) + (s.grade4 || 0) + (s.grade3 || 0) + (s.grade2 || 0);
    const overClass = (s.performed || 0) + (s.absent || 0) > classSize;
    const overPerformed = sumG > (s.performed || 0);
    tr.querySelectorAll("input[type='number']").forEach((el) => {
      const f = el.dataset.field;
      el.classList.remove("danger");
      if (f === "performed" && (overClass || overPerformed)) {
        el.classList.add("danger");
      } else if (f === "absent" && overClass) {
        el.classList.add("danger");
      } else if ((f === "grade2" || f === "grade3" || f === "grade4" || f === "grade5") && overPerformed) {
        el.classList.add("danger");
      }
    });
  };
  highlight();
  inputs.forEach((input) => {
    input.addEventListener("change", (event) => {
      const field = event.target.dataset.field;
      if (!field) return;
      const rawValue = Number.parseInt(event.target.value || "0", 10);
      const value = Number.isFinite(rawValue) && rawValue >= 0 ? rawValue : 0;
      event.target.value = String(value);
      state.subjectStats[key][field] = value;
      savePersisted();
      renderSubjectTable();
    });
  });
}

function listClassesFromData() {
  return Object.keys(state.studentsByClass).sort(collatorCompare);
}

function classSelectOptionsHtml(selectedRaw) {
  const classNames = listClassesFromData();
  const selected = selectedRaw ? normalizeClassName(selectedRaw) : "";
  const inList = selected && classNames.includes(selected);
  const orphan = selected && !inList;
  const parts = ['<option value="">— Выберите класс —</option>'];
  for (const c of classNames) {
    const isSel = selected && normalizeClassName(c) === selected;
    parts.push(`<option value="${escapeAttr(c)}"${isSel ? " selected" : ""}>${escapeHtml(c)}</option>`);
  }
  if (orphan) {
    parts.push(`<option value="${escapeAttr(selected)}" selected>${escapeHtml(selected)}</option>`);
  }
  return parts.join("");
}

function renderAdvisorsEditor() {
  const existingRows = Object.entries(state.classAdvisors).sort((a, b) => collatorCompare(a[0], b[0]));
  els.advisorsTableBody.innerHTML = "";
  if (!existingRows.length) {
    const classes = listClassesFromData();
    for (const className of classes) {
      addAdvisorRow(className, "");
    }
    return;
  }
  for (const [className, advisorName] of existingRows) {
    addAdvisorRow(className, advisorName);
  }
}

function addAdvisorRow(className, advisorName) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>
      <select class="input-control" data-col="class">${classSelectOptionsHtml(className)}</select>
    </td>
    <td>
      <input
        class="input-control"
        type="text"
        data-col="advisor"
        value="${escapeAttr(advisorName)}"
        placeholder="Введите ФИО"
        spellcheck="false"
      />
    </td>
    <td class="print-col-hide"><button type="button" class="btn btn--ghost btn--small" data-action="remove">Удалить</button></td>
  `;
  tr.querySelector("[data-action='remove']").addEventListener("click", () => {
    tr.remove();
  });
  els.advisorsTableBody.appendChild(tr);
}

function saveAdvisorsFromTable() {
  const rows = Array.from(els.advisorsTableBody.querySelectorAll("tr"));
  const map = {};

  for (const row of rows) {
    const classEl = row.querySelector("[data-col='class']");
    if (!classEl) continue;
    const className = normalizeClassName(classEl.value);
    const advisor = normalizePersonName(row.querySelector("[data-col='advisor']")?.value);
    if (!className || !advisor) continue;
    map[className] = advisor;
  }

  state.classAdvisors = map;
  savePersisted();
  renderJournalClassSelect();
  renderClassTable();
}

function renderJournalClassSelect() {
  if (!els.journalClassSelect) return;
  const current = normalizeClassName(els.journalClassSelect.value) || "";
  const classNames = listClassesFromData();
  els.journalClassSelect.innerHTML = "";
  els.journalClassSelect.appendChild(
    new Option("— Загрузите XML учеников, затем выберите класс —", ""),
  );
  for (const c of classNames) {
    els.journalClassSelect.appendChild(new Option(c, c));
  }
  if (current) {
    const has = classNames.some((c) => normalizeClassName(c) === current);
    if (has) {
      const match = classNames.find((c) => normalizeClassName(c) === current);
      if (match) {
        els.journalClassSelect.value = match;
      }
    } else {
      els.journalClassSelect.appendChild(new Option(`Сохр.: ${current}`, current));
      els.journalClassSelect.value = current;
    }
  }
}

function renderClassTable() {
  const className = els.journalClassSelect
    ? normalizeClassName(els.journalClassSelect.value) || ""
    : "";
  els.classTableHead.innerHTML = "";
  els.classTableBody.innerHTML = "";

  if (!className) {
    els.advisorInfo.className = "status status-muted";
    els.advisorInfo.textContent = "Класс не выбран.";
    return;
  }

  const students = state.studentsByClass[className] || [];
  const subjects = Array.from(
    new Set(
      state.subjectAssignments
        .filter((x) => normalizeClassName(x.className) === className)
        .map((x) => normalizeSubjectForJournal(x.subject)),
    ),
  ).sort(collatorCompare);

  els.advisorInfo.className = "status status-ok";
  const advisor = state.classAdvisors[className];
  const advisorText = advisor ? ` Классный: ${advisor}.` : "";
  els.advisorInfo.textContent =
    `Класс: ${className}. Учеников: ${students.length}. Предметов (по нагрузке): ${subjects.length}.${advisorText}`;

  const headerTr = document.createElement("tr");
  headerTr.innerHTML = `<th>ФИО ученика</th>${subjects.map((s) => `<th>${escapeHtml(s)}</th>`).join("")}`;
  els.classTableHead.appendChild(headerTr);

  for (const student of students) {
    const tr = document.createElement("tr");
    const cells = [`<td>${escapeHtml(student)}</td>`];
    for (const subject of subjects) {
      const grade = getClassGrade(className, student, subject);
      const optionDefs = [
        { v: "", label: "—" },
        { v: "5", label: "5" },
        { v: "4", label: "4" },
        { v: "3", label: "3" },
        { v: "2", label: "2" },
        { v: "Н", label: "Не пришли" },
      ];
      const htmlOptions = optionDefs
        .map(
          (o) =>
            `<option value="${escapeAttr(o.v)}" ${o.v === grade ? "selected" : ""}>${escapeHtml(o.label)}</option>`,
        )
        .join("");
      cells.push(
        `<td><select data-class="${escapeAttr(className)}" data-student="${escapeAttr(student)}" data-subject="${escapeAttr(subject)}">${htmlOptions}</select></td>`,
      );
    }
    tr.innerHTML = cells.join("");
    tr.querySelectorAll("select").forEach((selectEl) => {
      selectEl.addEventListener("change", (event) => {
        const target = event.target;
        setClassGrade(target.dataset.class, target.dataset.student, target.dataset.subject, target.value);
        savePersisted();
      });
    });
    els.classTableBody.appendChild(tr);
  }
}

function classGradeKey(className, student, subject) {
  return `${normalizeClassName(className)}__${student}__${normalizeSubjectForJournal(subject)}`;
}

function getClassGrade(className, student, subject) {
  return state.classGrades[classGradeKey(className, student, subject)] || "";
}

function setClassGrade(className, student, subject, grade) {
  const key = classGradeKey(className, student, subject);
  if (!grade) {
    delete state.classGrades[key];
    return;
  }
  state.classGrades[key] = grade;
}

function journalGradeDisplay(grade) {
  const optionDefs = [
    { v: "", label: "—" },
    { v: "5", label: "5" },
    { v: "4", label: "4" },
    { v: "3", label: "3" },
    { v: "2", label: "2" },
    { v: "Н", label: "Не пришли" },
  ];
  const o = optionDefs.find((x) => x.v === grade);
  return o ? o.label : grade || "—";
}

function buildFullReportBundle() {
  const host = document.getElementById("printFullReportRoot");
  if (!host) return;
  host.innerHTML = "";

  const z = document.getElementById("printRegionZavuchStats");
  if (z) {
    const c = z.cloneNode(true);
    c.querySelectorAll(".no-print").forEach((n) => n.remove());
    const wrap = document.createElement("div");
    wrap.className = "print-full-block print-full-block--zav";
    wrap.appendChild(c);
    host.appendChild(wrap);
  }

  const a = document.getElementById("printRegionAdvisors");
  if (a) {
    const c = a.cloneNode(true);
    c.querySelectorAll(".no-print, .print-skip").forEach((n) => n.remove());
    const wrap = document.createElement("div");
    wrap.className = "print-full-block print-full-block--adv";
    wrap.appendChild(c);
    host.appendChild(wrap);
  }

  const teachers = Array.from(new Set(state.subjectAssignments.map((x) => x.teacher))).sort(collatorCompare);
  for (const teacher of teachers) {
    const wrap = document.createElement("div");
    wrap.className = "print-full-block print-full-block--teacher print-block-start";
    const h2 = document.createElement("h2");
    h2.className = "print-full-section-title";
    h2.textContent = `Ввод по предмету: ${teacher}`;
    wrap.appendChild(h2);

    const rows = state.subjectAssignments.filter((x) => x.teacher === teacher);
    let confirmedTotal = 0;
    const bodyRows = rows
      .map((row) => {
        const stat = readSubjectStat(row.teacher, row.className, row.subject);
        const classSize = (state.studentsByClass[row.className] || []).length;
        const performed = stat.performed;
        const confirmedShare = performed > 0 ? ((stat.confirmed / performed) * 100).toFixed(1) : "0.0";
        const quality = performed > 0 ? (((stat.grade5 + stat.grade4) / performed) * 100).toFixed(1) : "0.0";
        confirmedTotal += stat.confirmed;
        return `<tr>
            <td>${escapeHtml(row.className)}</td>
            <td>${escapeHtml(row.subject)}</td>
            <td class="cell-readonly">${classSize}</td>
            <td class="num">${performed}</td>
            <td class="num">${stat.confirmed}</td>
            <td class="cell-readonly">${confirmedShare}</td>
            <td class="num">${stat.grade5}</td>
            <td class="num">${stat.grade4}</td>
            <td class="num">${stat.grade3}</td>
            <td class="num">${stat.grade2}</td>
            <td class="num">${stat.absent}</td>
            <td class="cell-readonly">${quality}</td>
          </tr>`;
      })
      .join("");

    wrap.insertAdjacentHTML(
      "beforeend",
      `<div class="table-wrap table-wrap--rounded table-wrap--shadow">
        <table class="data-table data-table--tight data-table--full-headers">
          <thead>
            <tr>
              <th>Класс</th>
              <th>Предмет</th>
              <th>Количество учеников в классе</th>
              <th>Выполняли аттестацию (чел.)</th>
              <th>Подтвердили/повысили (чел.)</th>
              <th>Доля подтвердивших, %</th>
              <th>С оценкой 5 (чел.)</th>
              <th>С оценкой 4 (чел.)</th>
              <th>С оценкой 3 (чел.)</th>
              <th>С оценкой 2 (чел.)</th>
              <th>Не пришли (чел.)</th>
              <th>Процент качества, %</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="4"><strong>Итого: подтвердили/повысили, чел.</strong></td>
              <td class="num">${confirmedTotal}</td>
              <td colspan="7" aria-hidden="true"></td>
            </tr>
          </tfoot>
        </table>
      </div>`,
    );
    host.appendChild(wrap);
  }

  const classNames = listClassesFromData();
  for (const className of classNames) {
    const wrap = document.createElement("div");
    wrap.className = "print-full-block print-full-block--class print-block-start";
    const students = state.studentsByClass[className] || [];
    const subjects = Array.from(
      new Set(
        state.subjectAssignments
          .filter((x) => normalizeClassName(x.className) === className)
          .map((x) => normalizeSubjectForJournal(x.subject)),
      ),
    ).sort(collatorCompare);
    const advisor = state.classAdvisors[className];
    const advisorText = advisor ? ` Классный: ${advisor}.` : "";
    const h2 = document.createElement("h2");
    h2.className = "print-full-section-title";
    h2.textContent = `Журнал класса: ${className}`;
    wrap.appendChild(h2);
    const meta = document.createElement("p");
    meta.className = "print-full-class-meta";
    meta.textContent = `Класс: ${className}. Учеников: ${students.length}. Предметов (по нагрузке): ${subjects.length}.${advisorText}`;
    wrap.appendChild(meta);
    const thead = `<tr><th>ФИО ученика</th>${subjects.map((s) => `<th>${escapeHtml(s)}</th>`).join("")}</tr>`;
    const tbody = students
      .map((student) => {
        const tds = [`<td>${escapeHtml(student)}</td>`];
        for (const subject of subjects) {
          const g = getClassGrade(className, student, subject);
          tds.push(`<td class="num print-full-grade-cell">${escapeHtml(journalGradeDisplay(g))}</td>`);
        }
        return `<tr>${tds.join("")}</tr>`;
      })
      .join("");
    wrap.insertAdjacentHTML(
      "beforeend",
      `<div class="table-wrap table-wrap--rounded table-wrap--shadow">
        <table class="data-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>
      </div>`,
    );
    host.appendChild(wrap);
  }

  host.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function exportJsonBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attestation-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importJsonBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") {
      throw new Error("некорректный формат файла");
    }
    state.studentsByClass = data.studentsByClass || {};
    state.subjectAssignments = data.subjectAssignments || [];
    state.classAdvisors = data.classAdvisors || {};
    state.subjectStats = data.subjectStats || {};
    state.classGrades = data.classGrades || {};
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {
      console.error(e);
    }
    await flushSaveNow();
    updateImportStatus();
    renderAll();
  } catch (error) {
    setStatus(`Ошибка импорта JSON: ${error.message}`, "warn");
  } finally {
    event.target.value = "";
  }
}
