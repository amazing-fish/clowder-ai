// F152: Bootstrap → Collection Pipeline Bridge
// Verifies ensureProjectCollection creates manifest, store, and indexes docs

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import Fastify from 'fastify';

function expectedCollectionId(projectPath) {
  let name = basename(projectPath)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');
  if (!name || !/^[a-z]/.test(name)) name = `p${name}`;
  const hash = createHash('sha256').update(resolve(projectPath)).digest('hex').slice(0, 8);
  return `project:${name}-${hash}`;
}

describe('ensureProjectCollection', () => {
  let ensureProjectCollection, LibraryCatalog;
  let tmpProject, tmpDataDir, stores;

  beforeEach(async () => {
    ({ ensureProjectCollection } = await import('../../dist/domains/memory/bootstrap-collection-bridge.js'));
    ({ LibraryCatalog } = await import('../../dist/domains/memory/LibraryCatalog.js'));

    tmpProject = mkdtempSync(join(tmpdir(), 'f152-bridge-'));
    mkdirSync(join(tmpProject, 'docs'));
    writeFileSync(join(tmpProject, 'docs', 'README.md'), '# My Project\n\nOverview of the project.');
    writeFileSync(join(tmpProject, 'docs', 'guide.md'), '# Guide\n\nHow to use this.');
    writeFileSync(join(tmpProject, 'package.json'), JSON.stringify({ name: 'test-proj' }));

    tmpDataDir = mkdtempSync(join(tmpdir(), 'f152-data-'));
    stores = new Map();
  });

  afterEach(() => {
    for (const store of stores.values()) store.close();
    rmSync(tmpProject, { recursive: true, force: true });
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it('creates collection manifest and indexes docs into evidence store', async () => {
    const catalog = new LibraryCatalog();

    const result = await ensureProjectCollection(tmpProject, catalog, stores, tmpDataDir, undefined, 'owner-a');

    assert.ok(result.docsIndexed >= 2, `expected ≥2 docs indexed, got ${result.docsIndexed}`);
    assert.ok(result.durationMs >= 0);

    const expectedId = expectedCollectionId(tmpProject);
    const manifest = catalog.get(expectedId);
    assert.ok(manifest, `manifest for ${expectedId} not in catalog`);
    assert.equal(manifest.kind, 'project');
    assert.equal(manifest.sensitivity, 'private');
    assert.equal(manifest.root, tmpProject);

    const store = stores.get(expectedId);
    assert.ok(store, `store for ${expectedId} not in stores map`);
  });

  it('skips re-registration if collection already exists in catalog', async () => {
    const catalog = new LibraryCatalog();

    const result1 = await ensureProjectCollection(tmpProject, catalog, stores, tmpDataDir, undefined, 'owner-a');
    const result2 = await ensureProjectCollection(tmpProject, catalog, stores, tmpDataDir, undefined, 'owner-a');

    assert.ok(result1.docsIndexed >= 2);
    assert.ok(result2.docsIndexed >= 0);
  });

  it('persists manifest to collections.json', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    const catalog = new LibraryCatalog();

    await ensureProjectCollection(tmpProject, catalog, stores, tmpDataDir, undefined, 'owner-a');

    const collectionsPath = join(tmpDataDir, 'library', 'collections.json');
    assert.ok(existsSync(collectionsPath), 'collections.json should be created');
    const saved = JSON.parse(readFileSync(collectionsPath, 'utf-8'));
    assert.ok(Array.isArray(saved));
    assert.ok(saved.length >= 1);
    assert.equal(saved[saved.length - 1].kind, 'project');
  });

  it('creates store at correct path under dataDir', async () => {
    const { existsSync } = await import('node:fs');
    const catalog = new LibraryCatalog();

    await ensureProjectCollection(tmpProject, catalog, stores, tmpDataDir, undefined, 'owner-a');

    const expectedId = expectedCollectionId(tmpProject);
    const safeId = expectedId.replace(/:/g, '-');
    const storePath = join(tmpDataDir, 'library', safeId, 'evidence.sqlite');
    assert.ok(existsSync(storePath), `store should exist at ${storePath}`);
  });

  it('P1-1: two projects with same basename get distinct collections', async () => {
    const parentA = mkdtempSync(join(tmpdir(), 'col-a-'));
    const parentB = mkdtempSync(join(tmpdir(), 'col-b-'));
    const projA = join(parentA, 'myapp');
    const projB = join(parentB, 'myapp');
    mkdirSync(join(projA, 'docs'), { recursive: true });
    mkdirSync(join(projB, 'docs'), { recursive: true });
    writeFileSync(join(projA, 'docs', 'a.md'), '# Project A');
    writeFileSync(join(projB, 'docs', 'b.md'), '# Project B');

    const catalog = new LibraryCatalog();

    await ensureProjectCollection(projA, catalog, stores, tmpDataDir, undefined, 'owner-a');
    await ensureProjectCollection(projB, catalog, stores, tmpDataDir, undefined, 'owner-a');

    const allManifests = catalog.list();
    const projectManifests = allManifests.filter((m) => m.kind === 'project');
    assert.equal(projectManifests.length, 2, 'should have 2 distinct project collections');

    const roots = projectManifests.map((m) => m.root);
    assert.ok(roots.includes(projA), 'projA root should be in manifests');
    assert.ok(roots.includes(projB), 'projB root should be in manifests');

    rmSync(parentA, { recursive: true, force: true });
    rmSync(parentB, { recursive: true, force: true });
  });

  it('P1-2: throws when secret is detected in project files', async () => {
    const secretProject = mkdtempSync(join(tmpdir(), 'secret-'));
    writeFileSync(join(secretProject, 'leaked.md'), '# Config\n\ntoken: ghp_AAAAAAAABBBBBBBBCCCCCCCCDDDDDDDDEEEE\n');

    const catalog = new LibraryCatalog();

    await assert.rejects(
      () => ensureProjectCollection(secretProject, catalog, stores, tmpDataDir, undefined, 'owner-a'),
      (err) => {
        assert.ok(err.message.includes('secret'), `error should mention secret: ${err.message}`);
        return true;
      },
    );

    rmSync(secretProject, { recursive: true, force: true });
  });

  it('P1-3: handles project paths starting with digits or symbols', async () => {
    const digitProject = mkdtempSync(join(tmpdir(), '2026-roadmap-'));
    mkdirSync(join(digitProject, 'docs'));
    writeFileSync(join(digitProject, 'docs', 'plan.md'), '# Plan');

    const catalog = new LibraryCatalog();

    const result = await ensureProjectCollection(digitProject, catalog, stores, tmpDataDir, undefined, 'owner-a');
    assert.ok(result.docsIndexed >= 1);

    const expectedId = expectedCollectionId(digitProject);
    const manifest = catalog.get(expectedId);
    assert.ok(manifest, `manifest for ${expectedId} should exist in catalog`);

    rmSync(digitProject, { recursive: true, force: true });
  });

  it('P1-4: wires embeddingService into bootstrap path (production wiring)', async () => {
    const catalog = new LibraryCatalog();

    let embedCallCount = 0;
    const mockEmbeddingService = {
      isReady: () => true,
      reprobeIfNeeded: async () => {},
      embed: async (texts) => {
        embedCallCount += texts.length;
        return texts.map(() => new Float32Array([0.1, 0.2]));
      },
      getModelInfo: () => ({ modelId: 'test', modelRev: 'v1', dim: 2 }),
    };

    const result = await ensureProjectCollection(
      tmpProject,
      catalog,
      stores,
      tmpDataDir,
      () => mockEmbeddingService,
      'owner-a',
    );

    assert.ok(result.docsIndexed >= 2, `expected ≥2 docs, got ${result.docsIndexed}`);
    assert.ok(embedCallCount >= 2, `expected ≥2 embed calls, got ${embedCallCount}`);

    const collectionId = expectedCollectionId(tmpProject);
    const store = stores.get(collectionId);
    const db = store.getDb();
    const vecCount = db.prepare('SELECT COUNT(*) as cnt FROM evidence_vectors').get();
    assert.ok(vecCount.cnt >= 2, `expected ≥2 vectors in db, got ${vecCount.cnt}`);
  });

  it('P2-1: second rebuild reports total docs not just newly indexed', async () => {
    const catalog = new LibraryCatalog();

    const result1 = await ensureProjectCollection(tmpProject, catalog, stores, tmpDataDir, undefined, 'owner-a');
    assert.ok(result1.docsIndexed >= 2, `first run should index ≥2 docs, got ${result1.docsIndexed}`);

    const result2 = await ensureProjectCollection(tmpProject, catalog, stores, tmpDataDir, undefined, 'owner-a');
    assert.ok(result2.docsIndexed >= 2, `second run should report ≥2 total docs (not 0), got ${result2.docsIndexed}`);
  });
});

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

  for (const sensitivity of ['private', 'restricted']) {
    it(`startup preserves historical unbound ${sensitivity} ownership before bootstrap`, async () => {
      await ensureProjectCollection(project, catalog, stores, dataDir, undefined, 'owner-a');
      const manifest = catalog.list()[0];
      manifest.sensitivity = sensitivity;
      delete manifest.ownerUserId;
      writeFileSync(join(dataDir, 'library', 'collections.json'), JSON.stringify([manifest]));
      for (const store of stores.values()) store.close();
      stores = new Map();
      catalog = new LibraryCatalog();
      const { loadExternalCollections } = await import('../../dist/domains/memory/external-collections.js');
      const { registerPrivateAndExternalCollections } = await import(
        '../../dist/domains/memory/private-collection-bindings.js'
      );
      await registerPrivateAndExternalCollections({
        catalog,
        stores,
        dataDir,
        externalManifests: loadExternalCollections(dataDir),
        privateUserId: 'owner-b',
        now: new Date().toISOString(),
      });
      assert.equal(catalog.get(manifest.id).ownerUserId, undefined);
      await assert.rejects(
        ensureProjectCollection(project, catalog, stores, dataDir, undefined, 'owner-b'),
        /no owner/i,
      );
      const store = stores.get(manifest.id);
      app = Fastify();
      await app.register(evidenceRoutes, {
        evidenceStore: store,
        catalog,
        knowledgeResolver: new KnowledgeResolver({ projectStore: store, catalog, stores }),
      });
      const response = await app.inject({
        method: 'GET',
        url: `/api/evidence/search?q=calibration&scope=docs&dimension=collection&collections=${manifest.id}`,
        headers: { 'x-cat-cafe-user': 'owner-b' },
      });
      assert.deepEqual(response.json().results, []);
      assert.equal(
        JSON.parse(readFileSync(join(dataDir, 'library', 'collections.json'), 'utf8'))[0].ownerUserId,
        undefined,
      );
    });
  }
});
