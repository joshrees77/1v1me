import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { neonTextures } from './dist/neon-materials.js';

const root = new URL('./dist/assets/', import.meta.url);
const map = JSON.parse(await readFile(new URL('rust/map.json', root)));
const sources = new Set(map.map(entry => entry.texture).filter(Boolean));
const records = JSON.parse(await readFile(new URL('neon/conversions.json', root))).assets;
const dimensions = bytes => {
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG', 'Asset must be a PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};
assert.deepEqual(new Set(Object.keys(neonTextures)), sources, 'Every map texture needs exactly one conversion mapping');
assert.equal(new Set(Object.values(neonTextures)).size, sources.size, 'Each source needs its own converted artwork');
assert.equal(records.length, sources.size, 'Every conversion needs provenance');
for (const source of sources) {
  const output = neonTextures[source];
  const record = records.find(record => record.source === '../rust/' + source);
  assert.equal(record?.output, output, `Missing provenance for ${source}`);
  assert.ok(record.prompt?.length > 30, `Missing edit prompt for ${source}`);
  const [original, converted] = await Promise.all([
    readFile(new URL('rust/' + source, root)),
    readFile(new URL('neon/' + output, root)),
  ]);
  assert.deepEqual(dimensions(converted), dimensions(original), `${source}: dimensions changed`);
  assert.ok(!original.equals(converted), `${source}: original was copied without conversion`);
}
console.log(`PASS: ${sources.size}/${sources.size} source textures have distinct converted assets, matching dimensions and individual edit provenance.`);
