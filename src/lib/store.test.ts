import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "./store.ts";

interface S {
  n: number;
  name: string;
  list: number[];
  inc: () => void;
}

const make = () =>
  createStore<S>((set, get) => ({ n: 0, name: "a", list: [], inc: () => set({ n: get().n + 1 }) }));

test("set merges, notifies once, and skips no-op patches", () => {
  const s = make();
  let calls = 0;
  const off = s.subscribe(() => calls++);
  s.getState().inc();
  assert.equal(s.getState().n, 1);
  assert.equal(calls, 1);
  s.setState({ n: 1 }); // identical → no notification
  s.setState({});
  assert.equal(calls, 1);
  s.setState((st) => ({ name: `${st.name}b` }));
  assert.equal(s.getState().name, "ab");
  assert.equal(calls, 2);
  off();
  s.setState({ n: 9 });
  assert.equal(calls, 2);
});

test("state objects are immutable snapshots; listeners receive previous state", () => {
  const s = make();
  const before = s.getState();
  let seen: { cur: number; prev: number } | null = null;
  s.subscribe((cur, prev) => (seen = { cur: cur.n, prev: prev.n }));
  s.setState({ n: 5 });
  assert.notEqual(s.getState(), before);
  assert.equal(before.n, 0);
  assert.deepEqual(seen, { cur: 5, prev: 0 });
});

test("a listener that unsubscribes during notification does not break iteration", () => {
  const s = make();
  const order: string[] = [];
  const off1 = s.subscribe(() => {
    order.push("a");
    off1();
  });
  s.subscribe(() => order.push("b"));
  s.setState({ n: 1 });
  s.setState({ n: 2 });
  assert.deepEqual(order, ["a", "b", "b"]);
});
