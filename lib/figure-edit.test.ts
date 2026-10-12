import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canEditFigures, changedFields, formValues, parseEdit, type EditableFigure } from "./figure-edit";

const figure: EditableFigure = {
  name: "Katsuki Bakugo",
  nameJa: "爆豪勝己",
  category: "SCALE",
  status: "RELEASED",
  scale: "1/4",
  heightMm: 305,
  releaseDate: new Date("2022-07-15T00:00:00Z"),
  releaseDatePrecision: "MONTH",
  msrpAmount: { toString: () => "33000" },
  msrpCurrency: "JPY",
  manufacturer: { name: "Good Smile Company" },
  franchise: "My Hero Academia",
  characters: [{ name: "Katsuki Bakugou" }],
  jan: "4580416924146",
};

describe("canEditFigures", () => {
  it("is moderators and admins", () => {
    assert.equal(canEditFigures("ADMIN"), true);
    assert.equal(canEditFigures("MODERATOR"), true);
    assert.equal(canEditFigures("USER"), false);
    assert.equal(canEditFigures(null), false);
  });
});

describe("parseEdit", () => {
  it("reads the form as it starts", () => {
    const r = parseEdit(formValues(figure));
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.value.releaseDate?.toISOString(), "2022-07-15T00:00:00.000Z");
    assert.equal(r.value.releaseDatePrecision, "MONTH");
    assert.deepEqual(r.value.characters, ["Katsuki Bakugou"]);
  });

  it("takes a day when one is given", () => {
    const r = parseEdit({ ...formValues(figure), releaseDate: "2025-03-17" });
    assert.ok(r.ok && r.value.releaseDatePrecision === "DAY");
  });

  it("reports every mistake at once", () => {
    const r = parseEdit({ ...formValues(figure), name: "", scale: "seventh", heightMm: "tall", releaseDate: "May", jan: "123" });
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.deepEqual(Object.keys(r.errors).sort(), ["heightMm", "jan", "name", "releaseDate", "scale"]);
  });

  it("wants a price and its currency together", () => {
    const r = parseEdit({ ...formValues(figure), msrpCurrency: "" });
    assert.ok(!r.ok && "msrpCurrency" in r.errors);
  });

  it("accepts a price written with thousands separators", () => {
    const r = parseEdit({ ...formValues(figure), msrpAmount: "33,000" });
    assert.ok(r.ok && r.value.msrpAmount === "33000");
  });

  it("refuses a type or status that does not exist", () => {
    const r = parseEdit({ ...formValues(figure), category: "STATUE", status: "SOLD" });
    assert.ok(!r.ok && "category" in r.errors && "status" in r.errors);
  });
});

describe("changedFields", () => {
  it("is nothing when nothing was touched", () => {
    const r = parseEdit(formValues(figure));
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(changedFields(figure, r.value), []);
  });

  it("is exactly what was changed", () => {
    const r = parseEdit({ ...formValues(figure), name: "Katsuki Bakugo: Hero Costume", heightMm: "300" });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(changedFields(figure, r.value), ["name", "heightMm"]);
  });
});
