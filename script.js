"use strict";

/* ============================================================
   Tab navigation
   ============================================================ */
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => {
      t.classList.remove("is-active");
      t.setAttribute("aria-selected", "false");
    });
    panels.forEach((p) => p.classList.remove("is-active"));

    tab.classList.add("is-active");
    tab.setAttribute("aria-selected", "true");
    document.getElementById(tab.dataset.target).classList.add("is-active");
  });
});

/* ============================================================
   Helpers
   ============================================================ */
const $ = (id) => document.getElementById(id);
const num = (id) => parseFloat($(id).value);
const round = (v, d = 1) => {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
};
const flagInvalid = (el, bad) => el.classList.toggle("invalid", bad);

/* ============================================================
   1) Creatinine Clearance (Cockcroft-Gault)
   ============================================================ */
const crclForm = $("crcl-form");

function toKg(value, unit) {
  return unit === "lb" ? value * 0.45359237 : value;
}
function toInches(value, unit) {
  return unit === "cm" ? value / 2.54 : value;
}
function toCm(value, unit) {
  return unit === "in" ? value * 2.54 : value;
}
function toMgDl(value, unit) {
  // 1 mg/dL creatinine = 88.42 umol/L
  return unit === "umol" ? value / 88.42 : value;
}

function idealBodyWeight(sex, heightInches) {
  const base = sex === "female" ? 45.5 : 50;
  const ibw = base + 2.3 * (heightInches - 60);
  return Math.max(ibw, 0); // guard against very short stature
}

function cockcroftGault(age, weightKg, scrMgDl, sex) {
  let crcl = ((140 - age) * weightKg) / (72 * scrMgDl);
  if (sex === "female") crcl *= 0.85;
  return crcl;
}

crclForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const age = num("cg-age");
  const sex = $("cg-sex").value;
  const heightRaw = num("cg-height");
  const heightUnit = $("cg-height-unit").value;
  const weightRaw = num("cg-weight");
  const weightUnit = $("cg-weight-unit").value;
  const scrRaw = num("cg-scr");
  const scrUnit = $("cg-scr-unit").value;

  const checks = [
    [$("cg-age"), !(age >= 0 && age < 130)],
    [$("cg-height"), !(heightRaw > 0)],
    [$("cg-weight"), !(weightRaw > 0)],
    [$("cg-scr"), !(scrRaw > 0)],
  ];
  let invalid = false;
  checks.forEach(([el, bad]) => {
    flagInvalid(el, bad);
    if (bad) invalid = true;
  });
  if (invalid) {
    $("crcl-results").hidden = true;
    return;
  }

  const heightIn = toInches(heightRaw, heightUnit);
  const abw = toKg(weightRaw, weightUnit);
  const scr = toMgDl(scrRaw, scrUnit);

  const ibw = idealBodyWeight(sex, heightIn);
  const adjbw = ibw + 0.4 * (abw - ibw);

  const crclAbw = cockcroftGault(age, abw, scr, sex);
  const crclIbw = cockcroftGault(age, ibw, scr, sex);
  const crclAdj = cockcroftGault(age, adjbw, scr, sex);

  $("res-abw").textContent = round(crclAbw, 1);
  $("res-ibw").textContent = round(crclIbw, 1);
  $("res-adjbw").textContent = round(crclAdj, 1);

  $("res-abw-wt").textContent = `Weight ${round(abw, 1)} kg`;
  $("res-ibw-wt").textContent = `IBW ${round(ibw, 1)} kg`;
  $("res-adjbw-wt").textContent = `AdjBW ${round(adjbw, 1)} kg`;

  // Guidance on which weight to use
  const pctOverIdeal = ibw > 0 ? (abw / ibw) * 100 : 100;
  let advice;
  if (abw < ibw) {
    advice =
      "Actual weight is below ideal &mdash; the actual body weight estimate is generally preferred for dosing.";
  } else if (pctOverIdeal >= 120) {
    advice =
      "Actual weight is &ge; 120&#37; of ideal &mdash; the adjusted body weight estimate is commonly preferred to avoid overestimation.";
  } else {
    advice =
      "Actual weight is within 120&#37; of ideal &mdash; the ideal (or actual) body weight estimate is typically appropriate.";
  }
  $("crcl-guidance").innerHTML =
    advice + " A reference recommends choosing weight per local protocol and clinical context.";

  $("crcl-results").hidden = false;
});

crclForm.addEventListener("reset", () => {
  $("crcl-results").hidden = true;
  crclForm.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
});

/* ============================================================
   2) STS Adult Cardiac Surgery Risk
   Sends inputs to the official STS Short-Term Risk Calculator
   (a Shiny app served over WebSocket) and renders the returned
   estimates inside this themed UI.
   ============================================================ */
const stsForm = $("sts-form");
const STS_WS_URL = "wss://acsdriskcalc.research.sts.org/websocket/";

const STS_BOOLEAN_FIELDS = [
  "medacei48", "medgp", "medinotr", "medster", "medadp5days", "fhcad",
  "hypertn", "liverdis", "mediastrad", "unrespstat", "dialysis", "cancer",
  "syncope", "immsupp", "pneumonia", "slpapn", "hmo2", "pvd", "cvdstenrt",
  "cvdpcarsurg", "cvdstenlft", "carshock", "resusc", "stenleftmain",
  "laddiststenpercent", "vdstena", "vdstenm", "vdaoprimet",
];

// Outcome label (as returned by STS) -> display name
const STS_OUTCOMES = [
  ["Operative Mortality", "Operative Mortality"],
  ["Morbidity & Mortality", "Morbidity & Mortality"],
  ["Stroke", "Stroke"],
  ["Renal Failure", "Renal Failure"],
  ["Reoperation", "Reoperation"],
  ["Prolonged Ventilation", "Prolonged Ventilation"],
  ["Deep Sternal Wound Infection", "Deep Sternal Wound Infection"],
  ["Long Hospital Stay", "Long Stay (>14 days)"],
  ["Short Hospital Stay", "Short Stay (<6 days)"],
];

function stsInitData() {
  const d = {
    prcvint: [], Proc: [], incidenc: [], status: [], gender: [],
    racemulti: [], payordata: [], diabetes: [], endocarditis: [],
    ivdrugab: [], alcohol: [], tobaccouse: [], chrlungd: [], cvd: [],
    heartfailtmg: [], classnyh: [], mcs: [], cardsymptimeofadm: [],
    miwhen: [], numdisv: [], vdinsufa: [], vdinsufm: [], vdinsuft: [],
    arrhythatrfib: [], arrhythafib: [], arrhythaflutter: [], arrhythvv: [],
    arrhythsss: [], arrhythsecond: [], arrhyththird: [], prvalveproc: [],
    pocpci: [], pocint: [],
    tab: "Clinical Summary",
    "decline:shiny.action": 0, "reset:shiny.action": 0,
    "copybuttonestimates:shiny.action": 0, "copybuttonsummary:shiny.action": 0,
    vstrpr: false,
    "ageN:shiny.number": null, "heightN:shiny.number": null,
    "weightN:shiny.number": null, "BMI:shiny.number": null,
    "creatlstN:shiny.number": null, "hctN:shiny.number": null,
    "wbcN:shiny.number": null, "plateletsN:shiny.number": null,
    "medadpidis:shiny.number": null, "hdef:shiny.number": null,
    ".clientdata_output_errorMessage_hidden": false,
    ".clientdata_output_text2_hidden": false,
    ".clientdata_output_summary_hidden": false,
    ".clientdata_pixelratio": 1,
    ".clientdata_url_protocol": "https:",
    ".clientdata_url_hostname": "acsdriskcalc.research.sts.org",
    ".clientdata_url_port": "", ".clientdata_url_pathname": "/",
    ".clientdata_url_search": "", ".clientdata_url_hash_initial": "",
    ".clientdata_url_hash": "",
    ".clientdata_singletons": "",
    ".clientdata_allowDataUriScheme": true,
  };
  STS_BOOLEAN_FIELDS.forEach((f) => (d[f] = false));
  return d;
}

function stsBuildUpdate() {
  const heightCm = toCm(num("sts-height"), $("sts-height-unit").value);
  const weightKg = toKg(num("sts-weight"), $("sts-weight-unit").value);
  const bmi = weightKg / Math.pow(heightCm / 100, 2);

  const u = {
    Proc: [$("sts-procedure").value],
    status: [$("sts-status").value],
    incidenc: [$("sts-incidence").value],
    gender: [$("sts-sex").value],
    "ageN:shiny.number": Math.round(num("sts-age")),
    "heightN:shiny.number": round(heightCm, 1),
    "weightN:shiny.number": round(weightKg, 1),
    "BMI:shiny.number": round(bmi, 2),
  };

  if ($("sts-ef").value !== "") u["hdef:shiny.number"] = num("sts-ef");
  if ($("sts-creat").value !== "") u["creatlstN:shiny.number"] = num("sts-creat");
  if ($("sts-nyha").value === "iv") u.classnyh = ["Class IV"];

  const diabetes = $("sts-diabetes").value;
  if (diabetes) u.diabetes = [diabetes];
  const lung = $("sts-lung").value;
  if (lung) u.chrlungd = [lung];
  const cvd = $("sts-cvd").value;
  if (cvd) u.cvd = [cvd];
  const presentation = $("sts-presentation").value;
  if (presentation) u.cardsymptimeofadm = [presentation];

  if ($("sts-htn").checked) u.hypertn = true;
  if ($("sts-dialysis").checked) u.dialysis = true;
  if ($("sts-pvd").checked) u.pvd = true;
  if ($("sts-immuno").checked) u.immsupp = true;
  if ($("sts-shock").checked) u.carshock = true;

  return u;
}

function stsParseResult(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const cells = Array.from(doc.querySelectorAll("td"));
  const found = {};
  for (let i = 0; i < cells.length - 1; i++) {
    const label = cells[i].textContent.trim();
    for (const [needle, name] of STS_OUTCOMES) {
      if (label.indexOf(needle) === 0) {
        const m = cells[i + 1].textContent.match(/([\d.]+)\s*%/);
        if (m) found[name] = parseFloat(m[1]);
      }
    }
  }
  return found;
}

function setStsState(msg, kind) {
  const el = $("sts-state");
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.className = "sts-status " + (kind || "");
  el.textContent = msg;
}

function stsRenderResults(found) {
  const mort = found["Operative Mortality"];
  $("res-sts").textContent = mort != null ? mort + "%" : "N/A";
  $("res-sts-proc").textContent = "Procedure: " + $("sts-procedure").value;

  const grid = $("sts-secondary");
  grid.innerHTML = "";
  STS_OUTCOMES.slice(1).forEach(([, name]) => {
    if (found[name] == null) return;
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML =
      `<h3>${name}</h3><p class="big small">${found[name]}%</p>`;
    grid.appendChild(card);
  });

  $("sts-guidance").innerHTML =
    "Estimates returned directly by the official STS Adult Cardiac Surgery Risk Calculator.";
  $("sts-results").hidden = false;
}

function stsQuery() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws && ws.close(); } catch (_) {}
      reject(new Error("Timed out waiting for the STS calculator."));
    }, 25000);

    try {
      ws = new WebSocket(STS_WS_URL);
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }

    ws.addEventListener("open", () => {
      ws.send('{"method":"init","data":' + JSON.stringify(stsInitData()) + "}");
      setTimeout(() => {
        ws.send('{"method":"update","data":' + JSON.stringify(stsBuildUpdate()) + "}");
      }, 1200);
    });

    ws.addEventListener("message", (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch (_) { return; }
      const vals = data.values;
      if (vals && vals.text2 && typeof vals.text2.html === "string" && vals.text2.html.indexOf("%") !== -1) {
        const found = stsParseResult(vals.text2.html);
        if (found["Operative Mortality"] != null) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch (_) {}
          resolve(found);
        }
      }
    });

    ws.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Could not reach the STS calculator (network or connection blocked)."));
    });

    ws.addEventListener("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Connection to the STS calculator closed before a result was received."));
    });
  });
}

stsForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const age = num("sts-age");
  const height = num("sts-height");
  const weight = num("sts-weight");
  const checks = [
    [$("sts-age"), !(age >= 18 && age <= 110)],
    [$("sts-height"), !(height > 0)],
    [$("sts-weight"), !(weight > 0)],
  ];
  let invalid = false;
  checks.forEach(([el, bad]) => {
    flagInvalid(el, bad);
    if (bad) invalid = true;
  });
  if (invalid) {
    $("sts-results").hidden = true;
    setStsState("Please provide a valid age, height, and weight.", "error");
    return;
  }

  const btn = $("sts-submit");
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = "Contacting STS\u2026";
  setStsState("Contacting the official STS risk calculator\u2026", "loading");

  try {
    const found = await stsQuery();
    setStsState("", "");
    stsRenderResults(found);
  } catch (err) {
    $("sts-results").hidden = true;
    setStsState(
      (err && err.message ? err.message : "Request failed.") +
        " The STS calculator must be reachable from your browser.",
      "error"
    );
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

stsForm.addEventListener("reset", () => {
  $("sts-results").hidden = true;
  setStsState("", "");
  stsForm.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
});

/* ============================================================
   3) CHA2DS2-VASc (live scoring)
   ============================================================ */
const chadsForm = $("chadsvasc-form");

const chadsRisk = {
  0: "0.2&#37;",
  1: "0.6&#37;",
  2: "2.2&#37;",
  3: "3.2&#37;",
  4: "4.8&#37;",
  5: "7.2&#37;",
  6: "9.7&#37;",
  7: "11.2&#37;",
  8: "10.8&#37;",
  9: "12.2&#37;",
};

function computeChadsVasc() {
  let score = 0;
  chadsForm.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    if (cb.checked) score += parseInt(cb.dataset.points, 10);
  });
  score += parseInt($("cv-age").value, 10);
  score += parseInt($("cv-sex").value, 10);

  $("res-chadsvasc").textContent = score;
  $("res-chadsvasc-risk").innerHTML = `Adjusted stroke risk &asymp; ${chadsRisk[score]} per year`;

  let advice;
  const female = $("cv-sex").value === "1";
  if (score === 0 || (score === 1 && female)) {
    advice = "Low risk &mdash; oral anticoagulation generally not recommended.";
  } else if (score === 1 && !female) {
    advice = "Consider oral anticoagulation (clinical judgement).";
  } else {
    advice = "Oral anticoagulation is generally recommended.";
  }
  $("chadsvasc-guidance").innerHTML = advice;
}

chadsForm.addEventListener("input", computeChadsVasc);
chadsForm.addEventListener("change", computeChadsVasc);

/* ============================================================
   4) HAS-BLED (live scoring)
   ============================================================ */
const hbForm = $("hasbled-form");

const hbRisk = {
  0: "1.13",
  1: "1.02",
  2: "1.88",
  3: "3.74",
  4: "8.70",
  5: "12.50",
};

function computeHasBled() {
  let score = 0;
  hbForm.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    if (cb.checked) score += parseInt(cb.dataset.points, 10);
  });

  $("res-hasbled").textContent = score;
  const bleedsPer100 = hbRisk[score] || "&gt; 12.50";
  $("res-hasbled-risk").innerHTML = `&asymp; ${bleedsPer100} major bleeds / 100 patient-years`;

  let advice;
  if (score <= 2) {
    advice = "Low&ndash;moderate bleeding risk &mdash; anticoagulation generally reasonable with monitoring.";
  } else {
    advice =
      "Score &ge; 3 indicates high bleeding risk &mdash; use caution, address modifiable factors, and review regularly.";
  }
  $("hasbled-guidance").innerHTML = advice;
}

hbForm.addEventListener("input", computeHasBled);
hbForm.addEventListener("change", computeHasBled);

/* ============================================================
   Initialise live scores on load
   ============================================================ */
computeChadsVasc();
computeHasBled();
