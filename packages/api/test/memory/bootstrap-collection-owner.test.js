import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import Fastify from 'fastify';

describe('project bootstrap owner binding', () => {
  let ensureProjectCollection, LibraryCatalog, KnowledgeResolver, evidenceRoutes;
  let project, dataDir, catalog, stores, app;

  before(async () => {
    ({ ensureProjectCollection } = await import('../../dist/domains/memory/bootstrap-collection-bridge.js'));
    ({ LibraryCatalog } = await import('../../dist/domains/memory/LibraryCatalog.js'));
    ({ KnowledgeResolver } = await import('../../dist/domains/memory/KnowledgeResolver.js'));
    ({ evidenceRoutes } = await import('../../dist/routes/evidence.js'));
  });

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'project-owner-vault-'));
    dataDir = mkdtempSync(join(tmpdir(), 'project-owner-data-'));
    writeFileSync(join(project, 'guide.md'), '# Calibration\n\nCalibration requires an illuminated label.\n');
    catalog = new LibraryCatalog();
    stores = new Map();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    for (const store of stores.values()) store.close();
    rmSync(project, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('new registration is searchable by its owner in the same runtime and rejects other owners', async () => {
    await ensureProjectCollection(project, catalog, stores, dataDir, undefined, 'owner-a');
    const manifest = catalog.list()[0];

    const store = stores.get(manifest.id);
    app = Fastify();
    await app.register(evidenceRoutes, {
      evidenceStore: store,
      catalog,
      knowledgeResolver: new KnowledgeResolver({ projectStore: store, catalog, stores }),
    });
    const url = `/api/evidence/search?q=calibration&scope=docs&mode=lexical&dimension=collection&collections=${manifest.id}`;
    const own = await app.inject({ method: 'GET', url, headers: { 'x-cat-cafe-user': 'owner-a' } });
    assert.equal(own.statusCode, 200);
    assert.equal(own.json().results.length, 1);
    assert.equal(manifest.ownerUserId, 'owner-a');
    const persisted = JSON.parse(readFileSync(join(dataDir, 'library', 'collections.json'), 'utf8'));
    assert.equal(persisted[0].ownerUserId, 'owner-a');
    const other = await app.inject({ method: 'GET', url, headers: { 'x-cat-cafe-user': 'owner-b' } });
    assert.equal(other.statusCode, 200);
    assert.deepEqual(other.json().results, []);
  });

  it('missing or blank identity fails before creating persistent or in-memory state', async () => {
    for (const identity of [undefined, '', '   ']) {
      await assert.rejects(
        ensureProjectCollection(project, catalog, stores, dataDir, undefined, identity),
        /owner.*required/i,
      );
      assert.equal(catalog.list().length, 0);
      assert.equal(stores.size, 0);
      assert.equal(existsSync(join(dataDir, 'library')), false);
    }
  });

  it('preserves existing private/restricted owners and rejects indexing by another owner', async () => {
    await ensureProjectCollection(project, catalog, stores, dataDir, undefined, 'owner-a');
    const manifest = catalog.list()[0];
    for (const sensitivity of ['private', 'restricted']) {
      manifest.sensitivity = sensitivity;
      await ensureProjectCollection(project, catalog, stores, dataDir, undefined, 'owner-a');
      await assert.rejects(
        ensureProjectCollection(project, catalog, stores, dataDir, undefined, 'owner-b'),
        /different owner/i,
      );
      assert.equal(manifest.ownerUserId, 'owner-a');
      const persisted = JSON.parse(readFileSync(join(dataDir, 'library', 'collections.json'), 'utf8'));
      assert.equal(persisted[0].ownerUserId, 'owner-a');
    }
  });

  it('does not infer ownership for historical unbound private collections', async () => {
    await ensureProjectCollection(project, catalog, stores, dataDir, undefined, 'owner-a');
    const manifest = catalog.list()[0];
    delete manifest.ownerUserId;
    await assert.rejects(ensureProjectCollection(project, catalog, stores, dataDir, undefined, 'owner-a'), /no owner/i);
    assert.equal(manifest.ownerUserId, undefined);
  });
});
