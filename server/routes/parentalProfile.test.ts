import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import type { ParentalProfileResponse } from '@server/interfaces/api/parentalInterfaces';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { isAuthenticated } from '@server/middleware/auth';
import parentalProfileRoutes from '@server/routes/parentalProfile';
import settingsRoutes from '@server/routes/settings';
import userRoutes from '@server/routes/user';
import { setupTestDb } from '@server/test/db';
import {
  createTestApp,
  loadUser,
  loginAs,
  resetParental,
} from '@server/test/parental';
import type { Express } from 'express';

let app: Express;

before(() => {
  app = createTestApp((app) => {
    app.use('/parentalProfile', isAuthenticated(), parentalProfileRoutes);
    app.use('/settings', isAuthenticated(Permission.ADMIN), settingsRoutes);
    app.use('/user', isAuthenticated(), userRoutes);
  });
  // Keep settings.json on disk untouched
  mock.method(getSettings(), 'save', async () => undefined);
});

setupTestDb();
beforeEach(resetParental);

const admin = () => loginAs(app, 'admin@seerr.dev');
const demo = () => loginAs(app, 'demo@seerr.dev');

describe('/parentalProfile', () => {
  it('lets an admin create, list, update and delete profiles', async () => {
    const agent = await admin();
    const created = await agent
      .post('/parentalProfile')
      .send({ name: 'Kids 10', maxAge: 10 });
    assert.equal(created.status, 201);
    assert.equal(created.body.allowUnrated, false);

    const list = await agent.get('/parentalProfile');
    assert.deepEqual(
      list.body.map((p: ParentalProfileResponse) => p.name),
      ['Kids 10']
    );

    const updated = await agent
      .put(`/parentalProfile/${created.body.id}`)
      .send({ name: 'Kids 11', maxAge: 11, allowUnrated: true });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.maxAge, 11);

    const deleted = await agent.delete(`/parentalProfile/${created.body.id}`);
    assert.equal(deleted.status, 204);
  });

  it('refuses a duplicate name and an age outside 0 to 18', async () => {
    const agent = await admin();
    await agent.post('/parentalProfile').send({ name: 'Kids', maxAge: 10 });
    assert.equal(
      (await agent.post('/parentalProfile').send({ name: 'Kids', maxAge: 7 }))
        .status,
      409
    );
    assert.equal(
      (await agent.post('/parentalProfile').send({ name: 'Old', maxAge: 19 }))
        .status,
      400
    );
    assert.equal(
      (await agent.post('/parentalProfile').send({ name: '', maxAge: 5 }))
        .status,
      400
    );
  });

  it('refuses to delete a profile that users have', async () => {
    const agent = await admin();
    const { body: profile } = await agent
      .post('/parentalProfile')
      .send({ name: 'Kids', maxAge: 10 });
    const kid = await loadUser('demo@seerr.dev');
    await agent
      .post(`/user/${kid.id}/settings/main`)
      .send({ username: 'demo', parentalProfileId: profile.id });
    assert.equal(
      (await agent.delete(`/parentalProfile/${profile.id}`)).status,
      409
    );
  });

  it('is closed to users without Manage Users', async () => {
    const agent = await demo();
    assert.equal((await agent.get('/parentalProfile')).status, 403);
    assert.equal(
      (await agent.post('/parentalProfile').send({ name: 'x', maxAge: 1 }))
        .status,
      403
    );
  });
});

describe('/settings/parental', () => {
  it('returns the country list and the supported countries', async () => {
    const res = await (await admin()).get('/settings/parental');
    assert.deepEqual(res.body.countries, ['FR', 'US']);
    assert.ok(res.body.supportedCountries.includes('GB'));
  });

  it('saves a new order', async () => {
    const agent = await admin();
    const res = await agent
      .post('/settings/parental')
      .send({ countries: ['GB', 'FR'] });
    assert.equal(res.status, 200);
    assert.deepEqual(getSettings().parental.countries, ['GB', 'FR']);
  });

  it('refuses empty, unknown and repeated countries', async () => {
    const agent = await admin();
    for (const countries of [[], ['XX'], ['FR', 'FR']]) {
      assert.equal(
        (await agent.post('/settings/parental').send({ countries })).status,
        400
      );
    }
  });
});

describe('/user/:id/settings/main parentalProfileId', () => {
  it('lets an admin assign and read another user profile', async () => {
    const agent = await admin();
    const { body: profile } = await agent
      .post('/parentalProfile')
      .send({ name: 'Kids', maxAge: 10 });
    const kid = await loadUser('demo@seerr.dev');
    await agent
      .post(`/user/${kid.id}/settings/main`)
      .send({ username: 'demo', parentalProfileId: profile.id });
    const res = await agent.get(`/user/${kid.id}/settings/main`);
    assert.equal(res.body.parentalProfileId, profile.id);
  });

  it('refuses an unknown profile id', async () => {
    const agent = await admin();
    const kid = await loadUser('demo@seerr.dev');
    const res = await agent
      .post(`/user/${kid.id}/settings/main`)
      .send({ username: 'demo', parentalProfileId: 999 });
    assert.equal(res.status, 400);
  });

  it('hides the field from the user and ignores their own change', async () => {
    const adminAgent = await admin();
    const { body: profile } = await adminAgent
      .post('/parentalProfile')
      .send({ name: 'Kids', maxAge: 10 });
    const kid = await loadUser('demo@seerr.dev');
    await adminAgent
      .post(`/user/${kid.id}/settings/main`)
      .send({ username: 'demo', parentalProfileId: profile.id });

    const kidAgent = await demo();
    const own = await kidAgent.get(`/user/${kid.id}/settings/main`);
    assert.equal('parentalProfileId' in own.body, false);
    await kidAgent
      .post(`/user/${kid.id}/settings/main`)
      .send({ username: 'demo', parentalProfileId: null });
    assert.equal(
      (await loadUser('demo@seerr.dev')).settings?.parentalProfile?.id,
      profile.id
    );
  });

  it('an edited profile applies on the next request', async () => {
    const agent = await admin();
    const { body: profile } = await agent
      .post('/parentalProfile')
      .send({ name: 'Kids', maxAge: 10 });
    const kid = await loadUser('demo@seerr.dev');
    await agent
      .post(`/user/${kid.id}/settings/main`)
      .send({ username: 'demo', parentalProfileId: profile.id });
    await agent
      .put(`/parentalProfile/${profile.id}`)
      .send({ name: 'Kids', maxAge: 16 });
    assert.equal(
      (await loadUser('demo@seerr.dev')).settings?.parentalProfile?.maxAge,
      16
    );
  });
});
