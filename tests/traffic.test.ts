import { describe, it, expect } from 'vitest';
import { MAPS } from '../src/maps/index';
import { BUS_ORDER, BUS_ROUTE, BUS_STOPS } from '../src/maps/campus';
import { pointOnEdge, routeLength } from '../src/engine/roads';
import { CYCLE, Traffic, carLight, walkLight, type Vehicle } from '../src/game/traffic';

const net = MAPS.campus.roads!;

describe('road network', () => {
  it('has streets, signals and a crosswalk on signal arms', () => {
    expect(net.edges.length).toBeGreaterThan(100);
    expect(net.signals.length).toBeGreaterThan(10);
    expect(net.crossings.length).toBeGreaterThan(net.signals.length);
    for (const s of net.signals) expect(s.main).not.toBe('');
  });

  it('crosswalk tiles are on the map and on the street', () => {
    const m = MAPS.campus;
    let road = 0;
    for (const [i] of net.crossTile) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(m.w * m.h);
      if (m.ground[i] === 'road') road++;
    }
    expect(road / net.crossTile.size).toBeGreaterThan(0.6);
  });

  it('the Wolfline loop is one continuous drive that stops at every stop in order', () => {
    expect(BUS_ROUTE.length).toBeGreaterThan(4);
    expect(BUS_ROUTE.filter((s) => s.stop).map((s) => s.stop)).toEqual([...BUS_ORDER.slice(1), BUS_ORDER[0]]);
    const end = (i: number) => {
      const st = BUS_ROUTE[i], e = net.edges[st.edge];
      return pointOnEdge(e, st.dir > 0 ? st.s1 : e.len - st.s1);
    };
    const start = (i: number) => {
      const st = BUS_ROUTE[i], e = net.edges[st.edge];
      return pointOnEdge(e, st.dir > 0 ? st.s0 : e.len - st.s0);
    };
    for (let i = 0; i < BUS_ROUTE.length; i++) {
      const a = end(i), b = start((i + 1) % BUS_ROUTE.length);
      expect(Math.hypot(a.x - b.x, a.y - b.y), `step ${i}`).toBeLessThan(0.01);
    }
    expect(routeLength(BUS_ROUTE)).toBeGreaterThan(50);
  });

  it('each stop is on the kerb within reach of where the bus pulls in', () => {
    for (const id of BUS_ORDER) {
      const s = BUS_STOPS[id];
      expect(Math.hypot(s.x + 0.5 - s.at.x, s.y + 0.5 - s.at.y), id).toBeLessThan(4);
    }
  });
});

describe('signals', () => {
  it('main and side streets never have green at once, and there is an all-red gap', () => {
    for (let sig = 0; sig < net.signals.length; sig++) for (let t = 0; t < CYCLE * 2; t += 0.25) {
      const a = carLight(net, sig, true, t), b = carLight(net, sig, false, t);
      expect(a !== 'red' && b !== 'red', `signal ${sig} at ${t}`).toBe(false);
    }
  });

  it('walkers only get Walk or a countdown while the street they cross is red', () => {
    for (let sig = 0; sig < net.signals.length; sig++) for (let t = 0; t < CYCLE; t += 0.25) {
      for (const overMain of [true, false]) {
        const w = walkLight(net, sig, overMain, t);
        if (w.walk || w.count) expect(carLight(net, sig, overMain, t), `signal ${sig} at ${t}`).toBe('red');
      }
    }
  });

  it('every crossing gets a Walk once per cycle', () => {
    const k = net.crossings[0];
    let walks = 0;
    for (let t = 0; t < CYCLE; t += 0.5) if (walkLight(net, k.signal, k.overMain, t).walk) walks++;
    expect(walks).toBeGreaterThan(4);
  });
});

/** A car alone on an edge that ends at a signal, heading into it. */
function approach(tr: Traffic): Vehicle {
  const ei = net.edges.findIndex((e, i) => net.stopAt[i * 2 + 1] >= 0 && e.len > 25 && net.nodes[e.b].signal >= 0);
  const e = net.edges[ei];
  const v: Vehicle = {
    id: 999, kind: 'car', edge: ei, dir: 1, s: e.len - net.stopAt[ei * 2 + 1] - 14, v: 6, vmax: 7, len: 1.7, width: 0.9,
    next: null, x: 0, y: 0, angle: 0, braking: false, color: 0, claim: -1, wait: 0,
  };
  tr.vehicles.push(v);
  return v;
}
/** A camera around the vehicle, with no other cars wanted (busy = 0). */
function around(v: Vehicle) {
  const e = net.edges[v.edge], p = pointOnEdge(e, v.s);
  return { x0: p.x - 15, y0: p.y - 15, x1: p.x + 15, y1: p.y + 15 };
}

describe('traffic', () => {
  it('a car stops behind the line on red', () => {
    const tr = new Traffic(net);
    const v = approach(tr);
    const e = net.edges[v.edge];
    const main = e.name === net.signals[net.nodes[e.b].signal].main;
    // Find a clock where this car has just turned red with a long red ahead
    const sig = net.nodes[e.b].signal;
    let t = 0;
    while (carLight(net, sig, main, t) !== 'red' || carLight(net, sig, main, t + 10) !== 'red') t += 0.25;
    tr.clock = t;
    const line = e.len - net.stopAt[v.edge * 2 + 1];
    const view = around(v);
    for (let i = 0; i < 6 * 60; i++) tr.update(1 / 60, view, [], 0);
    expect(v.edge).toBe(net.edges.indexOf(e));
    expect(v.v).toBeLessThan(0.1);
    expect(v.s + v.len / 2).toBeLessThanOrEqual(line + 0.01);
  });

  it('a car brakes for someone standing in the road ahead', () => {
    const tr = new Traffic(net);
    const v = approach(tr);
    const view = around(v);
    for (let i = 0; i < 20; i++) tr.update(1 / 60, view, [], 0); // settles its heading
    // Someone 8 tiles ahead in the car's lane
    const p = { x: v.x + Math.cos(v.angle) * 8, y: v.y + Math.sin(v.angle) * 8 };
    for (let i = 0; i < 4 * 60; i++) tr.update(1 / 60, view, [p], 0);
    expect(tr.touches(v, p)).toBe(false);
    expect(v.v).toBeLessThan(0.1);
  });

  it('cars appear near the camera, not inside it, and leave when it moves away', () => {
    const tr = new Traffic(net);
    const view = { x0: 300, y0: 15, x1: 340, y1: 40 };
    tr.update(1 / 60, view, [], 1); // first frame fills the area
    for (let i = 0; i < 120; i++) tr.update(1 / 60, view, [], 1);
    const cars = tr.vehicles.filter((v) => v.kind === 'car');
    expect(cars.length).toBeGreaterThan(5);
    expect(cars.length).toBeLessThanOrEqual(48);
    const away = { x0: 20, y0: 150, x1: 60, y1: 175 };
    for (let i = 0; i < 5; i++) tr.update(1 / 60, away, [], 1);
    expect(tr.vehicles.some((v) => v.x > 250 && v.y < 60)).toBe(false);
  });

  it('cars never overlap in a lane', () => {
    const tr = new Traffic(net);
    const view = { x0: 300, y0: 15, x1: 340, y1: 40 };
    for (let i = 0; i < 60 * 40; i++) {
      tr.update(1 / 60, view, [], 1);
      const lanes = new Map<number, Vehicle[]>();
      for (const v of tr.vehicles) { const k = v.edge * 2 + (v.dir > 0 ? 1 : 0); lanes.set(k, [...(lanes.get(k) ?? []), v]); }
      for (const l of lanes.values()) {
        l.sort((a, b) => a.s - b.s);
        for (let j = 1; j < l.length; j++) expect(l[j].s - l[j - 1].s - (l[j].len + l[j - 1].len) / 2).toBeGreaterThan(-0.05);
      }
    }
  });

  it('the bus drives the whole loop and dwells at each stop in order', () => {
    const tr = new Traffic(net);
    const bus = tr.addBus(BUS_ROUTE, 0);
    const seen: string[] = [];
    for (let i = 0; i < 60 * 600 && seen.length < BUS_ORDER.length; i++) {
      tr.update(1 / 60, null, [], 0);
      if (bus.dwell! > 0 && bus.at && seen[seen.length - 1] !== bus.at) seen.push(bus.at);
    }
    expect(seen).toEqual([...BUS_ORDER.slice(1), BUS_ORDER[0]]);
    expect(tr.eta(bus, bus.at!)).toBe(0);
  });
});
