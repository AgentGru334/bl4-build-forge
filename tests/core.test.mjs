import { createRequire } from "module";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const BF = require("../forge-core.js");
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("AES-256-ECB matches the NIST vector", () => {
  const key = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");
  const plain = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const cipher = BF.aesEcb(key, plain, true);
  assert.equal(Buffer.from(cipher).toString("hex"), "8ea2b7ca516745bfeafc49904b496089");
  assert.equal(Buffer.from(BF.aesEcb(key, cipher, false)).toString("hex"), plain.toString("hex"));
});

test("inflate accepts raw deflate and ignores trailing bytes", () => {
  const samples = [
    Buffer.from("state:\n  inventory: {}\n"),
    Buffer.from("hello yaml profile:\n".repeat(50)),
    zlib.deflateRawSync(Buffer.from("x".repeat(70000)))
  ];
  const hello = Buffer.from("Borderlands save state:\nprofile:\n");
  const raw = zlib.deflateRawSync(hello);
  assert.equal(Buffer.from(BF.inflateRaw(raw)).toString(), hello.toString());
  const extra = Buffer.concat([raw, Buffer.from([1, 2, 3, 4, 9, 9, 9, 9])]);
  assert.equal(Buffer.from(BF.inflateRaw(extra)).toString(), hello.toString());
  assert.equal(Buffer.from(BF.inflateRaw(BF.deflateRaw(hello))).toString(), hello.toString());
  for (const sample of samples) {
    const compressed = zlib.deflateRawSync(sample);
    assert.equal(Buffer.from(BF.inflateRaw(compressed)).toString("hex"), sample.toString("hex"));
  }
});

test("item serials round-trip and match the desktop codec", () => {
  const text = "2, 0, 1, 70| 2, 1|| {54} {2} {3} {1} {13} {25} {42}|";
  const serial = BF.encode(text);
  assert.equal(serial, "@Uga`vnFqRNu0@Myws6!2EQ*%(Y5C");
  assert.equal(BF.decode(serial), text);
  assert.equal(BF.encode(BF.decode(serial)), serial);
  const parsed = BF.tryParse(serial);
  assert.equal(parsed.family, 2);
  assert.equal(parsed.level, 70);
  assert.equal(BF.tryParse("{1:2}"), null);
  assert.equal(BF.patchLevel(text, 57).includes(", 57|"), true);
  const goldenPath = path.join(root, "tests", "codec-golden.txt");
  if (fs.existsSync(goldenPath)) assert.equal(serial, fs.readFileSync(goldenPath, "utf8").trim());
});

test("themes keep readable contrast", () => {
  for (const name of BF.themeNames) {
    const t = BF.themePalette(name);
    const field = t.field.slice(1), text = t.text.slice(1), muted = t.muted.slice(1), accent = t.accent.slice(1), on = t.onAccent.slice(1);
    assert.ok(BF.contrast(text, field) >= 4.5, name + " text");
    assert.ok(BF.contrast(muted, field) >= 4.5, name + " muted");
    assert.ok(BF.contrast(on, accent) >= 4.5, name + " accent");
  }
  assert.equal(BF.themePalette("unknown").name, "AMW Violet");
});

test("page ingest, author detection, and browser-check classification", () => {
  const ing = BF.scanHtml("<a href='#save-file'>SAVE FILE</a><a href='https://drive.google.com/file/d/1BOQGiV3AxlKemxgAnufFGVhwRGP830vV/view?usp=sharing'>SAVE FILE</a>", "https://mobalytics.gg/borderlands-4/builds/aim-on-amon");
  assert.equal(ing.SaveCandidates.length, 1);
  assert.equal(ing.SaveCandidates[0].Provider, "google-drive");
  assert.equal(BF.parse("Creator\nBy\nAncientRune\nFollow").Author, "AncientRune");
  assert.throws(() => BF.checkBody(Buffer.from("<html><title>Just a moment...</title>challenge-platform</html>"), "403", "text/html", "html"), BF.BrowserCheckError);
  BF.checkBody(Buffer.from("<html><body>Build page</body></html>"), "200", "text/html", "html");
  assert.ok(BF.failureSummary(new Error("#< CLIXML <Objs>" + "x".repeat(10000))).length < 150);
  assert.ok(BF.failureSummary(new Error("x".repeat(10000))).length < 230);
  assert.equal(BF.directDownloadUrl("https://drive.google.com/file/d/abc123/view"), "https://drive.usercontent.google.com/download?id=abc123&export=download&confirm=t");
});

test("YAML inventory extraction leaves the source alone", () => {
  const yaml = "state:\n  inventory:\n    items:\n      backpack:\n        slot_0:\n          serial: '@Ubackpack'\n      bank:\n        slot_0:\n          serial: '@Ubank'\n    equipped_inventory:\n      equipped:\n        slot_0:\n        - serial: '@Uequipped'\n      other:\n        serial: '@Uother'\n  unrelated:\n    serial: '@Umetadata'\n";
  const doc = new BF.SaveDoc(yaml);
  const before = doc.text();
  assert.deepEqual(doc.inventoryCodes(true, true, false), ["@Ubackpack", "@Uequipped"]);
  assert.deepEqual(doc.inventoryCodes(false, true, false), ["@Ubackpack"]);
  assert.equal(doc.inventoryCodes(false, false, true).length, 0);
  assert.equal(doc.text(), before);
  assert.equal(new BF.SaveDoc("state:\n  inventory: {}\n").inventoryCodes(true, true, true).length, 0);
});

test("catalog resolve, manual codes, and build files", () => {
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "bf_data.json.gz"))).toString("utf8"));
  BF.loadData(data);
  assert.ok(BF.itemCount() > 300);
  const req = BF.parse("Creator\nBy\nAncientRune\n\nWeapon\nZipper\n", "https://example.test/vex");
  assert.equal(req.Author, "AncientRune");
  const rows = BF.resolve(req);
  const zipper = rows.find((r) => r.Label === "Zipper");
  assert.ok(zipper, "Zipper should resolve");
  assert.ok(BF.isSerial(zipper));
  assert.equal(BF.decode(zipper.Serial).startsWith("2, 0, 1, 70|"), true);
  const manual = BF.blankResolution();
  manual.Label = "My item";
  BF.setManualCode(manual, zipper.Serial);
  assert.equal(manual.ManualCode, true);
  assert.throws(() => BF.setManualCode(manual, "{1:2}"), /complete @U item code/);
  assert.equal(manual.Serial, zipper.Serial);
  assert.throws(() => BF.setManualCode(manual, zipper.Serial + "\n" + zipper.Serial), /complete @U item code/);
  BF.setManualCode(manual, "");
  assert.equal(BF.isSerial(manual), false);
  BF.setManualCode(manual, zipper.Serial);
  const saved = {
    Url: "https://mobalytics.gg/borderlands-4/builds/test",
    PageText: "Line one\r\nLine two \"quoted\"",
    SaveUrl: "https://drive.google.com/file/d/example/view",
    ItemsOnly: false,
    Build: { Author: "AncientRune", Character: "Amon", Level: 70, Source: "", Adapter: "generic", Queries: [{ Text: "Gear", Section: "weapon", Mods: [] }], Skills: [], Specializations: [] },
    Results: [manual, Object.assign(BF.blankResolution(), { Query: "Missing", Label: "" })],
    Links: [{ Url: "https://drive.google.com/file/d/example/view", Label: "SAVE FILE", Provider: "google-drive", Score: 7 }],
    Name: "My Amon", Description: "Splash mobbing", Notes: "Codes typed by hand"
  };
  const encoded = BF.serializeBuild(saved);
  const opened = BF.deserializeBuild(encoded);
  assert.equal(opened.Results[0].Serial, zipper.Serial);
  assert.equal(opened.Results[0].ManualCode, true);
  assert.equal(opened.Results[0].Label, "My item");
  assert.equal(opened.PageText, saved.PageText);
  assert.equal(opened.Build.Author, "AncientRune");
  assert.equal(opened.Build.Level, 70);
  assert.equal(opened.Build.Queries[0].Section, "weapon");
  assert.equal(opened.ItemsOnly, false);
  assert.equal(opened.Links[0].Label, "SAVE FILE");
  assert.equal(opened.Name, "My Amon");
  assert.equal(opened.Description, "Splash mobbing");
  assert.equal(opened.Notes, "Codes typed by hand");
  assert.equal(BF.isSerial(opened.Results[1]), false);
  assert.throws(() => BF.deserializeBuild("{}"), /not a supported/);
  assert.throws(() => BF.deserializeBuild(encoded + "trailing junk"), /Unexpected data after JSON/);
});

test("encrypted saves round-trip with a SteamID64", () => {
  const yaml = "state:\n  experience:\n    - type: character\n      level: 10\n  inventory:\n    items:\n      backpack:\n        slot_0:\n          serial: '@Utest'\n";
  const id = "76561197960265728";
  const sav = BF.encryptSave(yaml, id, "plain");
  const opened = BF.decryptSave(sav, id);
  assert.equal(opened.text, yaml);
  assert.equal(opened.format, "plain");
  const doc = new BF.SaveDoc(opened.text);
  doc.Format = opened.format;
  assert.equal(doc.kind(), "character");
  assert.equal(doc.characterLevel(), 10);
  doc.characterLevel(70);
  assert.equal(doc.characterLevel(), 70);
  const again = BF.decryptSave(BF.encryptSave(doc.text(), id, doc.Format), id);
  assert.equal(again.text, doc.text());
});
