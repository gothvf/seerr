import { getRepository } from '@server/datasource';
import ParentalProfile from '@server/entity/ParentalProfile';
import { UserSettings } from '@server/entity/UserSettings';
import { Permission } from '@server/lib/permissions';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import { Not } from 'typeorm';
import { z } from 'zod';

const parentalProfileRoutes = Router();

const profileBody = z.object({
  name: z.string().trim().min(1).max(64),
  maxAge: z.number().int().min(0).max(18),
  allowUnrated: z.boolean().default(false),
});

// Read by user settings too, so Manage Users is enough to list
parentalProfileRoutes.get(
  '/',
  isAuthenticated(Permission.MANAGE_USERS),
  async (_req, res, next) => {
    try {
      const profiles = await getRepository(ParentalProfile).find({
        order: { maxAge: 'ASC', name: 'ASC' },
      });
      return res.status(200).json(profiles);
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

parentalProfileRoutes.post(
  '/',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    const body = profileBody.safeParse(req.body);
    if (!body.success) {
      return next({ status: 400, message: 'Invalid parental profile.' });
    }

    try {
      const repository = getRepository(ParentalProfile);
      if (await repository.exist({ where: { name: body.data.name } })) {
        return next({
          status: 409,
          message: 'A parental profile with this name already exists.',
        });
      }
      const profile = await repository.save(new ParentalProfile(body.data));
      return res.status(201).json(profile);
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

parentalProfileRoutes.put<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    const body = profileBody.safeParse(req.body);
    if (!body.success) {
      return next({ status: 400, message: 'Invalid parental profile.' });
    }

    try {
      const repository = getRepository(ParentalProfile);
      const profile = await repository.findOne({
        where: { id: Number(req.params.id) },
      });
      if (!profile) {
        return next({ status: 404, message: 'Parental profile not found.' });
      }
      if (
        await repository.exist({
          where: { name: body.data.name, id: Not(profile.id) },
        })
      ) {
        return next({
          status: 409,
          message: 'A parental profile with this name already exists.',
        });
      }
      Object.assign(profile, body.data);
      return res.status(200).json(await repository.save(profile));
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

parentalProfileRoutes.delete<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    try {
      const repository = getRepository(ParentalProfile);
      const profile = await repository.findOne({
        where: { id: Number(req.params.id) },
      });
      if (!profile) {
        return next({ status: 404, message: 'Parental profile not found.' });
      }
      const assigned = await getRepository(UserSettings).count({
        where: { parentalProfile: { id: profile.id } },
      });
      if (assigned > 0) {
        return next({
          status: 409,
          message: 'This parental profile is assigned to users.',
        });
      }
      await repository.remove(profile);
      return res.status(204).send();
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

export default parentalProfileRoutes;
