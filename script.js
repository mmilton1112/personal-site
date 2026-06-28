// ===== Orbital MedCalc — Clinical Equation Console =====
(function () {
  "use strict";

  // ----------------------------------------------------------
  //  Equation registry
  //  Each equation defines: label, description, input fields,
  //  a compute() returning { value, unit, interpret, formula }.
  // ----------------------------------------------------------
  const EQUATIONS = {
    crcl: {
      label: "Creatinine Clearance (Cockcroft–Gault)",
      desc: "Estimates renal function using actual body weight, ideal body weight, and adjusted body weight.",
      fields: [
        { id: "age", label: "Age", unit: "years", min: 0, max: 120 },
        { id: "weight", label: "Actual body weight", unit: "kg", min: 0.1, step: 0.1 },
        { id: "height", label: "Height", unit: "cm", min: 100, max: 250, step: 0.1 },
        { id: "scr", label: "Serum creatinine", unit: "mg/dL", min: 0.01, step: 0.01 },
        { id: "sex", label: "Sex", type: "select", options: [["male", "Male"], ["female", "Female"]] },
      ],
      compute: (f) => {
        const { age, weight, height, scr, sex } = f;
        const ibw = idealBodyWeightKg(height, sex);
        const adjbw = ibw + 0.4 * (weight - ibw);
        const crcl = (bodyWeight) => {
          let value = ((140 - age) * bodyWeight) / (72 * scr);
          if (sex === "female") value *= 0.85;
          return value;
        };
        const actual = crcl(weight);
        const ideal = crcl(ibw);
        const adjusted = crcl(adjbw);
        return {
          value: actual,
          unit: "mL/min",
          interpret: { tag: "info", text: "Compare actual, ideal, and adjusted body-weight estimates." },
          formula: `IBW = ${formatNumber(ibw)} kg; AdjBW = ${formatNumber(adjbw)} kg. Cockcroft–Gault = ((140 − age) × weight${sex === "female" ? " × 0.85" : ""}) / (72 × SCr)`,
          results: [
            { label: "Actual body weight", value: actual, unit: "mL/min", detail: `${formatNumber(weight)} kg`, interpret: kidneyStage(actual) },
            { label: "Ideal body weight", value: ideal, unit: "mL/min", detail: `${formatNumber(ibw)} kg`, interpret: kidneyStage(ideal) },
            { label: "Adjusted body weight", value: adjusted, unit: "mL/min", detail: `${formatNumber(adjbw)} kg`, interpret: kidneyStage(adjusted) },
          ],
        };
      },
    },

    egfr: {
      label: "eGFR (MDRD, 4-variable)",
      desc: "Estimated glomerular filtration rate normalized to 1.73 m² body surface area.",
      fields: [
        { id: "age", label: "Age", unit: "years", min: 1, max: 120 },
        { id: "scr", label: "Serum creatinine", unit: "mg/dL", min: 0.01, step: 0.01 },
        { id: "sex", label: "Sex", type: "select", options: [["male", "Male"], ["female", "Female"]] },
        { id: "black", label: "Black race", type: "select", options: [["no", "No"], ["yes", "Yes"]] },
      ],
      compute: (f) => {
        const { age, scr, sex, black } = f;
        let v = 175 * Math.pow(scr, -1.154) * Math.pow(age, -0.203);
        if (sex === "female") v *= 0.742;
        if (black === "yes") v *= 1.212;
        return {
          value: v,
          unit: "mL/min/1.73m²",
          interpret: gfrStage(v),
          formula: `175 × ${scr}^−1.154 × ${age}^−0.203${sex === "female" ? " × 0.742" : ""}${black === "yes" ? " × 1.212" : ""}`,
        };
      },
    },

    bmi: {
      label: "Body Mass Index (BMI)",
      desc: "Weight-to-height ratio used to screen weight categories.",
      fields: [
        { id: "weight", label: "Weight", unit: "kg", min: 0, step: 0.1 },
        { id: "height", label: "Height", unit: "cm", min: 0, step: 0.1 },
      ],
      compute: (f) => {
        const m = f.height / 100;
        const v = f.weight / (m * m);
        return {
          value: v,
          unit: "kg/m²",
          interpret: bmiCategory(v),
          formula: `${f.weight} / (${m.toFixed(2)})²`,
        };
      },
    },

    bsa: {
      label: "Body Surface Area (Mosteller)",
      desc: "Body surface area, commonly used for chemotherapy dosing.",
      fields: [
        { id: "height", label: "Height", unit: "cm", min: 0, step: 0.1 },
        { id: "weight", label: "Weight", unit: "kg", min: 0, step: 0.1 },
      ],
      compute: (f) => {
        const v = Math.sqrt((f.height * f.weight) / 3600);
        return {
          value: v,
          unit: "m²",
          interpret: { tag: "info", text: "Typical adult range ≈ 1.5–2.0 m²" },
          formula: `√((${f.height} × ${f.weight}) / 3600)`,
        };
      },
    },

    map: {
      label: "Mean Arterial Pressure (MAP)",
      desc: "Average arterial pressure during a single cardiac cycle.",
      fields: [
        { id: "sbp", label: "Systolic BP", unit: "mmHg", min: 0 },
        { id: "dbp", label: "Diastolic BP", unit: "mmHg", min: 0 },
      ],
      compute: (f) => {
        const v = (f.sbp + 2 * f.dbp) / 3;
        return {
          value: v,
          unit: "mmHg",
          interpret: mapCategory(v),
          formula: `(${f.sbp} + 2 × ${f.dbp}) / 3`,
        };
      },
    },

    cacorr: {
      label: "Corrected Calcium",
      desc: "Adjusts measured serum calcium for low albumin.",
      fields: [
        { id: "ca", label: "Measured calcium", unit: "mg/dL", min: 0, step: 0.1 },
        { id: "alb", label: "Albumin", unit: "g/dL", min: 0, step: 0.1 },
      ],
      compute: (f) => {
        const v = f.ca + 0.8 * (4 - f.alb);
        return {
          value: v,
          unit: "mg/dL",
          interpret: calciumCategory(v),
          formula: `${f.ca} + 0.8 × (4 − ${f.alb})`,
        };
      },
    },

    aniongap: {
      label: "Anion Gap",
      desc: "Difference between measured cations and anions; screens metabolic acidosis.",
      fields: [
        { id: "na", label: "Sodium (Na⁺)", unit: "mmol/L", min: 0 },
        { id: "cl", label: "Chloride (Cl⁻)", unit: "mmol/L", min: 0 },
        { id: "hco3", label: "Bicarbonate (HCO₃⁻)", unit: "mmol/L", min: 0 },
      ],
      compute: (f) => {
        const v = f.na - (f.cl + f.hco3);
        return {
          value: v,
          unit: "mmol/L",
          interpret: anionGapCategory(v),
          formula: `${f.na} − (${f.cl} + ${f.hco3})`,
        };
      },
    },
  };

  // ---------- Interpretation helpers ----------
  function kidneyStage(v) {
    if (v >= 90) return { tag: "good", text: "Normal kidney function (≥90)" };
    if (v >= 60) return { tag: "good", text: "Mildly reduced (60–89)" };
    if (v >= 30) return { tag: "warn", text: "Moderately reduced (30–59)" };
    if (v >= 15) return { tag: "bad", text: "Severely reduced (15–29)" };
    return { tag: "bad", text: "Kidney failure (<15)" };
  }
  function gfrStage(v) {
    if (v >= 90) return { tag: "good", text: "G1 — Normal (≥90)" };
    if (v >= 60) return { tag: "good", text: "G2 — Mildly decreased (60–89)" };
    if (v >= 45) return { tag: "warn", text: "G3a — Mild–moderate (45–59)" };
    if (v >= 30) return { tag: "warn", text: "G3b — Moderate–severe (30–44)" };
    if (v >= 15) return { tag: "bad", text: "G4 — Severely decreased (15–29)" };
    return { tag: "bad", text: "G5 — Kidney failure (<15)" };
  }
  function bmiCategory(v) {
    if (v < 18.5) return { tag: "warn", text: "Underweight (<18.5)" };
    if (v < 25) return { tag: "good", text: "Normal (18.5–24.9)" };
    if (v < 30) return { tag: "warn", text: "Overweight (25–29.9)" };
    return { tag: "bad", text: "Obese (≥30)" };
  }
  function mapCategory(v) {
    if (v < 60) return { tag: "bad", text: "Low — organ perfusion risk (<60)" };
    if (v <= 100) return { tag: "good", text: "Normal (60–100)" };
    return { tag: "warn", text: "Elevated (>100)" };
  }
  function calciumCategory(v) {
    if (v < 8.5) return { tag: "warn", text: "Hypocalcemia (<8.5)" };
    if (v <= 10.5) return { tag: "good", text: "Normal (8.5–10.5)" };
    return { tag: "bad", text: "Hypercalcemia (>10.5)" };
  }
  function anionGapCategory(v) {
    if (v < 8) return { tag: "warn", text: "Low (<8)" };
    if (v <= 12) return { tag: "good", text: "Normal (8–12)" };
    return { tag: "bad", text: "High anion gap (>12)" };
  }

  function idealBodyWeightKg(heightCm, sex) {
    const heightIn = heightCm / 2.54;
    const inchesOverFiveFeet = heightIn - 60;
    const base = sex === "female" ? 45.5 : 50;
    return base + 2.3 * inchesOverFiveFeet;
  }

  // ---------- DOM ----------
  const selectEl = document.getElementById("equationSelect");
  const descEl = document.getElementById("equationDesc");
  const formEl = document.getElementById("calcForm");
  const calcBtn = document.getElementById("calcBtn");
  const resetBtn = document.getElementById("resetBtn");
  const resultEl = document.getElementById("result");
  const resultNumber = document.getElementById("resultNumber");
  const resultUnit = document.getElementById("resultUnit");
  const resultInterp = document.getElementById("resultInterpretation");
  const resultBreakdown = document.getElementById("resultBreakdown");
  const resultFormula = document.getElementById("resultFormula");

  // Populate equation selector.
  Object.entries(EQUATIONS).forEach(([key, eq]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = eq.label;
    selectEl.appendChild(opt);
  });

  function currentEq() {
    return EQUATIONS[selectEl.value];
  }

  // Build input fields for the selected equation.
  function renderFields() {
    const eq = currentEq();
    descEl.textContent = eq.desc;
    formEl.innerHTML = "";
    hideResult();

    eq.fields.forEach((field) => {
      const cell = document.createElement("div");
      cell.className = "input-cell" + (field.type === "select" ? "" : "");

      const label = document.createElement("label");
      label.setAttribute("for", "f_" + field.id);
      label.textContent = field.unit ? `${field.label} (${field.unit})` : field.label;
      cell.appendChild(label);

      let control;
      if (field.type === "select") {
        control = document.createElement("select");
        field.options.forEach(([val, text]) => {
          const o = document.createElement("option");
          o.value = val;
          o.textContent = text;
          control.appendChild(o);
        });
      } else {
        control = document.createElement("input");
        control.type = "number";
        control.placeholder = field.unit || "value";
        if (field.min !== undefined) control.min = field.min;
        if (field.max !== undefined) control.max = field.max;
        control.step = field.step || 1;
      }
      control.id = "f_" + field.id;
      control.dataset.fieldId = field.id;
      cell.appendChild(control);
      formEl.appendChild(cell);
    });

    // Make the layout tidy when there's an odd number of fields.
    const cells = formEl.querySelectorAll(".input-cell");
    if (cells.length % 2 === 1) cells[cells.length - 1].classList.add("full");
  }

  function collectValues() {
    const eq = currentEq();
    const values = {};
    let error = null;
    eq.fields.forEach((field) => {
      const el = document.getElementById("f_" + field.id);
      if (field.type === "select") {
        values[field.id] = el.value;
      } else {
        const raw = el.value.trim();
        if (raw === "") { error = error || `Enter a value for ${field.label}.`; return; }
        const n = parseFloat(raw);
        if (!isFinite(n)) { error = error || `${field.label} must be a number.`; return; }
        if (field.min !== undefined && n < field.min) {
          error = error || `${field.label} must be ≥ ${field.min}.`;
        }
        values[field.id] = n;
      }
    });
    return { values, error };
  }

  function formatNumber(n) {
    if (!isFinite(n)) return "—";
    const abs = Math.abs(n);
    let str;
    if (abs !== 0 && (abs < 0.01 || abs >= 1e6)) str = n.toExponential(2);
    else str = (Math.round(n * 100) / 100).toString();
    return str;
  }

  function showResult(out) {
    resultEl.hidden = false;
    resultEl.classList.remove("error");
    resultNumber.textContent = out.results ? "3 estimates" : formatNumber(out.value);
    resultUnit.textContent = out.unit || "";
    if (out.interpret) {
      resultInterp.innerHTML =
        `<span class="tag ${out.interpret.tag}">${out.interpret.text}</span>`;
    } else {
      resultInterp.textContent = "";
    }
    resultBreakdown.innerHTML = "";
    if (out.results) {
      resultBreakdown.innerHTML = out.results.map((item) => `
        <article class="result-card">
          <div>
            <h3>${item.label}</h3>
            <p>${item.detail}</p>
          </div>
          <div class="result-card-value">
            <strong>${formatNumber(item.value)}</strong>
            <span>${item.unit}</span>
            <span class="tag ${item.interpret.tag}">${item.interpret.text}</span>
          </div>
        </article>
      `).join("");
    }
    resultFormula.textContent = out.formula ? "= " + out.formula : "";
  }

  function showError(msg) {
    resultEl.hidden = false;
    resultEl.classList.add("error");
    resultNumber.textContent = msg;
    resultUnit.textContent = "";
    resultInterp.textContent = "";
    resultBreakdown.innerHTML = "";
    resultFormula.textContent = "";
  }

  function hideResult() {
    resultEl.hidden = true;
  }

  function compute() {
    const { values, error } = collectValues();
    if (error) { showError(error); return; }
    try {
      const out = currentEq().compute(values);
      if (!isFinite(out.value)) { showError("Result undefined — check inputs."); return; }
      showResult(out);
    } catch (e) {
      showError("Could not compute — check inputs.");
    }
  }

  function reset() {
    renderFields();
  }

  // ---------- Events ----------
  selectEl.addEventListener("change", renderFields);
  calcBtn.addEventListener("click", compute);
  resetBtn.addEventListener("click", reset);
  formEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); compute(); }
  });

  // init
  renderFields();
})();
