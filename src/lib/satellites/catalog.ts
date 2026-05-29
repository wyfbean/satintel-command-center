/**
 * Flagship-satellite catalog for the 3D globe.
 *
 * Each entry carries Keplerian elements that are rendered into a column-exact,
 * checksum-valid TLE by {@link buildTle}, so satellite.js can SGP4-propagate them
 * to live lat/lon/alt with no network access. This keeps the globe working with
 * zero environment variables.
 *
 * These are representative orbits for well-known national flagship missions, seeded
 * statically. The intended production path is a CelesTrak fetch adapter (query by
 * NORAD id, group by mission) that replaces {@link satelliteCatalog} TLEs with live
 * element sets — mirroring the conservative fetch policy of the news CrawlAdapter.
 */

export type SatelliteOrbit = {
  inclinationDeg: number;
  raanDeg: number;
  eccentricity: number;
  argPerigeeDeg: number;
  meanAnomalyDeg: number;
  meanMotionRevPerDay: number;
};

export type FlagshipSatellite = {
  id: string;
  noradId: number;
  name: string;
  country: string;
  countryCode: string;
  agency: string;
  mission: string;
  category: "对地观测" | "导航" | "通信" | "科学" | "气象";
  launchYear: number;
  color: string;
  orbit: SatelliteOrbit;
  tle: { line1: string; line2: string };
};

/** Fixed epoch (2026, day 80.5) keeps generated TLEs deterministic across builds. */
const EPOCH_YEAR_TWO_DIGIT = 26;
const EPOCH_DAY = 80.5;

function place(target: string[], startIndex: number, text: string) {
  for (let i = 0; i < text.length; i += 1) target[startIndex + i] = text[i];
}

function fixed(value: number, intWidth: number, decimals: number) {
  const text = value.toFixed(decimals);
  const [intPart, decPart] = text.split(".");
  return `${intPart.padStart(intWidth, " ")}.${decPart}`;
}

function checksum(line: string) {
  let sum = 0;
  for (const ch of line) {
    if (ch >= "0" && ch <= "9") sum += Number(ch);
    else if (ch === "-") sum += 1;
  }
  return sum % 10;
}

/** Render Keplerian elements into a valid pair of TLE lines for satellite.js. */
export function buildTle(noradId: number, launchYear: number, orbit: SatelliteOrbit) {
  const satnum = String(noradId).padStart(5, "0");
  const intlYear = String(launchYear % 100).padStart(2, "0");

  // Line 1: identity + epoch + (zeroed) drag terms.
  const l1 = Array<string>(68).fill(" ");
  place(l1, 0, "1");
  place(l1, 2, satnum);
  place(l1, 7, "U");
  place(l1, 9, `${intlYear}001A  `);
  place(l1, 18, String(EPOCH_YEAR_TWO_DIGIT).padStart(2, "0"));
  place(l1, 20, EPOCH_DAY.toFixed(8).padStart(12, "0"));
  place(l1, 33, " .00000000");
  place(l1, 44, " 00000+0");
  place(l1, 53, " 00000+0");
  place(l1, 62, "0");
  place(l1, 64, "999");
  const line1Base = l1.join("");
  const line1 = line1Base + String(checksum(line1Base));

  // Line 2: orbital geometry.
  const eccDigits = String(Math.round(orbit.eccentricity * 1e7)).padStart(7, "0");
  const l2 = Array<string>(68).fill(" ");
  place(l2, 0, "2");
  place(l2, 2, satnum);
  place(l2, 8, fixed(orbit.inclinationDeg, 3, 4));
  place(l2, 17, fixed(orbit.raanDeg, 3, 4));
  place(l2, 26, eccDigits);
  place(l2, 34, fixed(orbit.argPerigeeDeg, 3, 4));
  place(l2, 43, fixed(orbit.meanAnomalyDeg, 3, 4));
  place(l2, 52, fixed(orbit.meanMotionRevPerDay, 2, 8));
  place(l2, 63, "00001");
  const line2Base = l2.join("");
  const line2 = line2Base + String(checksum(line2Base));

  return { line1, line2 };
}

type SeedSatellite = Omit<FlagshipSatellite, "tle">;

const seeds: SeedSatellite[] = [
  {
    id: "landsat-9",
    noradId: 49260,
    name: "Landsat 9",
    country: "美国",
    countryCode: "US",
    agency: "NASA / USGS",
    mission: "陆地光学遥感旗舰，OLI-2 多光谱成像。",
    category: "对地观测",
    launchYear: 2021,
    color: "#3d74ff",
    orbit: { inclinationDeg: 98.2, raanDeg: 64.3, eccentricity: 0.0001, argPerigeeDeg: 88.5, meanAnomalyDeg: 271.6, meanMotionRevPerDay: 14.57 },
  },
  {
    id: "sentinel-2a",
    noradId: 40697,
    name: "Sentinel-2A",
    country: "欧盟",
    countryCode: "EU",
    agency: "ESA / Copernicus",
    mission: "哥白尼计划多光谱对地观测旗舰。",
    category: "对地观测",
    launchYear: 2015,
    color: "#15803d",
    orbit: { inclinationDeg: 98.6, raanDeg: 120.1, eccentricity: 0.0001, argPerigeeDeg: 90.0, meanAnomalyDeg: 270.0, meanMotionRevPerDay: 14.31 },
  },
  {
    id: "sentinel-1a",
    noradId: 39634,
    name: "Sentinel-1A",
    country: "欧盟",
    countryCode: "EU",
    agency: "ESA / Copernicus",
    mission: "C 波段 SAR 全天候雷达成像旗舰。",
    category: "对地观测",
    launchYear: 2014,
    color: "#0ea5a3",
    orbit: { inclinationDeg: 98.18, raanDeg: 150.4, eccentricity: 0.0001, argPerigeeDeg: 89.9, meanAnomalyDeg: 270.2, meanMotionRevPerDay: 14.59 },
  },
  {
    id: "gaofen-3",
    noradId: 41727,
    name: "高分三号 (Gaofen-3)",
    country: "中国",
    countryCode: "CN",
    agency: "CNSA",
    mission: "C 波段多极化 SAR 海陆观测旗舰。",
    category: "对地观测",
    launchYear: 2016,
    color: "#dc2626",
    orbit: { inclinationDeg: 98.4, raanDeg: 200.7, eccentricity: 0.0001, argPerigeeDeg: 90.1, meanAnomalyDeg: 269.7, meanMotionRevPerDay: 14.76 },
  },
  {
    id: "beidou-3-m1",
    noradId: 43001,
    name: "北斗三号 M1 (BeiDou-3)",
    country: "中国",
    countryCode: "CN",
    agency: "CNSA",
    mission: "全球导航星座 MEO 旗舰卫星。",
    category: "导航",
    launchYear: 2017,
    color: "#f97316",
    orbit: { inclinationDeg: 55.0, raanDeg: 30.0, eccentricity: 0.0003, argPerigeeDeg: 180.0, meanAnomalyDeg: 0.0, meanMotionRevPerDay: 1.86 },
  },
  {
    id: "gps-iii-sv01",
    noradId: 43873,
    name: "GPS III SV01",
    country: "美国",
    countryCode: "US",
    agency: "USSF",
    mission: "新一代全球定位导航旗舰。",
    category: "导航",
    launchYear: 2018,
    color: "#2563eb",
    orbit: { inclinationDeg: 55.0, raanDeg: 90.0, eccentricity: 0.0002, argPerigeeDeg: 200.0, meanAnomalyDeg: 60.0, meanMotionRevPerDay: 2.0056 },
  },
  {
    id: "alos-2",
    noradId: 39766,
    name: "ALOS-2 (だいち2号)",
    country: "日本",
    countryCode: "JP",
    agency: "JAXA",
    mission: "L 波段 SAR 灾害与陆地观测旗舰。",
    category: "对地观测",
    launchYear: 2014,
    color: "#7c3aed",
    orbit: { inclinationDeg: 97.9, raanDeg: 250.3, eccentricity: 0.0001, argPerigeeDeg: 90.0, meanAnomalyDeg: 270.0, meanMotionRevPerDay: 14.65 },
  },
  {
    id: "cartosat-3",
    noradId: 44804,
    name: "Cartosat-3",
    country: "印度",
    countryCode: "IN",
    agency: "ISRO",
    mission: "高分辨率光学测绘对地观测旗舰。",
    category: "对地观测",
    launchYear: 2019,
    color: "#ca8a04",
    orbit: { inclinationDeg: 97.5, raanDeg: 300.8, eccentricity: 0.0001, argPerigeeDeg: 90.2, meanAnomalyDeg: 269.8, meanMotionRevPerDay: 15.21 },
  },
  {
    id: "resurs-p1",
    noradId: 39186,
    name: "Resurs-P No.1",
    country: "俄罗斯",
    countryCode: "RU",
    agency: "Roscosmos",
    mission: "高分辨率光学对地观测旗舰。",
    category: "对地观测",
    launchYear: 2013,
    color: "#0891b2",
    orbit: { inclinationDeg: 97.3, raanDeg: 15.6, eccentricity: 0.0002, argPerigeeDeg: 89.7, meanAnomalyDeg: 270.4, meanMotionRevPerDay: 15.36 },
  },
  {
    id: "hubble",
    noradId: 20580,
    name: "Hubble Space Telescope",
    country: "美国",
    countryCode: "US",
    agency: "NASA / ESA",
    mission: "光学/紫外空间天文台科学旗舰。",
    category: "科学",
    launchYear: 1990,
    color: "#9333ea",
    orbit: { inclinationDeg: 28.47, raanDeg: 200.0, eccentricity: 0.0002, argPerigeeDeg: 100.0, meanAnomalyDeg: 260.0, meanMotionRevPerDay: 15.09 },
  },
  {
    id: "fengyun-4a",
    noradId: 41882,
    name: "风云四号 A (Fengyun-4A)",
    country: "中国",
    countryCode: "CN",
    agency: "CMA / CNSA",
    mission: "静止轨道气象观测旗舰。",
    category: "气象",
    launchYear: 2016,
    color: "#e11d48",
    orbit: { inclinationDeg: 1.2, raanDeg: 80.0, eccentricity: 0.0002, argPerigeeDeg: 180.0, meanAnomalyDeg: 0.0, meanMotionRevPerDay: 1.0027 },
  },
  {
    id: "koreasat-6",
    noradId: 39616,
    name: "Koreasat 6",
    country: "韩国",
    countryCode: "KR",
    agency: "KT SAT",
    mission: "静止轨道通信广播旗舰。",
    category: "通信",
    launchYear: 2010,
    color: "#0d9488",
    orbit: { inclinationDeg: 0.05, raanDeg: 95.0, eccentricity: 0.0002, argPerigeeDeg: 180.0, meanAnomalyDeg: 120.0, meanMotionRevPerDay: 1.0027 },
  },
];

export const satelliteCatalog: FlagshipSatellite[] = seeds.map((seed) => ({
  ...seed,
  tle: buildTle(seed.noradId, seed.launchYear, seed.orbit),
}));

export const satelliteCountries = Array.from(
  satelliteCatalog.reduce((map, sat) => {
    map.set(sat.country, (map.get(sat.country) ?? 0) + 1);
    return map;
  }, new Map<string, number>()),
).map(([country, count]) => ({ country, count }));
