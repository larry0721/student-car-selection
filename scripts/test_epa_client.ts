import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getMakesForYear,
  getModelsForYearMake,
  getVehicleById,
  getVehicleOptions,
  type EpaVehicleRecord,
} from "../src/vehicle-intelligence/sources/epa/epa-client";

type MockResponder = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const originalFetch = globalThis.fetch;
const calls: { url: string; init?: RequestInit }[] = [];
let responder: MockResponder | null = null;

globalThis.fetch = async (input, init) => {
  calls.push({ url: String(input), init });
  if (!responder) throw new Error("EPA test attempted an unplanned network request.");
  const current = responder;
  responder = null;
  return current(input, init);
};

run()
  .then(() => {
    console.log(`EPA source client passed: ${calls.length} mocked requests, menu normalization, source parsing, errors, and isolation verified.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
  });

async function run() {
  respondJson({
    menuItem: [
      { text: "Honda", value: "Honda" },
      { text: "Toyota", value: "Toyota" },
    ],
  });
  assert.deepEqual(await getMakesForYear(2024), [
    { text: "Honda", value: "Honda" },
    { text: "Toyota", value: "Toyota" },
  ]);
  assert.match(calls.at(-1)?.url || "", /vehicle\/menu\/make\?year=2024$/);

  respondJson({ menuItem: { text: "Toyota", value: "Toyota" } });
  assert.deepEqual(await getMakesForYear(2024), [{ text: "Toyota", value: "Toyota" }]);

  respondJson({ menuItem: [] });
  assert.deepEqual(await getMakesForYear(2024), []);
  respondJson({ menuItem: null });
  assert.deepEqual(await getMakesForYear(2024), []);

  respondJson({
    menuItem: [
      { text: "Camry", value: "Camry" },
      { text: "Camry Hybrid LE", value: "Camry Hybrid LE" },
    ],
  });
  assert.deepEqual(await getModelsForYearMake(2024, " Toyota "), [
    { text: "Camry", value: "Camry" },
    { text: "Camry Hybrid LE", value: "Camry Hybrid LE" },
  ]);
  assert.match(calls.at(-1)?.url || "", /vehicle\/menu\/model\?year=2024&make=Toyota$/);

  respondJson({
    menuItem: [
      { text: "Auto (S8), 6 cyl, 3.5 L", value: "47085" },
      { text: "Auto (AV-S6), 4 cyl, 2.5 L", value: "047086" },
      { text: "Manual 6-spd, 4 cyl, 2.5 L", value: 47087 },
    ],
  });
  const options = await getVehicleOptions(2024, " Toyota ", " Camry ");
  assert.equal(options.length, 3);
  assert.deepEqual(options.map((option) => option.id), ["47085", "047086", "47087"]);
  assert.equal(options[0].label, "Auto (S8), 6 cyl, 3.5 L");
  assert.deepEqual(options[0], {
    id: "47085",
    label: "Auto (S8), 6 cyl, 3.5 L",
    year: 2024,
    make: "Toyota",
    model: "Camry",
  });
  assert.match(calls.at(-1)?.url || "", /vehicle\/menu\/options\?year=2024&make=Toyota&model=Camry$/);

  const gasolinePayload = vehiclePayload({
    id: "47085",
    year: "2024",
    make: "Toyota",
    model: "Camry",
    VClass: "Midsize Cars",
    drive: "Front-Wheel Drive",
    trany: "Automatic (S8)",
    cylinders: "6",
    displ: "3.5",
    fuelType: "Regular",
    fuelType1: "Regular Gasoline",
    fuelType2: "",
    city08: "22",
    highway08: "33",
    comb08: "26",
    cityA08: "0",
    highwayA08: "0",
    combA08: "0",
    range: "0",
    rangeCity: "0.0",
    rangeHwy: "0.0",
    charge240: "0.0",
    charge120: "0.0",
    cityE: "0.0",
    highwayE: "0.0",
    combE: "0.0",
    fuelCost08: "2350",
    fuelCostA08: "0",
    co2: "338",
    co2TailpipeGpm: "338.0",
    co2TailpipeAGpm: "0.0",
    ghgScore: "5",
    ghgScoreA: "-1",
    feScore: "5",
    feScoreA: "-1",
    createdOn: "2023-09-19T00:00:00-04:00",
    modifiedOn: "2024-01-18T00:00:00-05:00",
  });
  const originalGasolinePayload = clone(gasolinePayload);
  respondJson(gasolinePayload);
  const gasoline = await getVehicleById("47085");
  assert.deepEqual(gasolinePayload, originalGasolinePayload, "EPA source payload must not be mutated.");
  assert.equal(gasoline.id, "47085");
  assert.equal(gasoline.year, 2024);
  assert.equal(gasoline.cylinders, 6);
  assert.equal(gasoline.displ, 3.5);
  assert.equal(gasoline.city08, 22);
  assert.equal(gasoline.fuelCost08, 2350);
  assert.equal(gasoline.fuelType2, null, "Present empty strings must become null.");
  assert.equal(gasoline.cityA08, 0, "Legitimate source zero must remain zero.");
  assert.equal(gasoline.ghgScoreA, null, "Documented -1 score sentinel must become null.");

  respondJson(vehiclePayload({
    id: "47100",
    year: "2024",
    make: "Toyota",
    model: "Camry Hybrid LE",
    fuelType: "Regular Gas and Electricity",
    fuelType1: "Regular Gasoline",
    fuelType2: "Electricity",
    atvType: "Hybrid",
    city08: "51",
    highway08: "53",
    comb08: "52",
    cityE: "20.1",
    highwayE: "22.4",
    combE: "21.2",
  }));
  const hybrid = await getVehicleById(47100);
  assert.equal(hybrid.fuelType2, "Electricity");
  assert.equal(hybrid.atvType, "Hybrid");
  assert.equal(hybrid.comb08, 52);
  assert.equal(hybrid.combE, 21.2);

  respondJson(vehiclePayload({
    id: "47000",
    year: "2024",
    make: "Tesla",
    model: "Model 3 Long Range AWD",
    fuelType: "Electricity",
    fuelType1: "Electricity",
    city08: "132",
    highway08: "120",
    comb08: "127",
    range: "341",
    rangeCity: "354.2",
    rangeHwy: "326.1",
    charge240: "11.5",
    charge120: "0",
    cityE: "25.5",
    highwayE: "28.1",
    combE: "26.6",
    co2: "0",
    co2TailpipeGpm: "0.0",
  }));
  const ev = await getVehicleById("47000");
  assert.equal(ev.range, 341);
  assert.equal(ev.charge240, 11.5);
  assert.equal(ev.charge120, 0);
  assert.equal(ev.co2, 0);

  respondJson(vehiclePayload({
    id: "48000",
    year: "2025",
    make: "Example",
    model: "Malformed Optional",
    cylinders: "not-a-number",
    displ: "",
    feScore: "-1",
  }));
  const malformedOptional = await getVehicleById("48000");
  assert.equal(malformedOptional.cylinders, null);
  assert.equal(malformedOptional.displ, null);
  assert.equal(malformedOptional.feScore, null);
  assert.equal("fuelType2" in malformedOptional, false, "Absent source fields must remain absent.");

  respondWith(async () => {
    throw new Error("offline");
  });
  await assert.rejects(
    getMakesForYear(2024),
    (error: Error) => error.message.includes("network request could not be completed") && error.cause instanceof Error,
  );

  respondWith(async () => responseWithJson({}, 503));
  await assert.rejects(getMakesForYear(2024), /HTTP status 503/);

  respondWith(async () => responseWithJsonError(new SyntaxError("bad JSON")));
  await assert.rejects(
    getMakesForYear(2024),
    (error: Error) => error.message.includes("was not valid JSON") && error.cause instanceof SyntaxError,
  );

  respondJson({ items: [] });
  await assert.rejects(getMakesForYear(2024), /unexpected shape/);
  respondJson({ menuItem: [{ text: "Toyota" }] });
  await assert.rejects(getMakesForYear(2024), /invalid menu item/);

  respondJson([]);
  await assert.rejects(getVehicleById("47085"), /unexpected shape/);
  respondJson({});
  await assert.rejects(getVehicleById("47085"), /returned no vehicle record/);
  respondJson({ id: "47085", year: "2024", make: "Toyota" });
  await assert.rejects(getVehicleById("47085"), /missing required identity fields/);

  respondWith(async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  });
  await assert.rejects(
    getMakesForYear(2024),
    (error: Error) => error.message.includes("timed out") && error.cause instanceof Error,
  );

  const callsBeforeValidation = calls.length;
  await assert.rejects(getMakesForYear(1983), /Invalid EPA model year/);
  await assert.rejects(getMakesForYear(2024.5), /Invalid EPA model year/);
  await assert.rejects(getModelsForYearMake(2024, "  "), /Invalid EPA make/);
  await assert.rejects(getVehicleOptions(2024, "Toyota", ""), /Invalid EPA model/);
  await assert.rejects(getVehicleById("abc"), /Invalid EPA vehicle ID/);
  await assert.rejects(getVehicleById(0), /Invalid EPA vehicle ID/);
  assert.equal(calls.length, callsBeforeValidation, "Invalid inputs must fail before fetch.");

  for (const call of calls) {
    const headers = call.init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.Accept, "application/json", "Every EPA request must explicitly negotiate JSON.");
  }

  assert.equal("schemaVersion" in gasoline, false);
  assert.equal("recordId" in gasoline, false);
  assert.equal("evidence" in gasoline, false);
  assert.equal("contributionId" in gasoline, false);
  assert.equal("data" in gasoline, false);

  const clientSource = readFileSync(
    join(process.cwd(), "src/vehicle-intelligence/sources/epa/epa-client.ts"),
    "utf8",
  );
  assert.equal(/recommendation|CandidatePipeline|BuyerProfile/.test(clientSource), false);
  assert.equal(/CanonicalVehicleRecord|CanonicalVehicleContribution|canonical-vehicle-merger/.test(clientSource), false);

  const typedRecord: EpaVehicleRecord = gasoline;
  void typedRecord;
  assert.equal(responder, null, "All mocked responses must be consumed exactly once.");
}

function respondJson(payload: unknown, status = 200) {
  respondWith(async () => responseWithJson(payload, status));
}

function respondWith(next: MockResponder) {
  assert.equal(responder, null, "Previous EPA mock response was not consumed.");
  responder = next;
}

function responseWithJson(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

function responseWithJsonError(error: Error) {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw error;
    },
  } as unknown as Response;
}

function vehiclePayload(overrides: Record<string, unknown>) {
  return { id: "1", year: "2024", make: "Example", model: "Vehicle", ...overrides };
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
