import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const out = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

async function shot(name) {
  await page.screenshot({ path: `scripts/shot-${name}.png`, fullPage: false });
  out(`  screenshot -> scripts/shot-${name}.png`);
}

try {
  // ---------- /orchestration ----------
  out("\n=== /orchestration ===");
  await page.goto(`${BASE}/orchestration`, { waitUntil: "networkidle" });
  await sleep(14000); // kickoff (400ms) + chat round-trip + ~7s replay stream
  const orch = await page.evaluate(() => {
    const text = document.body.innerText;
    const count = (re) => (text.match(re) || []).length;
    return {
      agentCards: text.includes("Agent0 Host Orchestrator"),
      workflowFilled: text.includes("Discover AgentCards") || text.includes("Normalize Sources"),
      artifacts: text.includes("来源归并") || text.includes("交付物栈"),
      finalResult: text.includes("A2A 协作完成") || text.includes("Final Result"),
      toolCalls: count(/message\/stream|tasks\/artifact|tasks\/get|agent\//g),
      narration: text.includes("Host Agent") || text.includes("Source Ingestion"),
      taskUpdates: (document.body.innerText.match(/Task updates[\s\S]{0,20}?(\d+)/) || [])[1],
    };
  });
  out("  " + JSON.stringify(orch));
  await shot("orchestration");

  // ---------- /dashboard ----------
  out("\n=== /dashboard ===");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await sleep(5000);
  const beforeCount = await page.evaluate(() => (document.body.innerText.match(/score \d/g) || []).length);
  const dashInit = await page.evaluate(() => ({
    feed: document.body.innerText.includes("资讯流"),
    trends: document.body.innerText.includes("主题趋势"),
    briefing: document.body.innerText.includes("运营简报"),
  }));
  out("  init " + JSON.stringify(dashInit) + " visibleItems(before)=" + beforeCount);

  // Type into the CopilotChat input and submit.
  const ta = await page.locator("textarea, input[type=text]").last();
  await ta.click();
  await ta.fill("筛选 SpaceNews 订阅源 的动态");
  await page.keyboard.press("Enter");
  await sleep(6000);
  const afterCount = await page.evaluate(() => (document.body.innerText.match(/score \d/g) || []).length);
  const activeFilter = await page.evaluate(() => {
    const m = document.body.innerText.match(/当前筛选[\s\S]{0,30}?(SpaceNews[^\n]*|全部)/);
    return m ? m[1] : null;
  });
  out(`  after filter: visibleItems(after)=${afterCount} activeFilter=${activeFilter}`);
  await shot("dashboard");

  // ---------- /globe ----------
  out("\n=== /globe ===");
  await page.goto(`${BASE}/globe`, { waitUntil: "networkidle" });
  await sleep(8000); // let WebGL + textures load
  const globe = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return {
      hasCanvas: !!canvas,
      canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
      satListCount: (document.body.innerText.match(/\d+km/g) || []).length,
      countryChips: document.body.innerText.includes("美国") && document.body.innerText.includes("中国"),
    };
  });
  out("  " + JSON.stringify(globe));
  await shot("globe-initial");

  // Click the first satellite in the list and check the detail panel.
  const satBtn = page.locator("button", { hasText: "km" }).first();
  let detail = "n/a";
  if (await satBtn.count()) {
    await satBtn.click();
    await sleep(1500);
    detail = await page.evaluate(() => {
      const t = document.body.innerText;
      return t.includes("NORAD ID") && t.includes("当前高度") ? "detail-panel-shown" : "no-detail";
    });
  }
  out("  click satellite -> " + detail);
  await shot("globe-detail");

  out("\n=== console/page errors (" + errors.length + ") ===");
  for (const e of errors.slice(0, 12)) out("  ! " + e);
} catch (e) {
  out("SCRIPT ERROR: " + e.message);
} finally {
  await browser.close();
}
