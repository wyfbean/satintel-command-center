"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import * as satellite from "satellite.js";

import { SiteNav } from "@/components/site-nav";
import { satelliteCatalog, type FlagshipSatellite } from "@/lib/satellites/catalog";
import type { CsvSatellite } from "@/app/api/satellites/route";

const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });

const EARTH_RADIUS_KM = 6371;
const GLOBE_TEXTURE    = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
const NIGHT_BG         = "https://unpkg.com/three-globe/example/img/night-sky.png";

/* ── unified object type ─────────────────────────────────────────── */

type GlobeSat = {
  id: string;
  name: string;
  country: string;
  agency: string;
  purpose: string;
  orbitClass: string;
  users?: string;
  inclinationDeg?: number;
  perigeeKm?: number;
  apogeeKm?: number;
  launchYear?: number;
  noradId?: number;
  color: string;
  flagship: boolean;
  lat: number;
  lng: number;
  altKm: number;
  tle: { line1: string; line2: string };
} & (FlagshipSatellite | CsvSatellite);

/* ── filter constants ────────────────────────────────────────────── */

const ORBIT_CLASSES = ["全部", "LEO", "MEO", "GEO", "HEO", "Elliptical"];
const PURPOSES = [
  "全部",
  "Earth Observation",
  "Communications",
  "Navigation",
  "Technology Development",
  "Earth Science",
  "Space Science",
  "Meteorology",
];
const USER_TYPES = ["全部", "Commercial", "Government", "Military", "Civil"];

/* ── fast Keplerian position (~0.005 ms/sat, ~38 ms for 7 500) ───── */

const MU = 398600.4418; // km³/s²

function keplerianPos(
  perigeeKm: number,
  apogeeKm: number,
  inclinationDeg: number,
  noradId: number,
  periodMin: number,
  now: Date,
): { lat: number; lng: number; altKm: number } | null {
  const altKm = (perigeeKm + apogeeKm) / 2;
  if (altKm < 100) return null;

  const period = periodMin > 0
    ? periodMin
    : (2 * Math.PI * Math.sqrt(Math.pow(EARTH_RADIUS_KM + altKm, 3) / MU)) / 60;

  const incRad = inclinationDeg * (Math.PI / 180);

  // Deterministic initial angles — golden-angle spread (same as TLE builder)
  const raan0 = ((noradId * 137.508) % 360) * (Math.PI / 180);
  const m0    = ((noradId * 137.508 * 2.236) % 360) * (Math.PI / 180);

  const tMin       = now.getTime() / 60000;
  const meanMotion = (2 * Math.PI) / period;
  const M          = m0 + meanMotion * tMin;

  const cosM = Math.cos(M), sinM = Math.sin(M);
  const cosR = Math.cos(raan0), sinR = Math.sin(raan0);
  const cosI = Math.cos(incRad), sinI = Math.sin(incRad);

  const xEci = cosM * cosR - sinM * cosI * sinR;
  const yEci = cosM * sinR + sinM * cosI * cosR;
  const zEci = sinM * sinI;

  const gmst   = satellite.gstime(now);
  const lat    = Math.asin(Math.max(-1, Math.min(1, zEci))) * (180 / Math.PI);
  const lngEci = Math.atan2(yEci, xEci);
  const lngGeo = lngEci - gmst;
  const lngDeg = ((lngGeo * (180 / Math.PI)) % 360 + 360) % 360;

  return { lat, lng: lngDeg > 180 ? lngDeg - 360 : lngDeg, altKm };
}

/* ── hook: load all satellites from SQLite-backed API ─────────────── */

function useCsvSatellites() {
  const [all, setAll]         = useState<CsvSatellite[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/satellites")
      .then((r) => r.json())
      .then((d: CsvSatellite[]) => setAll(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { all, loading };
}

/* ── small helpers ───────────────────────────────────────────────── */

function flagshipOrbitClass(mm: number): "LEO" | "MEO" | "GEO" {
  if (mm > 5)   return "LEO";
  if (mm > 1.1) return "MEO";
  return "GEO";
}

const PURPOSE_TO_CATEGORY: Record<string, string> = {
  "Earth Observation":      "对地观测",
  "Communications":         "通信",
  "Navigation":             "导航",
  "Space Science":          "科学",
  "Earth Science":          "科学",
  "Meteorology":            "气象",
  "Technology Development": "",
};

function purposeZh(p: string): string {
  const map: Record<string, string> = {
    "Earth Observation":      "对地观测",
    "Communications":         "通信",
    "Navigation":             "导航",
    "Technology Development": "技术研发",
    "Earth Science":          "地球科学",
    "Space Science":          "空间科学",
    "Meteorology":            "气象",
  };
  return map[p] ?? p;
}

function usersZh(u: string): string {
  const map: Record<string, string> = {
    Commercial: "商业", Government: "政府", Military: "军事", Civil: "民用",
  };
  return map[u] ?? u;
}

const COUNTRY_ZH: Record<string, string> = {
  USA: "美国", "United States": "美国",
  "United Kingdom": "英国", China: "中国", Russia: "俄罗斯", Japan: "日本",
  Multinational: "多国", ESA: "欧空局", Canada: "加拿大", India: "印度",
  Luxembourg: "卢森堡", Argentina: "阿根廷", Germany: "德国", France: "法国",
  Israel: "以色列", Finland: "芬兰", Spain: "西班牙", Australia: "澳大利亚",
  "South Korea": "韩国", Brazil: "巴西", Italy: "意大利", Turkey: "土耳其",
  Netherlands: "荷兰", "United Arab Emirates": "阿联酋", Switzerland: "瑞士",
  Taiwan: "中国台湾", "Saudi Arabia": "沙特阿拉伯", Norway: "挪威",
  Singapore: "新加坡", Indonesia: "印度尼西亚", Mexico: "墨西哥", Egypt: "埃及",
  Thailand: "泰国", Denmark: "丹麦", Kazakhstan: "哈萨克斯坦", Lithuania: "立陶宛",
  Algeria: "阿尔及利亚", "South Africa": "南非", Poland: "波兰", Sweden: "瑞典",
  Belgium: "比利时", Austria: "奥地利", Vietnam: "越南", Pakistan: "巴基斯坦",
  Iran: "伊朗", Nigeria: "尼日利亚", Chile: "智利", Ukraine: "乌克兰",
  Bolivia: "玻利维亚", Venezuela: "委内瑞拉", Peru: "秘鲁", Greece: "希腊",
  Portugal: "葡萄牙", Ireland: "爱尔兰", "New Zealand": "新西兰",
  Belarus: "白俄罗斯", Azerbaijan: "阿塞拜疆", Morocco: "摩洛哥",
  Qatar: "卡塔尔", Malaysia: "马来西亚", Philippines: "菲律宾",
  Bangladesh: "孟加拉国", Bulgaria: "保加利亚", Estonia: "爱沙尼亚",
  "Czech Republic": "捷克", Hungary: "匈牙利", Romania: "罗马尼亚",
  Unknown: "未知",
};
function countryZh(c: string): string {
  return COUNTRY_ZH[c] ?? c;
}

/* ── main component ──────────────────────────────────────────────── */

export function GlobeShell() {
  const [tick, setTick]               = useState(0);
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [size, setSize]               = useState({ width: 800, height: 560 });
  const containerRef                  = useRef<HTMLDivElement>(null);

  const [orbitClass,    setOrbitClass]    = useState("全部");
  const [purposeFilter, setPurposeFilter] = useState("全部");
  const [usersFilter,   setUsersFilter]   = useState("全部");
  const [countrySearch, setCountrySearch] = useState("");
  const [showFlagships, setShowFlagships] = useState(true);

  const { all: allCsvSats, loading } = useCsvSatellites();

  // ── Client-side filtering ────────────────────────────────────────────
  const csvSats = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    return allCsvSats.filter((s) => {
      if (orbitClass !== "全部"    && s.orbitClass !== orbitClass)   return false;
      if (purposeFilter !== "全部" && s.purpose   !== purposeFilter) return false;
      if (usersFilter !== "全部"   && s.users     !== usersFilter)   return false;
      if (q && !s.country.toLowerCase().includes(q) && !countryZh(s.country).includes(q)) return false;
      return true;
    });
  }, [allCsvSats, orbitClass, purposeFilter, usersFilter, countrySearch]);

  const filteredFlagships = useMemo(() => {
    if (!showFlagships) return [];
    const q = countrySearch.trim().toLowerCase();
    const purposeCat = purposeFilter !== "全部" ? PURPOSE_TO_CATEGORY[purposeFilter] : null;
    return satelliteCatalog.filter((sat) => {
      if (orbitClass !== "全部") {
        if (flagshipOrbitClass(sat.orbit.meanMotionRevPerDay) !== orbitClass) return false;
      }
      if (purposeCat !== null) {
        if (!purposeCat) return false;
        if ((sat as unknown as { category: string }).category !== purposeCat) return false;
      }
      if (q && !sat.country.toLowerCase().includes(q)) return false;
      if (usersFilter === "Commercial") return false;
      return true;
    });
  }, [showFlagships, orbitClass, purposeFilter, usersFilter, countrySearch]);

  // Parse TLEs once for orbit-ring rendering (SGP4 on selected sat only)
  const satrecs = useMemo(() => {
    const map = new Map<string, ReturnType<typeof satellite.twoline2satrec>>();
    for (const sat of satelliteCatalog) {
      map.set(sat.id, satellite.twoline2satrec(sat.tle.line1, sat.tle.line2));
    }
    for (const sat of allCsvSats) {
      map.set(sat.id, satellite.twoline2satrec(sat.tle.line1, sat.tle.line2));
    }
    return map;
  }, [allCsvSats]);

  // ── Stable mutable objects for CSV satellites ─────────────────────────
  // Keeping stable references means ThreeGlobe reuses existing Three.js meshes
  // on every tick (just repositioning them) instead of recreating all 7 500.
  const csvSatStable = useRef<GlobeSat[]>([]);

  // When the filtered CSV sat list changes (filter applied), sync stable objects.
  useEffect(() => {
    const prev = new Map(csvSatStable.current.map((o) => [o.id, o]));
    csvSatStable.current = csvSats.map((sat) => {
      const existing = prev.get(sat.id);
      if (existing) return existing; // keep the same object reference
      return { ...sat, lat: 0, lng: 0, altKm: 0, flagship: false } as unknown as GlobeSat;
    });
  }, [csvSats]);

  // Tick interval: slower for large catalogs
  useEffect(() => {
    const ms = allCsvSats.length > 2000 ? 5000 : allCsvSats.length > 200 ? 2000 : 1000;
    const t = setInterval(() => setTick((v) => v + 1), ms);
    return () => clearInterval(t);
  }, [allCsvSats.length]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const upd = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    upd();
    const obs = new ResizeObserver(upd);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Flagship satellites — SGP4, fresh each tick (small count) ─────────
  const liveFlagships = useMemo<GlobeSat[]>(() => {
    const now  = new Date();
    const gmst = satellite.gstime(now);
    const result: GlobeSat[] = [];
    for (const sat of filteredFlagships) {
      const satrec = satrecs.get(sat.id);
      if (!satrec) continue;
      const pv  = satellite.propagate(satrec, now);
      const eci = pv && typeof pv === "object" ? (pv as { position?: unknown }).position : undefined;
      if (!eci || typeof eci !== "object") continue;
      const geo = satellite.eciToGeodetic(eci as satellite.EciVec3<number>, gmst);
      result.push({
        ...sat,
        lat:      satellite.degreesLat(geo.latitude),
        lng:      satellite.degreesLong(geo.longitude),
        altKm:    geo.height,
        flagship: true,
      } as unknown as GlobeSat);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, satrecs, filteredFlagships]);

  // ── CSV satellites — Keplerian, mutate stable refs in-place ───────────
  // Shallow copy gives ThreeGlobe a new array reference (so it re-evaluates
  // objectLat/Lng/Altitude) while the SAME datum references mean it reuses
  // existing Three.js meshes rather than recreating them.
  const liveCsvSats = useMemo<GlobeSat[]>(() => {
    const now = new Date();
    for (const obj of csvSatStable.current) {
      const s = obj as CsvSatellite & GlobeSat;
      const pos = keplerianPos(s.perigeeKm, s.apogeeKm, s.inclinationDeg, s.noradId, s.periodMin, now);
      if (pos) { obj.lat = pos.lat; obj.lng = pos.lng; obj.altKm = pos.altKm; }
    }
    return [...csvSatStable.current]; // new array, same item refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // Combined list for objectsData
  const allLiveSats = useMemo<GlobeSat[]>(
    () => [...liveFlagships, ...liveCsvSats],
    [liveFlagships, liveCsvSats],
  );

  const selected = useMemo(
    () => allLiveSats.find((s) => s.id === selectedId) ?? null,
    [allLiveSats, selectedId],
  );

  // Orbital ring — must use the SAME propagation method as the displayed dot.
  // Flagship sats use SGP4 for both position and ring (consistent).
  // CSV sats use Keplerian for both: the TLE epoch (2026-day-80) differs from the
  // Unix-epoch reference used by keplerianPos, so SGP4 ring ≠ Keplerian dot.
  // Frozen gmst closes the ring: all samples share the same Earth-rotation angle,
  // producing the orbital plane ring rather than a drifting ground track.
  const orbitPath = useMemo<[number, number, number][]>(() => {
    if (!selectedId) return [];

    const sat = allLiveSats.find((s) => s.id === selectedId);
    const ORBIT_SAMPLES = 180;

    // ── Flagship: SGP4 ──────────────────────────────────────────────────
    if (!sat || sat.flagship) {
      const satrec = satrecs.get(selectedId);
      if (!satrec) return [];
      const periodMin = (2 * Math.PI) / satrec.no;
      const startMs   = Date.now();
      const gmst      = satellite.gstime(new Date(startMs));
      const points: [number, number, number][] = [];
      for (let i = 0; i <= ORBIT_SAMPLES; i++) {
        const t   = new Date(startMs + (i / ORBIT_SAMPLES) * periodMin * 60_000);
        const pv  = satellite.propagate(satrec, t);
        const eci = pv && typeof pv === "object" ? (pv as { position?: unknown }).position : undefined;
        if (!eci || typeof eci !== "object") continue;
        const geo = satellite.eciToGeodetic(eci as satellite.EciVec3<number>, gmst);
        points.push([satellite.degreesLat(geo.latitude), satellite.degreesLong(geo.longitude), geo.height]);
      }
      return points;
    }

    // ── CSV: Keplerian (matches keplerianPos display) ───────────────────
    const s       = sat as CsvSatellite & GlobeSat;
    const altKm   = (s.perigeeKm + s.apogeeKm) / 2;
    const period  = s.periodMin > 0
      ? s.periodMin
      : (2 * Math.PI * Math.sqrt(Math.pow(EARTH_RADIUS_KM + altKm, 3) / MU)) / 60;
    const incRad  = s.inclinationDeg * (Math.PI / 180);
    const raan0   = ((s.noradId * 137.508) % 360) * (Math.PI / 180);
    const m0      = ((s.noradId * 137.508 * 2.236) % 360) * (Math.PI / 180);
    const mm      = (2 * Math.PI) / period; // rad/min
    const tMinNow = Date.now() / 60000;
    // Freeze gmst at "now" so all samples use the same Earth-rotation angle
    const gmstFrozen = satellite.gstime(new Date(Date.now()));
    const cosR = Math.cos(raan0), sinR = Math.sin(raan0);
    const cosI = Math.cos(incRad), sinI = Math.sin(incRad);

    const points: [number, number, number][] = [];
    for (let i = 0; i <= ORBIT_SAMPLES; i++) {
      const M    = m0 + mm * (tMinNow + (i / ORBIT_SAMPLES) * period);
      const cosM = Math.cos(M), sinM = Math.sin(M);
      const xEci = cosM * cosR - sinM * cosI * sinR;
      const yEci = cosM * sinR + sinM * cosI * cosR;
      const zEci = sinM * sinI;
      const lat    = Math.asin(Math.max(-1, Math.min(1, zEci))) * (180 / Math.PI);
      const lngEci = Math.atan2(yEci, xEci);
      const lngGeo = lngEci - gmstFrozen;
      const lngDeg = ((lngGeo * (180 / Math.PI)) % 360 + 360) % 360;
      points.push([lat, lngDeg > 180 ? lngDeg - 360 : lngDeg, altKm]);
    }
    return points;
  }, [selectedId, allLiveSats, satrecs]);

  // ── Three.js geometry + material caches ───────────────────────────────
  // geoSmall is shared across ALL csv satellite meshes (no per-sat geometry).
  // Materials are cached per color string (at most ~10 unique colors).
  const geoSmall = useMemo(() => new THREE.SphereGeometry(0.5, 4, 4), []);
  const geoBig   = useMemo(() => new THREE.SphereGeometry(2.0, 12, 12), []);
  const matCache = useRef(new Map<string, THREE.MeshBasicMaterial>());

  function getBasicMat(color: string) {
    let mat = matCache.current.get(color);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color });
      matCache.current.set(color, mat);
    }
    return mat;
  }

  // Mesh ref map so we can update scale on selection without recreating objects.
  const meshRefs = useRef(new Map<string, THREE.Mesh>());

  const makeObject = useCallback((d: object) => {
    const sat = d as GlobeSat;
    let mesh: THREE.Mesh;
    if (sat.flagship) {
      const mat = new THREE.MeshLambertMaterial({
        color: sat.color,
        emissive: new THREE.Color(sat.color),
        emissiveIntensity: 0.5,
      });
      mesh = new THREE.Mesh(geoBig, mat);
    } else {
      mesh = new THREE.Mesh(geoSmall, getBasicMat(sat.color));
    }
    meshRefs.current.set(sat.id, mesh);
    return mesh;
    // makeObject must NOT depend on selectedId — it's called once per new datum,
    // not on every re-render. Selection highlight is applied in the useEffect below.
  }, [geoBig, geoSmall]);

  // Update selection scale on all cached meshes when selectedId changes.
  useEffect(() => {
    meshRefs.current.forEach((mesh, id) => {
      mesh.scale.setScalar(id === selectedId ? 2.0 : 1.0);
    });
  }, [selectedId]);

  // Country chips
  const countryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of csvSats) m.set(s.country, (m.get(s.country) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [csvSats]);

  const totalVisible    = allLiveSats.length;
  const csvVisible      = liveCsvSats.length;
  const flagshipVisible = liveFlagships.length;
  const hasActiveFilter =
    orbitClass !== "全部" || purposeFilter !== "全部" ||
    usersFilter !== "全部" || countrySearch.trim().length > 0;

  return (
    <main className="min-h-screen bg-[#05070f] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-5">

        <header className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-sm font-semibold text-white">全球卫星 3D 星图</div>
              <div className="mt-0.5 text-xs text-slate-400">
                {loading
                  ? "加载中…"
                  : hasActiveFilter
                    ? `筛选结果：${totalVisible} 颗（${csvVisible} 颗 · ${flagshipVisible} 旗舰），共 ${allCsvSats.length + satelliteCatalog.length} 颗`
                    : `${totalVisible} 颗可见（${csvVisible} 颗 · ${flagshipVisible} 旗舰）`
                }
                {" · "}react-globe.gl · satellite.js SGP4
              </div>
            </div>
            <SiteNav variant="dark" />
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div ref={containerRef}
            className="relative h-[72vh] overflow-hidden rounded-[28px] border border-white/10 bg-black">
            <Globe
              width={size.width}
              height={size.height}
              globeImageUrl={GLOBE_TEXTURE}
              backgroundImageUrl={NIGHT_BG}
              backgroundColor="#05070f"

              /* All satellites via objectsData (flagship 3D spheres + CSV tiny spheres) */
              objectsData={allLiveSats}
              objectLat={(d: object) => (d as GlobeSat).lat}
              objectLng={(d: object) => (d as GlobeSat).lng}
              objectAltitude={(d: object) => (d as GlobeSat).altKm / EARTH_RADIUS_KM}
              objectLabel={(d: object) => {
                const s = d as GlobeSat;
                return `<div style="font-size:12px;line-height:1.5"><b>${s.name}</b><br/>${s.country} · ${purposeZh(s.purpose)}<br/>${s.orbitClass} · ${Math.round(s.altKm)} km</div>`;
              }}
              objectThreeObject={makeObject}
              onObjectClick={(d: object) => setSelectedId((d as GlobeSat).id)}

              /* Orbital ring for selected satellite */
              pathsData={selected ? [orbitPath] : []}
              pathPoints={(d: object) => d as [number, number, number][]}
              pathPointLat={(p: object) => (p as [number, number, number])[0]}
              pathPointLng={(p: object) => (p as [number, number, number])[1]}
              pathPointAlt={(p: object) => (p as [number, number, number])[2] / EARTH_RADIUS_KM}
              pathColor={() => (selected ? `${selected.color}cc` : "#ffffff")}
              pathStroke={selected?.flagship ? 1.4 : 1}
              pathTransitionDuration={0}
            />
            {loading && (
              <div className="pointer-events-none absolute right-4 top-4 rounded-xl bg-black/60 px-3 py-1.5 text-xs text-amber-300 backdrop-blur">
                加载全部卫星…
              </div>
            )}
          </div>

          <aside className="flex flex-col gap-4 xl:overflow-y-auto xl:max-h-[72vh] xl:pr-1">

            <Panel title="筛选器">
              <div className="mb-3">
                <div className="mb-1.5 text-[10px] text-slate-400">轨道类型</div>
                <div className="flex flex-wrap gap-1.5">
                  {ORBIT_CLASSES.map((o) => (
                    <Chip key={o} label={o} active={orbitClass === o} onClick={() => setOrbitClass(o)} />
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <div className="mb-1.5 text-[10px] text-slate-400">用途</div>
                <div className="flex flex-wrap gap-1.5">
                  {PURPOSES.map((p) => (
                    <Chip key={p}
                      label={p === "全部" ? "全部" : purposeZh(p)}
                      active={purposeFilter === p}
                      onClick={() => setPurposeFilter(p)}
                    />
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <div className="mb-1.5 text-[10px] text-slate-400">运营方性质</div>
                <div className="flex flex-wrap gap-1.5">
                  {USER_TYPES.map((u) => (
                    <Chip key={u}
                      label={u === "全部" ? "全部" : usersZh(u)}
                      active={usersFilter === u}
                      onClick={() => setUsersFilter(u)}
                      danger={u === "Military" && usersFilter === "Military"}
                    />
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <div className="mb-1.5 text-[10px] text-slate-400">国家 / 地区搜索</div>
                <input
                  type="text"
                  value={countrySearch}
                  onChange={(e) => setCountrySearch(e.target.value)}
                  placeholder="输入国家名称（中 / 英）"
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-[#3d74ff] focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={showFlagships}
                  onChange={(e) => setShowFlagships(e.target.checked)}
                  className="accent-[#3d74ff]"
                />
                显示旗舰卫星（{satelliteCatalog.length} 颗高亮）
              </label>
            </Panel>

            {countryCounts.length > 0 && (
              <Panel title="国家分布（当前结果）">
                <div className="flex flex-wrap gap-1.5">
                  {countryCounts.map(([country, cnt]) => (
                    <button key={country} type="button"
                      onClick={() => setCountrySearch(countrySearch === country ? "" : country)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${
                        countrySearch === country ? "border-white/50 bg-white/15 text-white" : "border-white/15 text-slate-300 hover:bg-white/5"
                      }`}
                    >
                      {countryZh(country)} <span className="text-slate-500">{cnt}</span>
                    </button>
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="卫星详情">
              {selected ? (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full flex-none" style={{ background: selected.color }} />
                    <span className="text-sm font-semibold text-white">{selected.name}</span>
                    {selected.flagship && (
                      <span className="rounded-full bg-[#3d74ff]/30 px-2 py-0.5 text-[10px] text-[#7fb0ff]">旗舰</span>
                    )}
                  </div>
                  <dl className="mt-3 space-y-1.5 text-xs">
                    <Row k="国家 / 机构"     v={`${countryZh(selected.country)} · ${selected.agency}`} />
                    <Row k="用途"            v={purposeZh(selected.purpose)} />
                    <Row k="轨道类型"        v={`${selected.orbitClass}${(selected as { orbitType?: string }).orbitType ? " / " + (selected as { orbitType?: string }).orbitType : ""}`} />
                    {selected.noradId && <Row k="NORAD ID" v={String(selected.noradId)} />}
                    {selected.launchYear && <Row k="发射年份" v={String(selected.launchYear)} />}
                    {(selected.perigeeKm || selected.apogeeKm) && (
                      <Row k="近地点 / 远地点" v={`${Math.round(selected.perigeeKm ?? 0)} km / ${Math.round(selected.apogeeKm ?? selected.altKm)} km`} />
                    )}
                    <Row k="当前高度" v={`${Math.round(selected.altKm)} km`} />
                    <Row k="星下点"   v={`${selected.lat.toFixed(2)}°, ${selected.lng.toFixed(2)}°`} />
                    {selected.inclinationDeg !== undefined && (
                      <Row k="轨道倾角" v={`${selected.inclinationDeg.toFixed(1)}°`} />
                    )}
                    {(selected as FlagshipSatellite).mission && (
                      <div className="mt-2 rounded-lg bg-white/5 px-3 py-2 text-slate-300 leading-5">
                        {(selected as FlagshipSatellite).mission}
                      </div>
                    )}
                    {(selected as { users?: string }).users && (
                      <Row k="运营方性质" v={(selected as { users?: string }).users ?? ""} />
                    )}
                  </dl>
                  <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: selected.color }} />
                    地球上已用同色实线标出该卫星的完整轨道环线
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-400">点击地球上的卫星查看详情。</p>
              )}
            </Panel>

            <Panel title={`卫星列表（前 20 / ${totalVisible}）`}>
              <div className="space-y-1">
                {allLiveSats.slice(0, 20).map((sat) => (
                  <button key={sat.id} type="button"
                    onClick={() => setSelectedId(sat.id)}
                    className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-1.5 text-left text-xs transition ${
                      sat.id === selectedId
                        ? "border-white/40 bg-white/10"
                        : "border-white/10 bg-white/[0.02] hover:bg-white/5"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full flex-none" style={{ background: sat.color }} />
                    <span className="flex-1 truncate text-slate-200">{sat.name}</span>
                    <span className="text-slate-500">{Math.round(sat.altKm)}km</span>
                  </button>
                ))}
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </main>
  );
}

/* ── small helper components ─────────────────────────────────────── */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4 backdrop-blur">
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7fb0ff]">{title}</div>
      {children}
    </section>
  );
}

function Chip({ label, active, onClick, danger }: { label: string; active: boolean; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition ${
        active && danger  ? "border-red-500/60 bg-red-500/20 text-red-300" :
        active            ? "border-white/50 bg-white/15 text-white" :
                            "border-white/15 text-slate-300 hover:bg-white/5"
      }`}
    >
      {label}
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="text-slate-400 flex-none">{k}</dt>
      <dd className="text-right text-slate-200 break-all">{v}</dd>
    </div>
  );
}
