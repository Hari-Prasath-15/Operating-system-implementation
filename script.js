// ============================================================
// OS Capstone Project: Memory Management Simulator
// ============================================================

const DEFAULT_STATE = {
  isStarted: false,
  activeModule: "segmentation",
  segmentation: {
    totalRam: 1050,
    segments: [
      { id: 1, name: "copy", limit: 100, base: 700 },
      { id: 2, name: "read", limit: 250, base: 800 },
      { id: 3, name: "main", limit: 500, base: 200 },
      { id: 4, name: "display", limit: 200, base: 0 }
    ],
    logicalSeg: 1,
    logicalOffset: 50
  },
  paging: {
    totalFrames: 8,
    pageSize: 1024,
    processSize: 3584,
    pageTable: [5, 2, 7, 0],
    logicalPage: 2,
    logicalOffset: 452
  },
  segPaging: {
    totalFrames: 12,
    pageSize: 1024,
    segments: [
      { id: 1, name: "Code", limit: 20, ptName: "PT1", pageTable: [3] },
      { id: 2, name: "Data", limit: 2560, ptName: "PT2", pageTable: [4, 9, 1] }
    ],
    logicalSeg: 2,
    logicalOffset: 2200
  },
  memoryAccessTime: 100
};

let state = JSON.parse(JSON.stringify(DEFAULT_STATE));
let activeTimers = [];

function clearActiveTimers() {
  activeTimers.forEach((t) => clearTimeout(t));
  activeTimers = [];
}

// Re-number segments sequentially starting from S1 (S1, S2, S3...)
function reindexSegments(segArray) {
  segArray.forEach((seg, index) => {
    seg.id = index + 1;
  });
}

const tabButtons = document.querySelectorAll(".tab-btn");
const simulatorLayout = document.getElementById("simulator-layout");
const performanceLayout = document.getElementById("performance-layout");
const inputCard = document.getElementById("input-card");
const translationCard = document.getElementById("translation-card");
const memoryCanvas = document.getElementById("memory-canvas");
const memStartLabel = document.getElementById("mem-start-label");
const memSummaryLabel = document.getElementById("mem-summary-label");
const tableTitle = document.getElementById("table-title");
const tableContainer = document.getElementById("table-container");
const translationSteps = document.getElementById("translation-steps");
const systemLogs = document.getElementById("system-logs");

function addLog(message, type = "info") {
  const now = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.className = `log-entry ${type === "error" ? "log-err" : type === "success" ? "log-ok" : ""}`;
  entry.innerHTML = `<span class="log-time">[${now}]</span>${message}`;
  systemLogs.prepend(entry);
}

// ============================================================
// 1. MODULE 1: SEGMENTATION (Sequential S1..Sn, Bounds Check, 1.2s Delay)
// ============================================================
function renderSegmentationInputs() {
  reindexSegments(state.segmentation.segments);
  const segs = state.segmentation.segments;
  if (!segs.some((s) => s.id === state.segmentation.logicalSeg)) {
    state.segmentation.logicalSeg = segs[0].id;
  }

  inputCard.innerHTML = `
    <div class="card-header">
      <h2>🧩 Segments Configuration</h2>
      <span class="badge">${segs.length} segments</span>
    </div>
    <div class="form-group">
      <label>Total Physical RAM (Bytes)</label>
      <input type="number" id="seg-total-ram" value="${state.segmentation.totalRam}" min="100" step="50" />
    </div>
    <div class="form-group">
      <label>Add Segment (Name / Limit / Base)</label>
      <div class="input-row">
        <input type="text" id="new-seg-name" placeholder="Name" value="Heap" />
        <input type="number" id="new-seg-limit" placeholder="Limit" value="400" />
        <input type="number" id="new-seg-base" placeholder="Base" value="9000" />
        <button class="add-btn" id="btn-add-seg" title="Add Segment">+</button>
      </div>
    </div>
    <div class="queue-list">
      ${segs
        .map(
          (s, idx) => `
        <div class="queue-item">
          <div class="item-left">
            <span class="status-dot"></span>
            <strong>S${s.id} (${s.name})</strong>
          </div>
          <span>Limit: ${s.limit} | Base: ${s.base}</span>
          <button class="delete-btn" onclick="deleteSegment(${idx})" title="Remove">🗑</button>
        </div>`
        )
        .join("")}
    </div>
  `;

  translationCard.innerHTML = `
    <div class="card-header">
      <h2>🎯 Logical Address (S, d)</h2>
    </div>
    <div class="input-row">
      <div class="form-group" style="flex:1;">
        <label>Segment Number (S)</label>
        <select id="seg-input-s">
          ${segs
            .map(
              (s) =>
                `<option value="${s.id}" ${s.id === state.segmentation.logicalSeg ? "selected" : ""}>S${s.id} - ${s.name}</option>`
            )
            .join("")}
        </select>
      </div>
      <div class="form-group" style="flex:1;">
        <label>Offset (d in Bytes)</label>
        <input type="number" id="seg-input-d" value="${state.segmentation.logicalOffset}" min="0" />
      </div>
    </div>
    <div class="form-group" style="margin-bottom:0;">
      <label>Quick Test Cases</label>
      <div class="input-row">
        <button class="btn-mini" onclick="setSegTest(1, 50)">(S1, 50) Valid</button>
        <button class="btn-mini" onclick="setSegTest(3, 250)">(S3, 250) Valid</button>
        <button class="btn-mini" onclick="setSegTest(1, 250)">(S1, 250) Trap</button>
      </div>
    </div>
  `;

  document.getElementById("seg-total-ram").addEventListener("change", (e) => {
    clearActiveTimers();
    state.segmentation.totalRam = Math.max(100, parseInt(e.target.value) || 1050);
    state.isStarted = false;
    runSegmentation(false);
  });

  document.getElementById("btn-add-seg").addEventListener("click", () => {
    clearActiveTimers();
    const name = document.getElementById("new-seg-name").value.trim() || "Extra";
    const limit = Math.max(1, parseInt(document.getElementById("new-seg-limit").value) || 100);
    const base = Math.max(0, parseInt(document.getElementById("new-seg-base").value) || 0);
    state.segmentation.segments.push({ id: 0, name, limit, base });
    reindexSegments(state.segmentation.segments);
    const added = state.segmentation.segments[state.segmentation.segments.length - 1];
    state.isStarted = false;
    addLog(`Queued Segment S${added.id} (${name}) — Limit ${limit}, Base ${base}. Press Start to allocate.`);
    renderSegmentationInputs();
    runSegmentation(false);
  });

  document.getElementById("seg-input-s").addEventListener("change", (e) => {
    clearActiveTimers();
    state.segmentation.logicalSeg = parseInt(e.target.value);
    state.isStarted = false;
    runSegmentation(false);
  });

  document.getElementById("seg-input-d").addEventListener("input", (e) => {
    clearActiveTimers();
    state.segmentation.logicalOffset = parseInt(e.target.value) || 0;
    state.isStarted = false;
    runSegmentation(false);
  });
}

window.deleteSegment = function (idx) {
  if (state.segmentation.segments.length <= 1) {
    addLog("At least one segment must remain.", "error");
    return;
  }
  clearActiveTimers();
  const removed = state.segmentation.segments.splice(idx, 1)[0];
  reindexSegments(state.segmentation.segments);
  state.segmentation.logicalSeg = state.segmentation.segments[0].id;
  state.isStarted = false;
  addLog(`Removed segment (${removed.name}). Remaining segments re-indexed from S1.`);
  renderSegmentationInputs();
  runSegmentation(false);
};

window.setSegTest = function (s, d) {
  clearActiveTimers();
  const targetExists = state.segmentation.segments.some((seg) => seg.id === s);
  state.segmentation.logicalSeg = targetExists ? s : state.segmentation.segments[0].id;
  state.segmentation.logicalOffset = d;
  state.isStarted = false;
  renderSegmentationInputs();
  runSegmentation(false);
  addLog(`Selected test address (S${state.segmentation.logicalSeg}, ${d}). Click Start to allocate.`);
};

// Evaluate which segments fit in Total Physical RAM without exceeding RAM bounds or overlapping
function evaluateSegmentAllocations(totalRam, segments) {
  const allocated = [];
  const rejected = [];
  const occupiedIntervals = [];
  let usedBytes = 0;

  segments.forEach((seg) => {
    const segStart = seg.base;
    const segEnd = seg.base + seg.limit - 1;
    const fitsInRam = segStart >= 0 && seg.base + seg.limit <= totalRam && usedBytes + seg.limit <= totalRam;
    const overlapsExisting = occupiedIntervals.some(
      (iv) => !(segEnd < iv.start || segStart > iv.end)
    );

    if (fitsInRam && !overlapsExisting) {
      allocated.push(seg);
      occupiedIntervals.push({ start: segStart, end: segEnd });
      usedBytes += seg.limit;
    } else {
      rejected.push({
        seg,
        reason: !fitsInRam
          ? `Insufficient RAM space (requires ${seg.base}–${segEnd}, Total RAM is ${totalRam} B)`
          : `Overlaps existing allocated memory range`
      });
    }
  });

  return { allocated, rejected, usedBytes };
}

function buildMemoryBlocks(totalRam, allocatedSegments) {
  const sorted = [...allocatedSegments].sort((a, b) => a.base - b.base);
  let cursor = 0;
  const blocks = [];

  sorted.forEach((seg) => {
    if (seg.base > cursor) {
      blocks.push({
        type: "free",
        start: cursor,
        end: seg.base - 1,
        size: seg.base - cursor,
        label: "Free Hole"
      });
    }
    blocks.push({
      type: "allocated",
      segId: seg.id,
      start: seg.base,
      end: seg.base + seg.limit - 1,
      size: seg.limit,
      label: `S${seg.id}: ${seg.name}`
    });
    cursor = Math.max(cursor, seg.base + seg.limit);
  });

  if (cursor < totalRam) {
    blocks.push({
      type: "free",
      start: cursor,
      end: totalRam - 1,
      size: totalRam - cursor,
      label: "Free Space"
    });
  }

  return blocks;
}

function runSegmentation(animate = false) {
  clearActiveTimers();
  reindexSegments(state.segmentation.segments);
  const { totalRam, segments, logicalSeg, logicalOffset } = state.segmentation;

  // Before Start: Idle empty memory visualization
  if (!state.isStarted) {
    memoryCanvas.innerHTML = `
      <div class="mem-block" style="flex-grow:1;">
        <span class="mem-pill">${totalRam} B</span>
        <div class="mem-mid">Free RAM (Unallocated)</div>
        <div class="mem-sub">0 – ${totalRam - 1} • Click Start to allocate segments</div>
      </div>
    `;
    memStartLabel.textContent = "0 B";
    memSummaryLabel.textContent = `Used: 0 B / Total RAM: ${totalRam} B (0.0%)`;

    tableTitle.textContent = "📋 Segment Table (Pending Start)";
    tableContainer.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Seg</th><th>Name</th><th>Limit</th><th>Base</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${segments
            .map(
              (s) => `
            <tr>
              <td><strong>S${s.id}</strong></td>
              <td>${s.name}</td>
              <td>${s.limit}</td>
              <td>${s.base}</td>
              <td>Queued</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;

    translationSteps.innerHTML = `
      <div class="step-item"><strong>System Ready:</strong> ${segments.length} segments queued (S1–S${segments.length}). Press <strong>▶ Start</strong> to allocate segments step-by-step (1.2s per segment).</div>
    `;
    return;
  }

  // After Start: Check space availability per segment and animate every 1.2 seconds
  const { allocated, rejected, usedBytes } = evaluateSegmentAllocations(totalRam, segments);
  const allocatedIds = new Set(allocated.map((s) => s.id));

  tableTitle.textContent = "📋 Segment Table";
  tableContainer.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>Seg</th><th>Name</th><th>Limit</th><th>Base</th><th>Range / Status</th></tr>
      </thead>
      <tbody>
        ${segments
          .map((s) => {
            const isAlloc = allocatedIds.has(s.id);
            const isTargetSeg = s.id === logicalSeg;
            const isValidOffset = isAlloc && logicalOffset >= 0 && logicalOffset < s.limit;
            let rowClass = "";
            if (!isAlloc) rowClass = "unallocated-row";
            else if (isTargetSeg) rowClass = isValidOffset ? "active-row" : "trap-row";

            return `
            <tr class="${rowClass}">
              <td><strong>S${s.id}</strong></td>
              <td>${s.name}</td>
              <td>${s.limit}</td>
              <td>${s.base}</td>
              <td>${isAlloc ? `${s.base} – ${s.base + s.limit - 1}` : "Not Allocated (No Space)"}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;

  // Render sequentially with 1.2s (1200ms) delay per process/segment
  const progressiveAllocated = [];
  let progressiveUsed = 0;

  // Initial empty canvas before first 1.2s tick
  memoryCanvas.innerHTML = `
    <div class="mem-block" style="flex-grow:1;">
      <span class="mem-pill">${totalRam} B</span>
      <div class="mem-mid">Allocating Processes...</div>
      <div class="mem-sub">0 – ${totalRam - 1}</div>
    </div>
  `;
  memStartLabel.textContent = "0 B";
  memSummaryLabel.textContent = `Used: 0 B / Total RAM: ${totalRam} B (0.0%)`;
  translationSteps.innerHTML = `<div class="step-item">Allocating segments sequentially (1.2s delay per process)...</div>`;

  segments.forEach((seg, idx) => {
    const delayMs = animate ? (idx + 1) * 1200 : 0;
    const timer = setTimeout(() => {
      const isAlloc = allocatedIds.has(seg.id);
      if (isAlloc) {
        progressiveAllocated.push(seg);
        progressiveUsed += seg.limit;
        addLog(`Allocated S${seg.id} (${seg.name}) [${seg.limit} B] at Base ${seg.base}.`, "success");
      } else {
        addLog(`Could not allocate S${seg.id} (${seg.name}) [${seg.limit} B at Base ${seg.base}] — insufficient free memory space.`, "error");
      }

      const blocks = buildMemoryBlocks(totalRam, progressiveAllocated);
      const isFinalStep = idx === segments.length - 1;
      const targetSeg = allocated.find((s) => s.id === logicalSeg);
      const isValid = targetSeg && logicalOffset >= 0 && logicalOffset < targetSeg.limit;

      memoryCanvas.innerHTML = blocks
        .map((b) => {
          const isTargetHighlight =
            isFinalStep && b.type === "allocated" && b.segId === logicalSeg && isValid;
          const isNewlyAdded = b.type === "allocated" && b.segId === seg.id && isAlloc;
          return `
          <div class="mem-block ${b.type === "allocated" ? "allocated" : ""} ${isTargetHighlight ? "highlight" : ""} ${isNewlyAdded ? "anim-align" : ""}" style="flex-grow:${Math.max(1, Math.round(b.size / 150))};">
            <span class="mem-pill">${b.size} B</span>
            <div class="mem-mid">${b.label}</div>
            <div class="mem-sub">${b.start} – ${b.end}</div>
          </div>`;
        })
        .join("");

      memSummaryLabel.textContent = `Used: ${progressiveUsed} B / Total RAM: ${totalRam} B (${((progressiveUsed / totalRam) * 100).toFixed(1)}%)`;

      // Once all segments finish allocating, run the address translation step
      if (isFinalStep) {
        const chosenSeg = segments.find((s) => s.id === logicalSeg);
        if (!chosenSeg || !allocatedIds.has(logicalSeg)) {
          translationSteps.innerHTML = `
            <div class="step-item error anim-step"><strong>Allocation Failed:</strong> Segment S${logicalSeg} (${chosenSeg ? chosenSeg.name : ""}) could not be allocated in RAM (insufficient space). Address translation aborted.</div>
          `;
        } else if (isValid) {
          const physicalAddr = targetSeg.base + logicalOffset;
          translationSteps.innerHTML = `
            <div class="step-item anim-step"><strong>1. Logical Address:</strong> (S = ${logicalSeg} [${targetSeg.name}], Offset d = ${logicalOffset})</div>
            <div class="step-item anim-step"><strong>2. Limit Check:</strong> ${logicalOffset} &lt; ${targetSeg.limit} ✓ (Valid Offset)</div>
            <div class="step-item success anim-step"><strong>3. Physical Address:</strong> Base (${targetSeg.base}) + Offset (${logicalOffset}) = <strong>${physicalAddr}</strong></div>
          `;
          addLog(`Translated (S${logicalSeg}, ${logicalOffset}) -> Physical Address ${physicalAddr}`, "success");
        } else {
          translationSteps.innerHTML = `
            <div class="step-item anim-step"><strong>1. Logical Address:</strong> (S = ${logicalSeg} [${targetSeg.name}], Offset d = ${logicalOffset})</div>
            <div class="step-item error anim-step"><strong>2. Limit Check:</strong> ${logicalOffset} &ge; ${targetSeg.limit} ✗ — <strong>TRAP: Segmentation Fault (Addressing Error)</strong></div>
          `;
          addLog(`TRAP: Offset ${logicalOffset} exceeds Segment S${logicalSeg} limit (${targetSeg.limit})!`, "error");
        }
      }
    }, delayMs);

    activeTimers.push(timer);
  });
}

// ============================================================
// 2. MODULE 2: PAGING (1.2s Per-Page Allocation + Space Check)
// ============================================================
function renderPagingInputs() {
  const { totalFrames, pageSize, processSize, pageTable, logicalPage, logicalOffset } = state.paging;
  const numPages = Math.ceil(processSize / pageSize);

  while (pageTable.length < numPages) {
    let assigned = false;
    for (let f = 0; f < totalFrames; f++) {
      if (!pageTable.includes(f)) {
        pageTable.push(f);
        assigned = true;
        break;
      }
    }
    if (!assigned) pageTable.push(-1);
  }
  if (pageTable.length > numPages) {
    state.paging.pageTable = pageTable.slice(0, numPages);
  }

  inputCard.innerHTML = `
    <div class="card-header">
      <h2>📄 Paging Parameters</h2>
      <span class="badge">${numPages} Pages</span>
    </div>
    <div class="input-row">
      <div class="form-group" style="flex:1;">
        <label>Process Size (Bytes)</label>
        <input type="number" id="pg-proc-size" value="${processSize}" min="256" step="256" />
      </div>
      <div class="form-group" style="flex:1;">
        <label>Page / Frame Size (B)</label>
        <input type="number" id="pg-page-size" value="${pageSize}" min="256" step="256" />
      </div>
    </div>
    <div class="form-group">
      <label>Total Physical Frames</label>
      <input type="number" id="pg-total-frames" value="${totalFrames}" min="2" max="32" />
    </div>
    <div class="queue-list">
      ${state.paging.pageTable
        .map(
          (frame, pIdx) => `
        <div class="queue-item">
          <div class="item-left"><span class="status-dot"></span><strong>Page P${pIdx}</strong></div>
          <div style="display:flex;align-items:center;gap:0.4rem;">
            <span>Frame:</span>
            <select style="width:85px;padding:0.25rem;" onchange="updatePageFrame(${pIdx}, this.value)">
              <option value="-1" ${frame === -1 ? "selected" : ""}>None</option>
              ${Array.from({ length: totalFrames }, (_, f) => `<option value="${f}" ${f === frame ? "selected" : ""}>F${f}</option>`).join("")}
            </select>
          </div>
        </div>`
        )
        .join("")}
    </div>
  `;

  translationCard.innerHTML = `
    <div class="card-header">
      <h2>🎯 Logical Address (p, d)</h2>
    </div>
    <div class="input-row">
      <div class="form-group" style="flex:1;">
        <label>Page Number (p)</label>
        <input type="number" id="pg-input-p" value="${logicalPage}" min="0" />
      </div>
      <div class="form-group" style="flex:1;">
        <label>Offset (d)</label>
        <input type="number" id="pg-input-d" value="${logicalOffset}" min="0" />
      </div>
    </div>
    <div class="form-group" style="margin-bottom:0;">
      <label>Quick Test Presets</label>
      <div class="input-row">
        <button class="btn-mini" onclick="setPagingTest(3584, 2, 452)">3584B → P2, d=452</button>
        <button class="btn-mini" onclick="setPagingTest(4096, 1, 200)">4KB → P1, d=200</button>
      </div>
    </div>
  `;

  document.getElementById("pg-proc-size").addEventListener("change", (e) => {
    clearActiveTimers();
    state.paging.processSize = Math.max(256, parseInt(e.target.value) || 3584);
    state.isStarted = false;
    renderPagingInputs();
    runPaging(false);
  });

  document.getElementById("pg-page-size").addEventListener("change", (e) => {
    clearActiveTimers();
    state.paging.pageSize = Math.max(128, parseInt(e.target.value) || 1024);
    state.isStarted = false;
    renderPagingInputs();
    runPaging(false);
  });

  document.getElementById("pg-total-frames").addEventListener("change", (e) => {
    clearActiveTimers();
    state.paging.totalFrames = Math.max(2, Math.min(32, parseInt(e.target.value) || 8));
    state.isStarted = false;
    renderPagingInputs();
    runPaging(false);
  });

  document.getElementById("pg-input-p").addEventListener("input", (e) => {
    clearActiveTimers();
    state.paging.logicalPage = parseInt(e.target.value) || 0;
    state.isStarted = false;
    runPaging(false);
  });

  document.getElementById("pg-input-d").addEventListener("input", (e) => {
    clearActiveTimers();
    state.paging.logicalOffset = parseInt(e.target.value) || 0;
    state.isStarted = false;
    runPaging(false);
  });
}

window.updatePageFrame = function (pageIdx, frameVal) {
  clearActiveTimers();
  state.paging.pageTable[pageIdx] = parseInt(frameVal);
  state.isStarted = false;
  runPaging(false);
};

window.setPagingTest = function (procSize, p, d) {
  clearActiveTimers();
  state.paging.processSize = procSize;
  state.paging.logicalPage = p;
  state.paging.logicalOffset = d;
  state.isStarted = false;
  renderPagingInputs();
  runPaging(false);
};

function runPaging(animate = false) {
  clearActiveTimers();
  const { totalFrames, pageSize, processSize, pageTable, logicalPage, logicalOffset } = state.paging;
  const numPages = Math.ceil(processSize / pageSize);
  const internalFrag = numPages * pageSize - processSize;
  const totalRam = totalFrames * pageSize;

  if (!state.isStarted) {
    memoryCanvas.innerHTML = Array.from({ length: totalFrames }, (_, fIdx) => `
      <div class="mem-block">
        <span class="mem-pill">F${fIdx} (${pageSize} B)</span>
        <div class="mem-mid">Free</div>
        <div class="mem-sub">${fIdx * pageSize} – ${(fIdx + 1) * pageSize - 1}</div>
      </div>
    `).join("");

    memStartLabel.textContent = "0 B";
    memSummaryLabel.textContent = `Used: 0 B / Total RAM: ${totalRam} B (0.0%)`;

    tableTitle.textContent = `📋 Page Table (Pending Start)`;
    tableContainer.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Page</th><th>Target Frame</th><th>Frame Base Address</th></tr>
        </thead>
        <tbody>
          ${pageTable
            .map(
              (frame, pIdx) => `
            <tr>
              <td><strong>P${pIdx}</strong></td>
              <td>${frame >= 0 && frame < totalFrames ? `F${frame}` : "Unassigned"}</td>
              <td>—</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;

    translationSteps.innerHTML = `
      <div class="step-item"><strong>System Ready:</strong> ${numPages} pages queued. Press <strong>▶ Start</strong> to load each page (1.2s delay per page).</div>
    `;
    return;
  }

  // Render empty frames first, then load each page with 1.2s delay
  const loadedFrames = {};
  let loadedCount = 0;

  const renderFrames = (finalStep = false, newlyLoadedFrame = -1) => {
    const isValidPage = logicalPage >= 0 && logicalPage < numPages;
    const isValidOffset = logicalOffset >= 0 && logicalOffset < pageSize;
    const targetFrame = isValidPage ? pageTable[logicalPage] : -1;

    memoryCanvas.innerHTML = Array.from({ length: totalFrames }, (_, fIdx) => {
      const mappedPage = loadedFrames[fIdx];
      const isAllocated = mappedPage !== undefined;
      const isLastPage = mappedPage === numPages - 1 && internalFrag > 0;
      const isTarget = finalStep && isValidPage && isValidOffset && fIdx === targetFrame;
      const isAnim = fIdx === newlyLoadedFrame;

      return `
        <div class="mem-block ${isAllocated ? "allocated" : ""} ${isTarget ? "highlight" : ""} ${isAnim ? "anim-align" : ""}">
          <span class="mem-pill">F${fIdx} (${pageSize} B)</span>
          <div class="mem-mid">${isAllocated ? `Page P${mappedPage}` : "Free"}</div>
          <div class="mem-sub">${fIdx * pageSize} – ${(fIdx + 1) * pageSize - 1}</div>
          ${isLastPage ? `<div class="internal-frag-bar">Wasted: ${internalFrag} B</div>` : ""}
        </div>
      `;
    }).join("");

    const usedB = loadedCount * pageSize;
    memStartLabel.textContent = "0 B";
    memSummaryLabel.textContent = `Used: ${usedB} B / Total RAM: ${totalRam} B (${((usedB / totalRam) * 100).toFixed(1)}%)`;
  };

  renderFrames(false);
  translationSteps.innerHTML = `<div class="step-item">Loading pages into physical frames (1.2s delay per page)...</div>`;

  tableTitle.textContent = `📋 Page Table (Page Size = ${pageSize} B)`;
  tableContainer.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>Page</th><th>Frame</th><th>Frame Base Address</th></tr>
      </thead>
      <tbody>
        ${pageTable
          .map((frame, pIdx) => {
            const fits = frame >= 0 && frame < totalFrames && loadedFrames[frame] === undefined;
            const rowClass = pIdx === logicalPage ? "active-row" : "";
            return `
            <tr class="${rowClass}">
              <td><strong>P${pIdx}</strong></td>
              <td>${frame >= 0 && frame < totalFrames ? `F${frame}` : "No Frame"}</td>
              <td>${frame >= 0 && frame < totalFrames ? frame * pageSize : "Not Allocated"}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;

  pageTable.forEach((frame, pIdx) => {
    const delayMs = animate ? (pIdx + 1) * 1200 : 0;
    const timer = setTimeout(() => {
      const canAllocate = frame >= 0 && frame < totalFrames && loadedFrames[frame] === undefined;
      if (canAllocate) {
        loadedFrames[frame] = pIdx;
        loadedCount++;
        addLog(`Loaded Page P${pIdx} into Frame F${frame}.`, "success");
      } else {
        addLog(`Could not allocate Page P${pIdx} — no free physical frame available.`, "error");
      }

      const isFinal = pIdx === pageTable.length - 1;
      renderFrames(isFinal, canAllocate ? frame : -1);

      if (isFinal) {
        const isValidPage = logicalPage >= 0 && logicalPage < numPages;
        const isValidOffset = logicalOffset >= 0 && logicalOffset < pageSize;
        const targetFrame = isValidPage ? pageTable[logicalPage] : -1;

        if (!isValidPage || targetFrame < 0 || loadedFrames[targetFrame] !== logicalPage) {
          translationSteps.innerHTML = `
            <div class="step-item error anim-step"><strong>Page Fault / Invalid Page:</strong> Page P${logicalPage} is not allocated in physical RAM.</div>
          `;
        } else if (!isValidOffset) {
          translationSteps.innerHTML = `
            <div class="step-item error anim-step"><strong>Invalid Offset:</strong> Offset ${logicalOffset} &ge; Page Size (${pageSize} B).</div>
          `;
        } else {
          const physicalAddr = targetFrame * pageSize + logicalOffset;
          translationSteps.innerHTML = `
            <div class="step-item anim-step"><strong>1. Logical Address:</strong> (Page p = ${logicalPage}, Offset d = ${logicalOffset})</div>
            <div class="step-item anim-step"><strong>2. Page Table Lookup:</strong> Page P${logicalPage} &rarr; Frame <strong>F${targetFrame}</strong></div>
            <div class="step-item success anim-step"><strong>3. Physical Address:</strong> (${targetFrame} &times; ${pageSize}) + ${logicalOffset} = <strong>${physicalAddr}</strong></div>
          `;
          addLog(`Paging: (P${logicalPage}, ${logicalOffset}) -> Frame F${targetFrame} -> Physical Address ${physicalAddr}`, "success");
        }
      }
    }, delayMs);

    activeTimers.push(timer);
  });
}

// ============================================================
// 3. MODULE 3: SEGMENTATION WITH PAGING (Sequential S1..Sn, 1.2s Delay)
// ============================================================
function renderSegPagingInputs() {
  reindexSegments(state.segPaging.segments);
  const { totalFrames, pageSize, segments, logicalSeg, logicalOffset } = state.segPaging;

  inputCard.innerHTML = `
    <div class="card-header">
      <h2>🔗 Segmented Page Tables</h2>
      <span class="badge">Page Size: ${pageSize} B</span>
    </div>
    <div class="input-row">
      <div class="form-group" style="flex:1;">
        <label>Page Size (Bytes)</label>
        <input type="number" id="sp-page-size" value="${pageSize}" min="256" step="256" />
      </div>
      <div class="form-group" style="flex:1;">
        <label>Total RAM Frames</label>
        <input type="number" id="sp-total-frames" value="${totalFrames}" min="4" max="24" />
      </div>
    </div>
    <div class="queue-list">
      ${segments
        .map(
          (seg) => `
        <div class="queue-item" style="flex-direction:column;align-items:flex-start;gap:0.35rem;">
          <div style="display:flex;justify-content:space-between;width:100%;">
            <strong>S${seg.id} (${seg.name}) — PT${seg.id}</strong>
            <span class="badge">Limit: ${seg.limit} B</span>
          </div>
          <div style="font-size:0.78rem;color:var(--text-secondary);">
            Page &rarr; Frame Map: ${seg.pageTable.map((f, p) => `P${p}&rarr;F${f}`).join(", ")}
          </div>
        </div>`
        )
        .join("")}
    </div>
  `;

  translationCard.innerHTML = `
    <div class="card-header">
      <h2>🎯 Logical Address (S, d)</h2>
    </div>
    <div class="input-row">
      <div class="form-group" style="flex:1;">
        <label>Segment Number (S)</label>
        <select id="sp-input-s">
          ${segments
            .map(
              (s) =>
                `<option value="${s.id}" ${s.id === logicalSeg ? "selected" : ""}>S${s.id} (${s.name})</option>`
            )
            .join("")}
        </select>
      </div>
      <div class="form-group" style="flex:1;">
        <label>Segment Offset (d)</label>
        <input type="number" id="sp-input-d" value="${logicalOffset}" min="0" />
      </div>
    </div>
    <div class="form-group" style="margin-bottom:0;">
      <label>Quick Test Presets</label>
      <div class="input-row">
        <button class="btn-mini" onclick="setSegPagingTest(2, 2200)">(S2, 2200) → 1176</button>
        <button class="btn-mini" onclick="setSegPagingTest(2, 500)">(S2, 500) → 4596</button>
        <button class="btn-mini" onclick="setSegPagingTest(1, 50)">(S1, 50) → Trap</button>
      </div>
    </div>
  `;

  document.getElementById("sp-page-size").addEventListener("change", (e) => {
    clearActiveTimers();
    state.segPaging.pageSize = Math.max(128, parseInt(e.target.value) || 1024);
    state.isStarted = false;
    runSegPaging(false);
  });

  document.getElementById("sp-total-frames").addEventListener("change", (e) => {
    clearActiveTimers();
    state.segPaging.totalFrames = Math.max(4, Math.min(24, parseInt(e.target.value) || 12));
    state.isStarted = false;
    runSegPaging(false);
  });

  document.getElementById("sp-input-s").addEventListener("change", (e) => {
    clearActiveTimers();
    state.segPaging.logicalSeg = parseInt(e.target.value);
    state.isStarted = false;
    runSegPaging(false);
  });

  document.getElementById("sp-input-d").addEventListener("input", (e) => {
    clearActiveTimers();
    state.segPaging.logicalOffset = parseInt(e.target.value) || 0;
    state.isStarted = false;
    runSegPaging(false);
  });
}

window.setSegPagingTest = function (s, d) {
  clearActiveTimers();
  state.segPaging.logicalSeg = s;
  state.segPaging.logicalOffset = d;
  state.isStarted = false;
  renderSegPagingInputs();
  runSegPaging(false);
};

function runSegPaging(animate = false) {
  clearActiveTimers();
  reindexSegments(state.segPaging.segments);
  const { totalFrames, pageSize, segments, logicalSeg, logicalOffset } = state.segPaging;
  const seg = segments.find((s) => s.id === logicalSeg);
  const totalRam = totalFrames * pageSize;

  if (!state.isStarted) {
    memoryCanvas.innerHTML = Array.from({ length: totalFrames }, (_, fIdx) => `
      <div class="mem-block">
        <span class="mem-pill">F${fIdx}</span>
        <div class="mem-mid">Free</div>
        <div class="mem-sub">${fIdx * pageSize}–${(fIdx + 1) * pageSize - 1}</div>
      </div>
    `).join("");

    memStartLabel.textContent = "0 B";
    memSummaryLabel.textContent = `Used: 0 B / Total RAM: ${totalRam} B (0.0%)`;

    tableTitle.textContent = `📋 Segment & Page Tables (Pending Start)`;
    tableContainer.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Seg</th><th>Name</th><th>Limit</th><th>Page Table</th></tr>
        </thead>
        <tbody>
          ${segments
            .map(
              (s) => `
            <tr>
              <td><strong>S${s.id}</strong></td>
              <td>${s.name}</td>
              <td>${s.limit}</td>
              <td>PT${s.id}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;

    translationSteps.innerHTML = `
      <div class="step-item"><strong>System Ready:</strong> Press <strong>▶ Start</strong> to allocate segment pages into frames (1.2s delay per page).</div>
    `;
    return;
  }

  // Build ordered list of segment-page items to allocate every 1.2 seconds
  const allocationQueue = [];
  segments.forEach((s) => {
    s.pageTable.forEach((frame, pIdx) => {
      allocationQueue.push({ seg: s, pIdx, frame });
    });
  });

  const frameOwner = {};
  let allocatedCount = 0;

  const renderCanvas = (finalStep = false, highlightFrame = -1, newlyAddedFrame = -1) => {
    memoryCanvas.innerHTML = Array.from({ length: totalFrames }, (_, fIdx) => {
      const owner = frameOwner[fIdx];
      const isTarget = finalStep && highlightFrame === fIdx;
      const isAnim = fIdx === newlyAddedFrame;
      return `
        <div class="mem-block ${owner ? "allocated" : ""} ${isTarget ? "highlight" : ""} ${isAnim ? "anim-align" : ""}">
          <span class="mem-pill">F${fIdx}</span>
          <div class="mem-mid">${owner || "Free"}</div>
          <div class="mem-sub">${fIdx * pageSize}–${(fIdx + 1) * pageSize - 1}</div>
        </div>`;
    }).join("");

    const usedB = allocatedCount * pageSize;
    memStartLabel.textContent = "0 B";
    memSummaryLabel.textContent = `Used: ${usedB} B / Total RAM: ${totalRam} B (${((usedB / totalRam) * 100).toFixed(1)}%)`;
  };

  renderCanvas(false);
  translationSteps.innerHTML = `<div class="step-item">Allocating segmented pages into frames (1.2s delay per page)...</div>`;

  const isValidLimit = seg && logicalOffset >= 0 && logicalOffset < seg.limit;
  const pageNum = Math.floor(logicalOffset / pageSize);
  const pageOffset = logicalOffset % pageSize;

  tableTitle.textContent = `📋 Segment Table & ${seg ? `PT${seg.id}` : "Page Table"}`;
  tableContainer.innerHTML = `
    <table class="data-table" style="margin-bottom:0.85rem;">
      <thead>
        <tr><th>Seg</th><th>Name</th><th>Limit</th><th>Page Table</th></tr>
      </thead>
      <tbody>
        ${segments
          .map(
            (s) => `
          <tr class="${s.id === logicalSeg ? (isValidLimit ? "active-row" : "trap-row") : ""}">
            <td><strong>S${s.id}</strong></td>
            <td>${s.name}</td>
            <td>${s.limit}</td>
            <td>PT${s.id}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
    ${
      seg
        ? `<table class="data-table">
            <thead><tr><th>PT${seg.id} Page</th><th>Mapped Frame</th></tr></thead>
            <tbody>
              ${seg.pageTable
                .map(
                  (f, p) => `
                <tr class="${isValidLimit && p === pageNum ? "active-row" : ""}">
                  <td>Page ${p}</td>
                  <td>Frame F${f}</td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>`
        : ""
    }
  `;

  allocationQueue.forEach((item, idx) => {
    const delayMs = animate ? (idx + 1) * 1200 : 0;
    const timer = setTimeout(() => {
      const canAlloc = item.frame >= 0 && item.frame < totalFrames && !frameOwner[item.frame];
      if (canAlloc) {
        frameOwner[item.frame] = `S${item.seg.id}-P${item.pIdx}`;
        allocatedCount++;
        addLog(`Allocated S${item.seg.id}-P${item.pIdx} (${item.seg.name}) into Frame F${item.frame}.`, "success");
      } else {
        addLog(`Could not allocate S${item.seg.id}-P${item.pIdx} (${item.seg.name}) — Frame F${item.frame} unavailable.`, "error");
      }

      const isFinal = idx === allocationQueue.length - 1;
      const targetFrame = isValidLimit && seg.pageTable[pageNum] !== undefined ? seg.pageTable[pageNum] : -1;
      const physicalAddr = targetFrame >= 0 && frameOwner[targetFrame] === `S${logicalSeg}-P${pageNum}`
        ? targetFrame * pageSize + pageOffset
        : null;

      renderCanvas(isFinal, physicalAddr !== null ? targetFrame : -1, canAlloc ? item.frame : -1);

      if (isFinal) {
        if (!isValidLimit) {
          translationSteps.innerHTML = `
            <div class="step-item anim-step"><strong>1. Segment Lookup:</strong> S${logicalSeg} (${seg.name}), Limit = ${seg.limit}</div>
            <div class="step-item error anim-step"><strong>2. Limit Violation:</strong> ${logicalOffset} &ge; ${seg.limit} ✗ — <strong>TRAP (Addressing Error)</strong></div>
          `;
          addLog(`Seg+Paging TRAP: Offset ${logicalOffset} >= Limit ${seg.limit} in S${logicalSeg}.`, "error");
        } else if (physicalAddr === null) {
          translationSteps.innerHTML = `
            <div class="step-item error anim-step"><strong>Allocation Error:</strong> Required page S${logicalSeg}-P${pageNum} could not be allocated in RAM.</div>
          `;
        } else {
          translationSteps.innerHTML = `
            <div class="step-item anim-step"><strong>1. Segment Check:</strong> ${logicalOffset} &lt; ${seg.limit} ✓ &rarr; Use <strong>PT${seg.id}</strong></div>
            <div class="step-item anim-step"><strong>2. Split Offset:</strong> Page = ${logicalOffset} &divide; ${pageSize} = <strong>${pageNum}</strong> | Offset = ${logicalOffset} % ${pageSize} = <strong>${pageOffset}</strong></div>
            <div class="step-item anim-step"><strong>3. Page Table (PT${seg.id}):</strong> Page ${pageNum} &rarr; Frame <strong>F${targetFrame}</strong></div>
            <div class="step-item success anim-step"><strong>4. Physical Address:</strong> (${targetFrame} &times; ${pageSize}) + ${pageOffset} = <strong>${physicalAddr}</strong></div>
          `;
          addLog(`Seg+Paging: (S${logicalSeg}, ${logicalOffset}) -> P${pageNum}, d=${pageOffset} -> F${targetFrame} -> ${physicalAddr}`, "success");
        }
      }
    }, delayMs);

    activeTimers.push(timer);
  });
}

// ============================================================
// 4. MODULE 4: PERFORMANCE ANALYSIS
// ============================================================
function renderPerformanceAnalysis() {
  const m = Math.max(10, parseInt(document.getElementById("mem-access-time").value) || 100);
  const eatSeg = 2 * m;
  const eatPag = 2 * m;
  const eatSegPag = 3 * m;

  const { usedBytes } = evaluateSegmentAllocations(
    state.segmentation.totalRam,
    state.segmentation.segments
  );
  const segUtil = ((usedBytes / state.segmentation.totalRam) * 100).toFixed(1);

  const pgPages = Math.ceil(state.paging.processSize / state.paging.pageSize);
  const pgInternalFrag = Math.max(0, pgPages * state.paging.pageSize - state.paging.processSize);
  const pgUtil = Math.min(
    100,
    (state.paging.processSize / (state.paging.totalFrames * state.paging.pageSize)) * 100
  ).toFixed(1);

  document.getElementById("perf-kpi-cards").innerHTML = `
    <div class="kpi-card">
      <h3>Segmentation Utilization</h3>
      <div class="kpi-value">${segUtil}%</div>
      <div class="kpi-sub">${usedBytes} B allocated of ${state.segmentation.totalRam} B RAM</div>
    </div>
    <div class="kpi-card">
      <h3>Paging Internal Fragmentation</h3>
      <div class="kpi-value">${pgInternalFrag} B</div>
      <div class="kpi-sub">${pgPages} pages (${pgUtil}% RAM util.)</div>
    </div>
    <div class="kpi-card">
      <h3>Segmentation / Paging EAT</h3>
      <div class="kpi-value">${eatSeg} ns</div>
      <div class="kpi-sub">1 table lookup + 1 data access (m = ${m} ns)</div>
    </div>
    <div class="kpi-card">
      <h3>Seg. + Paging EAT</h3>
      <div class="kpi-value">${eatSegPag} ns</div>
      <div class="kpi-sub">2 table lookups + 1 data access (m = ${m} ns)</div>
    </div>
  `;

  document.getElementById("perf-comparison-body").innerHTML = `
    <tr>
      <td><strong>Fragmentation</strong></td>
      <td>External</td>
      <td>Internal (last page: ${pgInternalFrag} B)</td>
      <td>Internal (last page of each segment)</td>
    </tr>
    <tr>
      <td><strong>Table Lookups</strong></td>
      <td>1 (Segment Table)</td>
      <td>1 (Page Table)</td>
      <td>2 (Segment + Page Table)</td>
    </tr>
    <tr>
      <td><strong>Extra Memory Accesses</strong></td>
      <td>1</td>
      <td>1</td>
      <td>2</td>
    </tr>
    <tr>
      <td><strong>Effective Access Time (m = ${m} ns)</strong></td>
      <td><strong>${eatSeg} ns</strong></td>
      <td><strong>${eatPag} ns</strong></td>
      <td><strong>${eatSegPag} ns</strong></td>
    </tr>
    <tr>
      <td><strong>Best Suited For</strong></td>
      <td>Logical protection &amp; sharing</td>
      <td>Efficient non-contiguous allocation</td>
      <td>Both benefits, higher translation cost</td>
    </tr>
  `;
}

// ============================================================
// NAVIGATION & GLOBAL CONTROLS
// ============================================================
function animateSimulation() {
  state.isStarted = true;
  if (state.activeModule === "segmentation") {
    runSegmentation(true);
  } else if (state.activeModule === "paging") {
    runPaging(true);
  } else if (state.activeModule === "seg_paging") {
    runSegPaging(true);
  }
}

function switchModule(moduleName) {
  clearActiveTimers();
  state.activeModule = moduleName;
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.module === moduleName));

  if (moduleName === "performance") {
    simulatorLayout.classList.add("hidden");
    performanceLayout.classList.remove("hidden");
    renderPerformanceAnalysis();
    addLog("Opened Module 4: Comparative Performance Analysis.");
    return;
  }

  simulatorLayout.classList.remove("hidden");
  performanceLayout.classList.add("hidden");

  if (moduleName === "segmentation") {
    renderSegmentationInputs();
    runSegmentation(false);
  } else if (moduleName === "paging") {
    renderPagingInputs();
    runPaging(false);
  } else if (moduleName === "seg_paging") {
    renderSegPagingInputs();
    runSegPaging(false);
  }
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    state.isStarted = false;
    switchModule(btn.dataset.module);
  });
});

document.getElementById("btn-start").addEventListener("click", () => {
  animateSimulation();
});

document.getElementById("btn-reset").addEventListener("click", () => {
  clearActiveTimers();
  const currentTab = state.activeModule;
  state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  state.isStarted = false;
  addLog("System reset to default configuration. Click Start to allocate.");
  switchModule(currentTab);
});

document.getElementById("btn-clear-logs").addEventListener("click", () => {
  systemLogs.innerHTML = "";
});

document.getElementById("btn-recalc-perf").addEventListener("click", () => {
  renderPerformanceAnalysis();
  addLog("Recalculated Effective Access Time (EAT) metrics.");
});

addLog("System Ready. Click ▶ Start to allocate memory (1.2s delay per process).");
switchModule("segmentation");
