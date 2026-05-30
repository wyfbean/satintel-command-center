"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import * as satellite from "satellite.js";

import { SiteNav } from "@/components/site-nav";
import { satelliteCatalog, satelliteCountries, type FlagshipSatellite } from "@/lib/satellites/catalog";

// react-globe.gl touches window/WebGL — load it only in the browser.
const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });

const EARTH_RADIUS_KM = 6371;
const GLOBE_TEXTURE = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
const NIGHT_BG = "https://unpkg.com/three-globe/example/img/night-sky.png";

type LiveSatellite = FlagshipSatellite & { lat: number; lng: number; altKm: number };

export function GlobeShell() {
  const [tick, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCountry, setActiveCountry] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 800, height: 560 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse each TLE into a satrec exactly once.
  const satrecs = useMemo(
    () => new Map(satelliteCatalog.map((sat) => [sat.id, satellite.twoline2satrec(sat.tle.line1, sat.tle.line2)])),
    [],
  );

  // Re-propagate on a steady tick so satellites glide along their orbits.
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Track container size for a responsive globe canvas.
  useEffect(() => {
    if (!containerRef.current) return;
    const element = containerRef.current;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const liveSatellites = useMemo<LiveSatellite[]>(() => {
    const now = new Date();
    const gmst = satellite.gstime(now);
    const result: LiveSatellite[] = [];
    for (const sat of satelliteCatalog) {
      const satrec = satrecs.get(sat.id);
      if (!satrec) continue;
      const pv = satellite.propagate(satrec, now);
      const eci = pv && typeof pv === "object" ? (pv as { position?: unknown }).position : undefined;
      if (!eci || typeof eci !== "object") continue;
      const geo = satellite.eciToGeodetic(eci as satellite.EciVec3<number>, gmst);
      result.push({
        ...sat,
        lat: satellite.degreesLat(geo.latitude),
        lng: satellite.degreesLong(geo.longitude),
        altKm: geo.height,
      });
    }
    return result;
    // tick drives the recompute; satrecs is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, satrecs]);

  const visibleSatellites = useMemo(
    () => (activeCountry ? liveSatellites.filter((sat) => sat.country === activeCountry) : liveSatellites),
    [liveSatellites, activeCountry],
  );

  const selected = liveSatellites.find((sat) => sat.id === selectedId) ?? null;

  // Reusable geometry; per-object material so we can color and highlight.
  const geometry = useMemo(() => new THREE.SphereGeometry(1.7, 12, 12), []);

  return (
    <main className="min-h-screen bg-[#05070f] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-6">
        <header className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-white">各国旗舰卫星 · 3D 星图</div>
              <div className="text-xs text-slate-400">react-globe.gl · satellite.js SGP4 实时轨道推演</div>
            </div>
            <SiteNav variant="dark" />
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div
            ref={containerRef}
            className="relative h-[72vh] overflow-hidden rounded-[28px] border border-white/10 bg-black"
          >
            <Globe
              width={size.width}
              height={size.height}
              globeImageUrl={GLOBE_TEXTURE}
              backgroundImageUrl={NIGHT_BG}
              backgroundColor="#05070f"
              objectsData={visibleSatellites}
              objectLat={(d: object) => (d as LiveSatellite).lat}
              objectLng={(d: object) => (d as LiveSatellite).lng}
              objectAltitude={(d: object) => (d as LiveSatellite).altKm / EARTH_RADIUS_KM}
              objectLabel={(d: object) => {
                const sat = d as LiveSatellite;
                return `<div style="font-size:12px"><b>${sat.name}</b><br/>${sat.country} · ${sat.category}<br/>alt ${Math.round(
                  sat.altKm,
                )} km</div>`;
              }}
              objectThreeObject={(d: object) => {
                const sat = d as LiveSatellite;
                const material = new THREE.MeshLambertMaterial({
                  color: sat.color,
                  emissive: new THREE.Color(sat.color),
                  emissiveIntensity: sat.id === selectedId ? 0.9 : 0.35,
                });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.scale.setScalar(sat.id === selectedId ? 1.9 : 1);
                return mesh;
              }}
              onObjectClick={(d: object) => setSelectedId((d as LiveSatellite).id)}
            />
            <div className="pointer-events-none absolute left-4 top-4 rounded-2xl bg-black/40 px-4 py-2 text-xs text-slate-300 backdrop-blur">
              {visibleSatellites.length} 颗旗舰卫星 · 每秒推演
            </div>
          </div>

          <aside className="space-y-5">
            <Panel title="国家 / 地区">
              <div className="flex flex-wrap gap-2">
                <CountryChip
                  label="全部"
                  active={activeCountry === null}
                  onClick={() => setActiveCountry(null)}
                />
                {satelliteCountries.map(({ country, count }) => (
                  <CountryChip
                    key={country}
                    label={`${country} ${count}`}
                    active={activeCountry === country}
                    onClick={() => setActiveCountry(country)}
                  />
                ))}
              </div>
            </Panel>

            {selected ? (
              <Panel title="卫星详情">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: selected.color }} />
                  <span className="text-base font-semibold text-white">{selected.name}</span>
                </div>
                <dl className="mt-3 space-y-2 text-sm">
                  <Row k="国家 / 机构" v={`${selected.country} · ${selected.agency}`} />
                  <Row k="类型" v={selected.category} />
                  <Row k="NORAD ID" v={String(selected.noradId)} />
                  <Row k="发射年份" v={String(selected.launchYear)} />
                  <Row k="当前高度" v={`${Math.round(selected.altKm)} km`} />
                  <Row k="星下点" v={`${selected.lat.toFixed(1)}°, ${selected.lng.toFixed(1)}°`} />
                </dl>
                <p className="mt-3 text-sm leading-6 text-slate-300">{selected.mission}</p>
              </Panel>
            ) : (
              <Panel title="卫星详情">
                <p className="text-sm text-slate-400">点击地球上的卫星查看其轨道与任务信息。</p>
              </Panel>
            )}

            <Panel title="卫星列表">
              <div className="space-y-2">
                {visibleSatellites.map((sat) => (
                  <button
                    key={sat.id}
                    type="button"
                    onClick={() => setSelectedId(sat.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${
                      sat.id === selectedId
                        ? "border-white/40 bg-white/10"
                        : "border-white/10 bg-white/[0.02] hover:bg-white/5"
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: sat.color }} />
                    <span className="flex-1 truncate text-slate-200">{sat.name}</span>
                    <span className="text-xs text-slate-500">{Math.round(sat.altKm)}km</span>
                  </button>
                ))}
              </div>
            </Panel>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#7fb0ff]">{title}</div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function CountryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition ${
        active ? "border-white/50 bg-white/15 text-white" : "border-white/15 text-slate-300 hover:bg-white/5"
      }`}
    >
      {label}
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-400">{k}</dt>
      <dd className="text-right text-slate-200">{v}</dd>
    </div>
  );
}
