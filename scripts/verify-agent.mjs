import { chromium } from "playwright";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

try {
  await page.goto("http://localhost:3000/orchestration", { waitUntil: "networkidle" });
  await sleep(2500);
  const shell = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      header: t.includes("卫星智能体分析"),
      nav: t.includes("数据面板") && t.includes("3D 星图"),
      attach: t.includes("附加卫星图像"),
      offlineBanner: t.includes("未连接到 Agent 后端"),
      textarea: !!document.querySelector("textarea"),
      sidePanels: t.includes("AgentCard Registry") || t.includes("交付物栈"), // should be FALSE now
    };
  });
  console.log("SHELL:", JSON.stringify(shell));

  // Send a text analysis request.
  const ta = page.locator("textarea").last();
  await ta.click();
  await ta.fill("分析这片港口区域的船只与设施");
  await page.keyboard.press("Enter");
  await sleep(9000);
  const afterText = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      assistantReplied: t.includes("协调员") || t.includes("报告员") || t.includes("Coordinator"),
      toolCard: (t.match(/🛠/g) || []).length,
      toolNames: ["geo_locate", "tle_lookup", "detect_objects", "segment_image"].filter((n) => t.includes(n)),
    };
  });
  console.log("AFTER_TEXT:", JSON.stringify(afterText));
  await page.screenshot({ path: "scripts/shot-agent-text.png" });

  // Attach a REAL image (the screenshot we just captured decodes fine) → expect overlay.
  await page.setInputFiles('input[type="file"]', "scripts/shot-agent-text.png");
  await sleep(800);
  const ta2 = page.locator("textarea").last();
  await ta2.click();
  await ta2.fill("对附加的卫星图像做目标检测与分割");
  await page.keyboard.press("Enter");
  await sleep(10000);
  const afterImg = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      attachedChip: t.includes("scene.png"),
      segOrDetect: ["segment_image", "detect_objects"].filter((n) => t.includes(n)),
      svgOverlayRects: document.querySelectorAll("svg rect").length,
      toolCards: (t.match(/🛠/g) || []).length,
    };
  });
  console.log("AFTER_IMAGE:", JSON.stringify(afterImg));
  await page.screenshot({ path: "scripts/shot-agent-image.png", fullPage: true });

  console.log("ERRORS:", errors.length);
  for (const e of errors.slice(0, 8)) console.log("  !", e);
} catch (e) {
  console.log("SCRIPT ERROR:", e.message);
} finally {
  await browser.close();
}
