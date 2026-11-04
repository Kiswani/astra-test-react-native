// Plain-node checks of the capture helpers (no React Native runtime needed).
import assert from "node:assert/strict";
import { Ring, cleanUrl, record, network, log, logs } from "../lib/capture.js";

const r = new Ring(3); [1, 2, 3, 4, 5].forEach((x) => r.push(x));
assert.deepEqual(r.all(), [3, 4, 5]);
assert.equal(cleanUrl("https://api.example.com/v1/cart?token=secret#x"), "https://api.example.com/v1/cart");
record("post", "https://api.example.com/v1/cart?x=1", 500, 12);
assert.equal(network.all().at(-1).method, "POST");
record("get", "https://astratest.dev/v1/config", 200, 5);
assert.equal(network.all().length, 1, "skips Astra Test's own calls");
log("error", "[AstraTest] internal"); assert.equal(logs.all().length, 0);
log("error", "Checkout failed"); assert.equal(logs.all().at(-1).message, "Checkout failed");
console.log("ok: capture helpers");
