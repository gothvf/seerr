import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getRepository } from '@server/datasource';
import ParentalProfile from '@server/entity/ParentalProfile';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';

setupTestDb();

async function assignKidsProfile(): Promise<ParentalProfile> {
  const profile = await getRepository(ParentalProfile).save(
    new ParentalProfile({ name: 'Kids 10', maxAge: 10 })
  );
  const users = getRepository(User);
  const kid = await users.findOneOrFail({
    where: { email: 'demo@seerr.dev' },
  });
  kid.settings = new UserSettings({
    notificationTypes: {},
    parentalProfile: profile,
  });
  await users.save(kid);
  return profile;
}

describe('ParentalProfile', () => {
  it('defaults allowUnrated to false', async () => {
    const profile = await getRepository(ParentalProfile).save(
      new ParentalProfile({ name: 'Teen', maxAge: 12 })
    );
    assert.equal(profile.allowUnrated, false);
  });

  it('loads with the user through settings', async () => {
    await assignKidsProfile();
    const kid = await getRepository(User).findOneOrFail({
      where: { email: 'demo@seerr.dev' },
    });
    assert.equal(kid.settings?.parentalProfile?.maxAge, 10);
  });

  it('never serializes with the user', async () => {
    await assignKidsProfile();
    const kid = await getRepository(User).findOneOrFail({
      where: { email: 'demo@seerr.dev' },
    });
    const json = JSON.stringify(kid);
    assert.ok(!json.includes('Kids 10'));
    assert.ok(!json.includes('parentalProfile'));
  });

  it('cannot be deleted while a user has it', async () => {
    const profile = await assignKidsProfile();
    await assert.rejects(getRepository(ParentalProfile).remove(profile));
  });

  it('defaults the country list to US', () => {
    assert.deepEqual(getSettings().parental.countries, ['US']);
  });
});
